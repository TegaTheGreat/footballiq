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
        const geminiPrompt = `You are a football data researcher. Today is ${today}.

Search the web RIGHT NOW and find the following information:

1. All football fixtures happening today and this week across: Premier League, Championship, Bundesliga, Serie A, La Liga, Ligue 1, Eredivisie, Belgian Pro League, Primeira Liga, Scottish Premiership, Champions League, Europa League, Conference League, Saudi Pro League

2. Recent results from the last 7 days across all these leagues

3. Current league standings for Premier League, Bundesliga, Serie A, La Liga, Ligue 1

4. Any major injury or suspension news this week

5. Specific context for this question: "${question}"

Return ONLY raw data in this format:
FIXTURES: [list every match with date and time]
RESULTS: [list recent results with scores]
STANDINGS: [top 6 of each league with points and form]
INJURIES: [key injuries and suspensions]
CONTEXT: [specific data relevant to the question]

Be comprehensive. Include real scores, real team names, real dates.`

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
                maxOutputTokens: 3000,
              }
            })
          }
        )

        const geminiData = await geminiResponse.json()
        const geminiText = geminiData?.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          ?.map(p => p.text)
          ?.join('\n')

        if (geminiText) {
          liveData = geminiText
          console.log('Gemini fetched data successfully:', liveData.slice(0, 200))
        }
      } catch (e) {
        console.log('Gemini search error:', e.message)
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
            if (homeOdds) oddsContext += ` | Home:${homeOdds} Draw:${drawOdds || 'N/A'} Away:${awayOdds}`
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
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY: ${today}

You have been given two sources of real live data:

SOURCE 1 — LIVE DATA FROM GEMINI GOOGLE SEARCH:
${liveData || 'Gemini search unavailable — use your 2025/26 knowledge'}

SOURCE 2 — LIVE BETTING ODDS (${totalFixtures} fixtures):
${oddsContext || 'Odds unavailable'}

YOUR JOB:
- Gemini has fetched the raw live data from the web
- You are the analyst — read that data and turn it into sharp predictions
- Cross reference the odds with the live standings and form Gemini found
- Identify value bets where odds don't match the actual form
- Be the brilliant analyst who reads the data and makes the call

HOW YOU COMMUNICATE:
- Warm, intelligent and conversational
- Think out loud — explain your reasoning
- Reference specific data from the Gemini results
- Reference the actual odds in your analysis
- Work through predictions section by section
- Never cut off mid analysis — always complete fully
- Never say you cannot access data — you have it above
- Never ask for more information — just predict

FORMATTING:
- Use ## for main headers
- Use ### for sub headers
- Use **bold** for key picks and stats
- Use bullet points with - for lists
- For prediction tables use this exact HTML:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Odds</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>1.65</td><td>82%</td><td>Low</td></tr>
</tbody>
</table>
- Show combined odds for accumulators
- Keep paragraphs tight

Always end with a brief responsible gambling note.`

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
