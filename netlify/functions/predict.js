export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image, images } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const season = 2025

    // ============================================
    // FETCH EVERYTHING IN PARALLEL
    // ============================================

    const fetchGemini = async () => {
      if (!GEMINI_API_KEY) return ''
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: `You are an elite sports researcher with live Google Search access. Today is ${today}.

The user is asking: "${question}"

STEP 1 — THINK before you search. Identify:
- What specific teams, leagues or competitions are being asked about?
- If the request is general like "best bets this weekend" — automatically identify the biggest matches happening this weekend across Premier League, Champions League, Europa League, Bundesliga, Serie A and La Liga

STEP 2 — SEARCH for each identified match or team:
- "[Team A] vs [Team B] preview ${today}"
- "[Team A] recent form results March 2026"
- "[Team B] recent form results March 2026"
- "[Team A] injuries suspensions team news March 2026"
- "[Competition] fixtures this week March 2026"
- "[Competition] standings table March 2026"

STEP 3 — RETURN a concise bulleted list of raw facts only. No intro, no outro:

- [Match]: [date and time]
- [Team] form: [last 5 results with scores]
- [Team] key absence: [player name, reason]
- [Team] vs [Team] H2H: [last 3 results with scores]
- [League] top 6: [teams with points]
- Breaking news: [any relevant injury or tactical news]

Search multiple times. Never return empty.` }]
              }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
            })
          }
        )
        const data = await res.json()
        const text = data?.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          ?.map(p => p.text)
          ?.join('\n')
        if (text && text.length > 100) {
          console.log('Gemini success, chars:', text.length)
          return text
        }
        console.log('Gemini empty:', JSON.stringify(data).slice(0, 200))
        return ''
      } catch (e) {
        console.log('Gemini error:', e.message)
        return ''
      }
    }

    const fetchOdds = async () => {
      if (!ODDS_API_KEY) return { context: '', total: 0 }
      const sports = [
        { key: 'soccer_epl', name: 'Premier League' },
        { key: 'soccer_uefa_champs_league', name: 'Champions League' },
        { key: 'soccer_uefa_europa_league', name: 'Europa League' },
        { key: 'soccer_spain_la_liga', name: 'La Liga' },
        { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
        { key: 'soccer_italy_serie_a', name: 'Serie A' },
        { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
      ]
      try {
        const results = await Promise.all(
          sports.map(s =>
            fetch(`https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`)
            .then(r => r.json())
            .catch(() => [])
          )
        )
        let context = ''
        let total = 0
        results.forEach((fixtures, idx) => {
          if (!Array.isArray(fixtures) || !fixtures.length) return
          context += `\n${sports[idx].name}:\n`
          fixtures.forEach(f => {
            if (!f.home_team || !f.away_team) return
            total++
            const date = new Date(f.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })
            let h = null, d = null, a = null
            if (f.bookmakers?.[0]?.markets) {
              const h2h = f.bookmakers[0].markets.find(m => m.key === 'h2h')
              if (h2h) {
                h = h2h.outcomes?.find(o => o.name === f.home_team)?.price
                a = h2h.outcomes?.find(o => o.name === f.away_team)?.price
                d = h2h.outcomes?.find(o => o.name === 'Draw')?.price
              }
            }
            context += `${date}: ${f.home_team} vs ${f.away_team}`
            if (h) {
              context += ` | Home:${h} Draw:${d || 'N/A'} Away:${a}`
              if (h <= 1.4) context += ` [STRONG FAV]`
              if (h >= 3.5 && a >= 3.5) context += ` [OPEN]`
            }
            context += '\n'
          })
        })
        return { context, total }
      } catch (e) {
        console.log('Odds error:', e.message)
        return { context: '', total: 0 }
      }
    }

    const fetchStandings = async () => {
      if (!APISPORTS_KEY) return ''
      try {
        const leagues = [39, 140, 78, 135, 61, 2]
        const results = await Promise.all(
          leagues.map(id =>
            fetch(`https://v3.football.api-sports.io/standings?league=${id}&season=${season}`, {
              headers: { 'x-apisports-key': APISPORTS_KEY }
            })
            .then(r => r.json())
            .catch(() => null)
          )
        )
        let context = '\n=== STANDINGS ===\n'
        results.forEach(data => {
          data?.response?.forEach(l => {
            context += `\n${l.league?.name}:\n`
            l.league?.standings?.[0]?.slice(0, 8).forEach(t => {
              context += `${t.rank}. ${t.team?.name} | ${t.points}pts | Form:${t.form}\n`
            })
          })
        })
        return context
      } catch (e) {
        console.log('Standings error:', e.message)
        return ''
      }
    }

    // 🔥 ALL THREE AT THE EXACT SAME TIME
    const [liveData, oddsData, standingsContext] = await Promise.all([
      fetchGemini(),
      fetchOdds(),
      fetchStandings(),
    ])

    const oddsContext = oddsData.context
    const totalFixtures = oddsData.total

    // ============================================
    // STEP 3: CLAUDE ANALYSES EVERYTHING
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You think and communicate like a brilliant analyst — warm, sharp, and data-driven.

TODAY: ${today}

=== LIVE DATA FROM GEMINI GOOGLE SEARCH ===
${liveData || 'Gemini returned no data. Use 2025/26 season knowledge but state confidence is based on training knowledge.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures) ===
${oddsContext || 'No odds data available'}

${standingsContext}

=== YOUR ANALYTICAL PROCESS ===

STEP 1 — ASSESS YOUR DATA
Check what Gemini found. Strong data = high confidence. Thin data = lower confidence, say why.

STEP 2 — BUILD MATCH PROFILES
For each match extract from Gemini's data:
- Current form and recent results
- Goals scored and conceded trends
- Home and away records
- Key injuries and suspensions
- Head to head history
- Tactical and motivation context

STEP 3 — CROSS REFERENCE WITH ODDS
- Low odds confirm your pick
- High odds for a strong team = value bet
- Odds that don't match form = flag it

STEP 4 — ONLY MAKE INFORMED PREDICTIONS
- Strong data = confident prediction
- Limited data = lower confidence, say so
- No data = flag as insufficient, do not guess

STEP 5 — STRUCTURE YOUR RESPONSE:

## [Competition] Analysis

### [Home Team] vs [Away Team]
**Date/Time:** [from data]
**Form:** [Home Team last 5] | [Away Team last 5]
**Head to Head:** [recent meetings]
**Key Absences:** [injuries from data]
**Context:** [tactical or motivation notes]
**Odds:** Home [x.xx] | Draw [x.xx] | Away [x.xx]
**Analysis:** [your reasoning from actual data]
**Prediction:** [pick] — [confidence]% confidence
**Best Bet:** [specific market with reasoning]

After all matches:

## Summary Table
[HTML predictions table]

## Best Accumulator
[3-4 picks with combined odds calculation]

## Matches to Avoid
[too unpredictable or insufficient data]

=== COMMUNICATION ===
- Think out loud — show reasoning from actual data
- Reference specific stats Gemini found
- Honest about confidence based on data quality
- Never fabricate — if Gemini did not find it say data is limited
- Complete every analysis fully — never cut off
- Warm and conversational but always data driven
- No random guesses — only informed predictions
- Brief responsible gambling note at end`

    // ============================================
    // STEP 4: BUILD MESSAGES WITH IMAGE SUPPORT
    // ============================================
    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      const imageBlocks = imageList.map(img => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.type,
          data: img.base64,
        }
      }))
      userContent = [
        ...imageBlocks,
        {
          type: 'text',
          text: question || 'Analyze these images and give me full predictions'
        }
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    const conversationHistory = (messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.replace(/<[^>]*>/g, '').slice(0, 1000)
          : m.content
      }))

    const allMessages = [
      ...conversationHistory,
      { role: 'user', content: userContent }
    ]

    // ============================================
    // STEP 5: STREAM CLAUDE'S ANALYSIS
    // ============================================
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        stream: true,
        system: systemPrompt,
        messages: allMessages,
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    // ============================================
    // STEP 6: STREAM TO CLIENT
    // ============================================
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    const encoder = new TextEncoder()
    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()

    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.trim())

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  await writer.write(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`
                    )
                  )
                }
              } catch (e) {}
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'))
      } catch (e) {
        console.log('Stream error:', e.message)
      } finally {
        await writer.close()
      }
    })()

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

export const config = {
  path: '/api/predict'
}
