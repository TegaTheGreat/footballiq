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

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image, images } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // ============================================
    // STEP 1: GEMINI SEARCHES GOOGLE FOR LIVE DATA
    // ============================================
    let liveData = ''

    if (GEMINI_API_KEY) {
      try {
        const geminiPrompt = `You are an elite sports researcher with live Google Search access. Today is ${today}.

The user is asking: "${question}"

STEP 1 — THINK before you search. Identify:
- What specific teams, leagues or competitions are being asked about?
- If the request is general like "best bets this weekend" or "predictions today" — automatically identify the biggest matches happening this weekend across Premier League, Champions League, Europa League, Bundesliga, Serie A and La Liga

STEP 2 — SEARCH for each identified match or team:
- "[Team A] vs [Team B] preview ${today}"
- "[Team A] recent form results March 2026"
- "[Team B] recent form results March 2026"
- "[Team A] injuries suspensions team news March 2026"
- "[Competition] fixtures this week March 2026"
- "[Competition] standings table March 2026"

STEP 3 — RETURN a concise bulleted list of raw facts only. No intro, no outro, no filler. Just facts:

- [Match]: [date and time]
- [Team] form: [last 5 results with scores]
- [Team] key absence: [player name, reason]
- [Team] vs [Team] H2H: [last 3 results with scores]
- [League] standings: [top 6 teams with points and form]
- [Team] home/away record: [wins, draws, losses, goals]
- Breaking news: [any relevant injury, suspension or tactical news]

Search multiple times until you have real data. Never return empty. Always find something useful.`

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: geminiPrompt }]
              }],
              tools: [{
                google_search: {}
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4000,
              }
            })
          }
        )

        const geminiData = await geminiResponse.json()

        const geminiText = geminiData?.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          ?.map(p => p.text)
          ?.join('\n')

        if (geminiText && geminiText.length > 100) {
          liveData = geminiText
          console.log('Gemini success, chars:', liveData.length)
        } else {
          console.log('Gemini empty response:', JSON.stringify(geminiData).slice(0, 500))
        }

      } catch (e) {
        console.log('Gemini error:', e.message)
      }
    }

    // ============================================
    // STEP 2: FETCH LIVE ODDS
    // ============================================
    const sportsToFetch = [
      { key: 'soccer_epl', name: 'Premier League' },
      { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
      { key: 'soccer_italy_serie_a', name: 'Serie A' },
      { key: 'soccer_spain_la_liga', name: 'La Liga' },
      { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
      { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
      { key: 'soccer_belgium_first_div', name: 'Belgian Pro League' },
      { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
      { key: 'soccer_scotland_premiership', name: 'Scottish Premiership' },
      { key: 'soccer_uefa_champs_league', name: 'Champions League' },
      { key: 'soccer_uefa_europa_league', name: 'Europa League' },
      { key: 'soccer_saudi_professional_league', name: 'Saudi Pro League' },
    ]

    let oddsContext = ''
    let totalFixtures = 0

    if (ODDS_API_KEY) {
      try {
        const oddsRequests = sportsToFetch.map(sport =>
          fetch(
            `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`
          )
          .then(r => r.json())
          .catch(() => [])
        )

        const results = await Promise.all(oddsRequests)

        results.forEach((fixtures, idx) => {
          if (!Array.isArray(fixtures) || fixtures.length === 0) return
          const sportName = sportsToFetch[idx].name
          oddsContext += `\n${sportName}:\n`

          fixtures.forEach(fixture => {
            if (!fixture.home_team || !fixture.away_team) return
            totalFixtures++

            const date = new Date(fixture.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })

            let homeOdds = null, drawOdds = null, awayOdds = null
            if (fixture.bookmakers?.length > 0) {
              const h2h = fixture.bookmakers[0].markets?.find(m => m.key === 'h2h')
              if (h2h) {
                homeOdds = h2h.outcomes?.find(o => o.name === fixture.home_team)?.price
                awayOdds = h2h.outcomes?.find(o => o.name === fixture.away_team)?.price
                drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price
              }
            }

            oddsContext += `${date}: ${fixture.home_team} vs ${fixture.away_team}`
            if (homeOdds) {
              oddsContext += ` | Home:${homeOdds} Draw:${drawOdds || 'N/A'} Away:${awayOdds}`
              if (homeOdds <= 1.4) oddsContext += ` [STRONG FAVOURITE]`
              if (homeOdds >= 3.5 && awayOdds >= 3.5) oddsContext += ` [OPEN MATCH]`
            }
            oddsContext += '\n'
          })
        })
      } catch (e) {
        console.log('Odds API error:', e.message)
      }
    }

    // ============================================
    // STEP 3: CLAUDE ANALYSES EVERYTHING
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You think and communicate like a brilliant analyst — warm, sharp, and data-driven.

TODAY: ${today}

=== LIVE DATA FROM GEMINI GOOGLE SEARCH ===
${liveData
  ? liveData
  : 'Gemini search returned no data. Use your 2025/26 season knowledge but state confidence is based on training knowledge not live search.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures) ===
${oddsContext || 'No odds data available'}

=== YOUR ANALYTICAL PROCESS ===

STEP 1 — ASSESS YOUR DATA
Check what Gemini found. If data is strong — high confidence predictions. If data is thin — lower confidence, say why honestly.

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
- High odds for a strong team = value bet — flag it
- Odds that don't match form = worth highlighting

STEP 4 — ONLY MAKE INFORMED PREDICTIONS
- Strong data = confident prediction with high confidence rating
- Limited data = lower confidence, say so clearly
- No data at all = flag as insufficient data, do not guess

STEP 5 — STRUCTURE YOUR RESPONSE:

## [Competition] Analysis

### [Home Team] vs [Away Team]
**Date/Time:** [from data]
**Form:** [Home Team last 5] | [Away Team last 5]
**Head to Head:** [recent meetings]
**Key Absences:** [injuries from data]
**Context:** [tactical or motivation notes]
**Odds:** Home [x.xx] | Draw [x.xx] | Away [x.xx]
**Analysis:** [your reasoning from the actual data]
**Prediction:** [pick] — [confidence]% confidence
**Best Bet:** [specific market with reasoning]

After all matches:

## Summary Table
[HTML predictions table]

## Best Accumulator
[3-4 picks with combined odds calculation]

## Matches to Avoid
[too unpredictable or insufficient data]

=== HOW YOU COMMUNICATE ===
- Think out loud — show reasoning from actual data
- Reference specific stats Gemini found
- Be honest about confidence based on data quality
- Never fabricate data — if Gemini did not find it say data is limited
- Complete every analysis fully — never cut off
- Warm and conversational but always data driven
- No random guesses — only informed predictions
- End with a brief responsible gambling note`

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
