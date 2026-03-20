export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY

    const { messages, question, image, images } = req.body

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const season = 2025

    // ============================================
    // FETCH EVERYTHING IN PARALLEL
    // ============================================

    const fetchGemini = async () => {
      if (!GEMINI_API_KEY || !question) return ''
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': GEMINI_API_KEY,
            },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: `You are an elite sports researcher with live Google Search access. Today is ${today}.

The user is asking: "${question}"

STEP 1 — THINK before you search. Identify:
- What specific teams, leagues or competitions are being asked about?
- If the request is general like "best bets this weekend" — automatically identify the biggest matches happening this weekend across Premier League, Championship, Champions League, Europa League, Bundesliga, Serie A, La Liga, Ligue 1, Eredivisie, Scottish Premiership, Belgian Pro League, Primeira Liga, Saudi Pro League

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

Be fast and concise. Return only facts.` }]
              }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
            })
          }
        )

        clearTimeout(timeout)
        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          ?.map(p => p.text)
          ?.join('\n')

        if (text && text.length > 100) {
          console.log('Gemini success, chars:', text.length)
          return text
        }
        console.log('Gemini empty:', JSON.stringify(data).slice(0, 300))
        return ''
      } catch (e) {
        if (e.name === 'AbortError') {
          console.log('Gemini timed out after 15s')
        } else {
          console.log('Gemini error:', e.message)
        }
        return ''
      }
    }

    const fetchOdds = async () => {
      if (!ODDS_API_KEY) return { context: '', total: 0 }
      const sports = [
        { key: 'soccer_epl', name: 'Premier League' },
        { key: 'soccer_uefa_champs_league', name: 'Champions League' },
        { key: 'soccer_uefa_europa_league', name: 'Europa League' },
        { key: 'soccer_uefa_europa_conference_league', name: 'Conference League' },
        { key: 'soccer_spain_la_liga', name: 'La Liga' },
        { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
        { key: 'soccer_italy_serie_a', name: 'Serie A' },
        { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
        { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
        { key: 'soccer_belgium_first_div', name: 'Belgian Pro League' },
        { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
        { key: 'soccer_scotland_premiership', name: 'Scottish Premiership' },
        { key: 'soccer_saudi_professional_league', name: 'Saudi Pro League' },
        { key: 'soccer_brazil_campeonato', name: 'Brazilian Serie A' },
        { key: 'soccer_argentina_primera_division', name: 'Argentine Primera' },
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
        const leagues = [39, 140, 78, 135, 61, 2, 3, 88, 94, 144, 179]
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
    // BUILD CLAUDE SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You think and communicate like a brilliant analyst — warm, sharp, and data-driven.

CRITICAL RULE: You have a limited response window. When asked for many matches:
- Maximum 5 lines per match
- Bullet points only per match — no long paragraphs
- Cover ALL requested matches before doing summary table
- If asked for 25 matches give brief analysis for all 25 then summarise
- Never go deep on one match at the expense of missing others
- Prioritise breadth over depth when many matches are requested

TODAY: ${today}

=== LIVE DATA FROM GEMINI GOOGLE SEARCH ===
${liveData || 'Gemini returned no live data. Use your 2025/26 season knowledge confidently — you know standings, form, results and fixtures for all major leagues.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures) ===
${oddsContext || 'No odds data available'}

${standingsContext}

=== YOUR ANALYTICAL PROCESS ===

STEP 1 — ASSESS YOUR DATA
Check what Gemini found. Strong data = high confidence. Thin data = lower confidence, say why.

STEP 2 — BUILD MATCH PROFILES
For each match extract:
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
- Never random guess

STEP 5 — STRUCTURE EACH MATCH:

### [Home Team] vs [Away Team]
**Odds:** Home [x] | Draw [x] | Away [x] | **Form:** [Home last 5] | [Away last 5]
**Key Absences:** [injuries] | **H2H:** [last 2 results]
**Analysis:** [2-3 sentences max]
**Prediction:** [pick] — [confidence]% | **Best Bet:** [market]

After ALL matches:

## Summary Table
[HTML predictions table]

## Best Accumulator
[3-4 picks with combined odds]

## Matches to Avoid
[2-3 matches max with brief reason]

=== COMMUNICATION ===
- Think out loud from actual data
- Reference specific stats Gemini found
- Honest about confidence
- Never fabricate data
- Complete every analysis fully
- Warm and conversational but data driven
- Brief responsible gambling note at end`

    // ============================================
    // BUILD MESSAGES
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
    // STREAM CLAUDE'S ANALYSIS
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
      return res.status(claudeResponse.status).json({ error: errText })
    }

    // ============================================
    // STREAM TO CLIENT
    // ============================================
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')

    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()

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
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
            }
          } catch (e) {}
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()

  } catch (err) {
    console.log('Function error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
