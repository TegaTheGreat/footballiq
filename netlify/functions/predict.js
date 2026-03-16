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
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
    const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image, images } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const season = 2025

    // ============================================
    // STEP 1: GOOGLE SEARCH FOR LIVE DATA
    // ============================================
    let googleContext = ''

    if (GOOGLE_API_KEY && GOOGLE_CSE_ID) {
      try {
        const searchQueries = [
          `football fixtures today ${today} results scores`,
          `Premier League Bundesliga Serie A La Liga fixtures ${today}`,
          `Champions League Europa League results this week March 2026`,
          `football injury news team news March 2026`,
        ]

        // Add question-specific search
        if (question && question.length > 10) {
          const cleanQ = question.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 100)
          searchQueries.push(`${cleanQ} football 2026`)
        }

        const searchResults = await Promise.all(
          searchQueries.slice(0, 3).map(q =>
            fetch(
              `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(q)}&num=5&dateRestrict=d3`
            )
            .then(r => r.json())
            .catch(() => null)
          )
        )

        const snippets = []
        searchResults.forEach((result, idx) => {
          if (!result?.items) return
          result.items.forEach(item => {
            if (item.snippet) {
              snippets.push(`[${searchQueries[idx]}] ${item.title}: ${item.snippet}`)
            }
          })
        })

        if (snippets.length > 0) {
          googleContext = `\n=== LIVE GOOGLE SEARCH RESULTS (fetched right now) ===\n`
          googleContext += snippets.join('\n')
          googleContext += '\n=== END GOOGLE RESULTS ===\n'
        }
      } catch (e) {
        console.log('Google search error:', e.message)
      }
    }

    // ============================================
    // STEP 2: FETCH LIVE FIXTURES FROM ODDS API
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
      { key: 'soccer_brazil_campeonato', name: 'Brazilian Serie A' },
      { key: 'soccer_argentina_primera_division', name: 'Argentine Primera' },
      { key: 'soccer_saudi_professional_league', name: 'Saudi Pro League' },
    ]

    let fixturesContext = ''
    let totalFixtures = 0

    if (ODDS_API_KEY) {
      try {
        const fixtureRequests = sportsToFetch.map(sport =>
          fetch(
            `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`
          )
          .then(r => r.json())
          .catch(() => [])
        )

        const results = await Promise.all(fixtureRequests)

        results.forEach((fixtures, idx) => {
          if (!Array.isArray(fixtures) || fixtures.length === 0) return
          const sportName = sportsToFetch[idx].name
          fixturesContext += `\n=== ${sportName} ===\n`

          fixtures.forEach(fixture => {
            if (!fixture.home_team || !fixture.away_team) return
            totalFixtures++

            const date = new Date(fixture.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })

            let homeOdds = null, drawOdds = null, awayOdds = null
            if (fixture.bookmakers?.length > 0) {
              const bookmaker = fixture.bookmakers[0]
              const h2h = bookmaker.markets?.find(m => m.key === 'h2h')
              if (h2h) {
                homeOdds = h2h.outcomes?.find(o => o.name === fixture.home_team)?.price
                awayOdds = h2h.outcomes?.find(o => o.name === fixture.away_team)?.price
                drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price
              }
            }

            fixturesContext += `${date}: ${fixture.home_team} vs ${fixture.away_team}`
            if (homeOdds) {
              fixturesContext += ` | Home:${homeOdds} Draw:${drawOdds || 'N/A'} Away:${awayOdds}`
              if (homeOdds <= 1.4) fixturesContext += ` [STRONG FAVOURITE]`
              if (homeOdds >= 3.0 && awayOdds >= 3.0) fixturesContext += ` [OPEN MATCH]`
            }
            fixturesContext += '\n'
          })
        })
      } catch (e) {
        console.log('Odds API error:', e.message)
      }
    }

    // ============================================
    // STEP 3: FETCH STANDINGS FROM API-SPORTS
    // ============================================
    let standingsContext = ''

    if (APISPORTS_KEY) {
      try {
        const leagueIds = [39, 78, 135, 140, 61, 88, 144, 94, 179, 307]
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
                won: team.all?.win,
                drawn: team.all?.draw,
                lost: team.all?.lose,
                goalsFor: team.all?.goals?.for,
                goalsAgainst: team.all?.goals?.against,
                form: team.form || '',
                homeWon: team.home?.win,
                homePlayed: team.home?.played,
                homeGF: team.home?.goals?.for,
                homeGA: team.home?.goals?.against,
                awayWon: team.away?.win,
                awayPlayed: team.away?.played,
                awayGF: team.away?.goals?.for,
                awayGA: team.away?.goals?.against,
              })
            })
          })
        })

        standingsContext = '\n=== CURRENT STANDINGS & FORM ===\n'
        Object.entries(leagueGroups).forEach(([league, teams]) => {
          standingsContext += `\n${league}:\n`
          teams
            .sort((a, b) => a.position - b.position)
            .slice(0, 12)
            .forEach(t => {
              standingsContext += `${t.position}. ${t.team} | ${t.points}pts | W${t.won} D${t.drawn} L${t.lost} | GF${t.goalsFor} GA${t.goalsAgainst} | Form:${t.form} | HomeW:${t.homeWon}/${t.homePlayed} HomeGF:${t.homeGF} HomeGA:${t.homeGA} | AwayW:${t.awayWon}/${t.awayPlayed} AwayGF:${t.awayGF} AwayGA:${t.awayGA}\n`
            })
        })
      } catch (e) {
        console.log('Standings error:', e.message)
      }
    }

    // ============================================
    // STEP 4: BUILD SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You are warm, intelligent and conversational — like a brilliant friend who is also a professional analyst.

TODAY: ${today}

${googleContext ? `LIVE GOOGLE SEARCH DATA (searched right now):
${googleContext}` : ''}

${totalFixtures > 0
  ? `LIVE FIXTURES WITH REAL BETTING ODDS (${totalFixtures} matches):
${fixturesContext}`
  : 'Use your 2025/26 season knowledge for fixtures.'}

${standingsContext}

HOW YOU COMMUNICATE:
- Warm, intelligent and conversational — not robotic
- Think out loud and explain reasoning clearly
- Reference actual odds — "bookmakers have them at 1.65 which I agree with" or "at 3.2 that's actually great value"
- Remember everything in this conversation and build on it naturally
- Work through predictions section by section — never dump everything at once
- Show genuine enthusiasm for football
- Be honest when a pick is risky
- NEVER say you cannot access live data — you have Google search results, odds and standings above
- NEVER ask users to send screenshots before predicting
- Always complete your analysis fully — never cut off

FORMATTING:
- Use ## for main headers
- Use ### for sub headers
- Use **bold** for key picks and stats
- Use bullet points with - for lists
- Do NOT use --- as dividers
- For prediction tables use this exact HTML:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Odds</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>1.65</td><td>82%</td><td>Low</td></tr>
</tbody>
</table>
- Keep paragraphs tight — max 3 sentences
- Show combined odds calculations for accumulators

Always end with a brief responsible gambling note.`

    // ============================================
    // STEP 5: BUILD MESSAGES
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
    // STEP 6: CALL CLAUDE WITH STREAMING
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
    // STEP 7: STREAM RESPONSE TO CLIENT
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
