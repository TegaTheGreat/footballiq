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
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // ============================================
    // STEP 1: FETCH LIVE FIXTURES FROM ODDS API
    // ============================================
    const sportsToFetch = [
      'soccer_epl',
      'soccer_germany_bundesliga',
      'soccer_italy_serie_a',
      'soccer_spain_la_liga',
      'soccer_france_ligue_one',
      'soccer_netherlands_eredivisie',
      'soccer_belgium_first_div',
      'soccer_portugal_primeira_liga',
      'soccer_scotland_premiership',
      'soccer_uefa_champs_league',
      'soccer_uefa_europa_league',
    ]

    let fixturesContext = ''
    let totalFixtures = 0

    if (ODDS_API_KEY) {
      try {
        const fixtureRequests = sportsToFetch.map(sport =>
          fetch(
            `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`,
          )
          .then(r => r.json())
          .catch(() => [])
        )

        const results = await Promise.all(fixtureRequests)

        results.forEach((fixtures, idx) => {
          if (!Array.isArray(fixtures) || fixtures.length === 0) return
          const sportName = sportsToFetch[idx].replace('soccer_', '').replace(/_/g, ' ').toUpperCase()
          fixturesContext += `\n=== ${sportName} ===\n`

          fixtures.forEach(fixture => {
            if (!fixture.home_team || !fixture.away_team) return
            totalFixtures++

            const date = new Date(fixture.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })

            // Get odds from bookmakers
            let homeOdds = null, drawOdds = null, awayOdds = null
            if (fixture.bookmakers && fixture.bookmakers.length > 0) {
              const bookmaker = fixture.bookmakers[0]
              const h2h = bookmaker.markets?.find(m => m.key === 'h2h')
              if (h2h) {
                const home = h2h.outcomes?.find(o => o.name === fixture.home_team)
                const away = h2h.outcomes?.find(o => o.name === fixture.away_team)
                const draw = h2h.outcomes?.find(o => o.name === 'Draw')
                homeOdds = home?.price
                awayOdds = away?.price
                drawOdds = draw?.price
              }
            }

            fixturesContext += `${date}: ${fixture.home_team} vs ${fixture.away_team}`
            if (homeOdds) fixturesContext += ` | Odds: Home ${homeOdds} Draw ${drawOdds || 'N/A'} Away ${awayOdds}`
            fixturesContext += '\n'
          })
        })
      } catch (e) {
        console.log('Odds API error:', e.message)
      }
    }

    // ============================================
    // STEP 2: FETCH STANDINGS FROM API-SPORTS
    // ============================================
    let standingsContext = ''
    const season = 2025

    if (APISPORTS_KEY) {
      try {
        const leagueIds = [39, 78, 135, 140, 61, 88, 144, 94, 179]
        const standingResults = await Promise.all(
          leagueIds.map(id =>
            fetch(
              `https://v3.football.api-sports.io/standings?league=${id}&season=${season}`,
              { headers: { 'x-apisports-key': APISPORTS_KEY } }
            )
            .then(r => r.json())
            .catch(() => null)
          )
        )

        const leagueGroups = {}
        standingResults.forEach(data => {
          if (!data?.response) return
          data.response.forEach(league => {
            const leagueName = league.league?.name
            if (!leagueName) return
            if (!leagueGroups[leagueName]) leagueGroups[leagueName] = []
            league.league?.standings?.[0]?.forEach(team => {
              if (!team?.team?.name) return
              leagueGroups[leagueName].push({
                position: team.rank,
                team: team.team.name,
                points: team.points,
                played: team.all?.played,
                won: team.all?.win,
                drawn: team.all?.draw,
                lost: team.all?.lose,
                goalsFor: team.all?.goals?.for,
                goalsAgainst: team.all?.goals?.against,
                form: team.form || '',
                homeGF: team.home?.goals?.for,
                homeGA: team.home?.goals?.against,
                awayGF: team.away?.goals?.for,
                awayGA: team.away?.goals?.against,
              })
            })
          })
        })

        standingsContext = '\n=== CURRENT STANDINGS & FORM ===\n'
        Object.entries(leagueGroups).forEach(([league, teams]) => {
          standingsContext += `\n${league}:\n`
          teams.sort((a, b) => a.position - b.position).slice(0, 12).forEach(t => {
            standingsContext += `${t.position}. ${t.team} | ${t.points}pts | W${t.won} D${t.drawn} L${t.lost} | GF${t.goalsFor} GA${t.goalsAgainst} | Form:${t.form} | HomeGF${t.homeGF} HomeGA${t.homeGA} AwayGF${t.awayGF} AwayGA${t.awayGA}\n`
          })
        })
      } catch (e) {
        console.log('Standings error:', e.message)
      }
    }

    // ============================================
    // STEP 3: BUILD SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY: ${today}

${totalFixtures > 0 ? `LIVE FIXTURES WITH ODDS (${totalFixtures} matches):
${fixturesContext}` : 'No live fixture data available — use your 2025/26 season knowledge to identify upcoming matches.'}

${standingsContext}

IMPORTANT CONTEXT:
- Use the betting odds provided to assess market confidence
- Lower odds on a team = bookmakers favour them = use as supporting evidence
- Cross reference odds with standings and form for best predictions
- Today is ${today} — focus on imminent matches

YOUR RULES:
1. Base predictions on fixtures, odds AND standings data above
2. Remember full conversation history — build on previous messages
3. Never refuse to predict
4. Use this exact HTML table for predictions:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>
5. When building accumulators show estimated combined odds
6. Flag matches where odds suggest a surprise — good value bets
7. Be decisive and confident
8. Always end with responsible gambling reminder`

    // ============================================
    // STEP 4: BUILD MESSAGES
    // ============================================
    let userContent
    if (image) {
      userContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.type,
            data: image.base64,
          }
        },
        {
          type: 'text',
          text: question || 'Analyze this image and give me predictions'
        }
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    const conversationHistory = (messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.replace(/<[^>]*>/g, '').slice(0, 800)
          : m.content
      }))

    const allMessages = [
      ...conversationHistory,
      { role: 'user', content: userContent }
    ]

    // ============================================
    // STEP 5: STREAM FROM CLAUDE
    // ============================================
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
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

    // Stream the response directly to the client
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    const encoder = new TextEncoder()

    // Process Claude's stream
    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

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
                  const text = parsed.delta.text
                  fullText += text
                  await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
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
