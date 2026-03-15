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
    const APISPORTS_KEY = process.env.APISPORTS_KEY
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY

    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: 'Missing Anthropic API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question } = body

    // ============================================
    // SEASON DETECTION
    // March 2026 = European season 2025/26 = use 2025
    // Summer leagues (Brazil, Argentina) = use 2026
    // ============================================
    const now = new Date()
    const year = now.getFullYear() // 2026
    const month = now.getMonth() + 1 // 3 (March)

    const getSeasonForLeague = (leagueId) => {
      const summerLeagues = [71, 128, 262, 307] // Brazil, Argentina, Mexico, Saudi
      if (summerLeagues.includes(leagueId)) return year // 2026
      // European leagues started in Aug 2025 — season = 2025
      return month < 7 ? year - 1 : year // March 2026 → 2025
    }

    const today = now.toISOString().split('T')[0]
    const nextWeek = new Date(now)
    nextWeek.setDate(now.getDate() + 7)
    const to = nextWeek.toISOString().split('T')[0]

    const leagueIds = [
      39,   // Premier League
      40,   // Championship
      61,   // Ligue 1
      78,   // Bundesliga
      135,  // Serie A
      140,  // La Liga
      94,   // Primeira Liga
      88,   // Eredivisie
      144,  // Pro League Belgium
      179,  // Scottish Premiership
      307,  // Saudi Pro League
      2,    // Champions League
      3,    // Europa League
      848,  // Conference League
      128,  // Argentine Primera
      71,   // Brazilian Serie A
    ]

    // ============================================
    // STEP 1: FETCH FIXTURES FROM API-SPORTS
    // ============================================
    let allFixtures = []

    try {
      const fixtureRequests = leagueIds.map(id => {
        const season = getSeasonForLeague(id)
        return fetch(
          `https://v3.football.api-sports.io/fixtures?league=${id}&season=${season}&from=${today}&to=${to}`,
          {
            headers: {
              'x-apisports-key': APISPORTS_KEY,
              'x-rapidapi-key': APISPORTS_KEY,
              'x-rapidapi-host': 'v3.football.api-sports.io'
            }
          }
        )
        .then(r => r.json())
        .catch(() => ({ response: [] }))
      })

      const fixtureResults = await Promise.all(fixtureRequests)

      fixtureResults.forEach(data => {
        if (!data?.response || !Array.isArray(data.response)) return
        data.response.forEach(f => {
          if (!f?.teams?.home?.name || !f?.teams?.away?.name) return
          allFixtures.push({
            date: new Date(f.fixture?.date).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            }),
            home: f.teams.home.name,
            away: f.teams.away.name,
            league: f.league?.name || '',
            country: f.league?.country || '',
          })
        })
      })
    } catch (e) {
      console.log('API-Sports fixtures error:', e.message)
    }

    // ============================================
    // STEP 2: FALLBACK TO RAPIDAPI IF EMPTY
    // ============================================
    if (allFixtures.length === 0 && RAPIDAPI_KEY) {
      try {
        const rapidLeagues = [39, 78, 135, 140, 61, 94, 88]
        const rapidRequests = rapidLeagues.map(id => {
          const season = getSeasonForLeague(id)
          return fetch(
            `https://api-football-v1.p.rapidapi.com/v3/fixtures?league=${id}&season=${season}&from=${today}&to=${to}`,
            {
              headers: {
                'x-rapidapi-key': RAPIDAPI_KEY,
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
              }
            }
          )
          .then(r => r.json())
          .catch(() => ({ response: [] }))
        })

        const rapidResults = await Promise.all(rapidRequests)

        rapidResults.forEach(data => {
          if (!data?.response || !Array.isArray(data.response)) return
          data.response.forEach(f => {
            if (!f?.teams?.home?.name || !f?.teams?.away?.name) return
            allFixtures.push({
              date: new Date(f.fixture?.date).toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short',
                hour: '2-digit', minute: '2-digit'
              }),
              home: f.teams.home.name,
              away: f.teams.away.name,
              league: f.league?.name || '',
              country: f.league?.country || '',
            })
          })
        })
      } catch (e) {
        console.log('RapidAPI fixtures error:', e.message)
      }
    }

    // ============================================
    // STEP 3: FETCH STANDINGS FROM API-SPORTS
    // ============================================
    const teamStats = {}
    const recentResults = []

    try {
      const standingLeagues = [39, 78, 135, 140, 61, 94, 88, 144]

      const [standingResults, recentMatchResults] = await Promise.all([
        Promise.all(standingLeagues.map(id => {
          const season = getSeasonForLeague(id)
          return fetch(
            `https://v3.football.api-sports.io/standings?league=${id}&season=${season}`,
            { headers: { 'x-apisports-key': APISPORTS_KEY } }
          )
          .then(r => r.json())
          .catch(() => null)
        })),

        Promise.all([39, 78, 135, 140, 61].map(id => {
          const season = getSeasonForLeague(id)
          return fetch(
            `https://v3.football.api-sports.io/fixtures?league=${id}&season=${season}&status=FT&last=5`,
            { headers: { 'x-apisports-key': APISPORTS_KEY } }
          )
          .then(r => r.json())
          .catch(() => null)
        }))
      ])

      standingResults.forEach(data => {
        if (!data?.response) return
        data.response.forEach(league => {
          const standings = league.league?.standings?.[0]
          if (!standings) return
          standings.forEach(team => {
            if (!team?.team?.name) return
            teamStats[team.team.name] = {
              league: league.league?.name,
              position: team.rank,
              points: team.points,
              played: team.all?.played,
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
            }
          })
        })
      })

      recentMatchResults.forEach(data => {
        if (!data?.response) return
        data.response.forEach(f => {
          if (!f?.teams?.home?.name) return
          recentResults.push({
            date: new Date(f.fixture?.date).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short'
            }),
            home: f.teams.home.name,
            away: f.teams.away.name,
            score: `${f.goals?.home ?? '?'}-${f.goals?.away ?? '?'}`,
            ht: `${f.score?.halftime?.home ?? '?'}-${f.score?.halftime?.away ?? '?'}`,
            league: f.league?.name || '',
          })
        })
      })

    } catch (e) {
      console.log('Standings error:', e.message)
    }

    // ============================================
    // STEP 4: BUILD CONTEXT STRING FOR CLAUDE
    // ============================================
    let context = `DATE TODAY: ${today}\n`
    context += `SEASON: European leagues 2025/26 (season code 2025)\n\n`

    if (allFixtures.length > 0) {
      context += `UPCOMING FIXTURES (${allFixtures.length} matches found):\n`
      allFixtures.forEach(f => {
        const homeS = teamStats[f.home]
        const awayS = teamStats[f.away]
        context += `\n${f.date} | ${f.home} vs ${f.away} | ${f.league} (${f.country})\n`
        if (homeS) {
          context += `  HOME ${f.home}: Pos${homeS.position} | ${homeS.points}pts | W${homeS.won} D${homeS.drawn} L${homeS.lost} | GF${homeS.goalsFor} GA${homeS.goalsAgainst} | Form: ${homeS.form} | Home record: W${homeS.homeWon}/${homeS.homePlayed} GF${homeS.homeGF} GA${homeS.homeGA}\n`
        }
        if (awayS) {
          context += `  AWAY ${f.away}: Pos${awayS.position} | ${awayS.points}pts | W${awayS.won} D${awayS.drawn} L${awayS.lost} | GF${awayS.goalsFor} GA${awayS.goalsAgainst} | Form: ${awayS.form} | Away record: W${awayS.awayWon}/${awayS.awayPlayed} GF${awayS.awayGF} GA${awayS.awayGA}\n`
        }
      })
    } else {
      context += `NO FIXTURES FOUND: The API returned no upcoming fixtures for ${today} to ${to}.\n`
      context += `This is likely an international break weekend. Use your football knowledge to identify\n`
      context += `which matches ARE happening this weekend (March 15-16, 2026) across all major leagues,\n`
      context += `and provide predictions based on current 2025/26 season form and standings.\n`
      context += `Be explicit that you are using your training knowledge rather than live API data.\n`
    }

    if (recentResults.length > 0) {
      context += `\nRECENT RESULTS (last 5 per league):\n`
      recentResults.forEach(r => {
        context += `${r.date}: ${r.home} ${r.score} ${r.away} (HT: ${r.ht}) [${r.league}]\n`
      })
    }

    if (Object.keys(teamStats).length > 0) {
      context += `\nCURRENT STANDINGS (top 8 per league):\n`
      const leagueGroups = {}
      Object.entries(teamStats).forEach(([team, data]) => {
        if (!leagueGroups[data.league]) leagueGroups[data.league] = []
        leagueGroups[data.league].push({ team, ...data })
      })
      Object.entries(leagueGroups).forEach(([league, teams]) => {
        context += `\n${league}:\n`
        teams.sort((a, b) => a.position - b.position).slice(0, 8).forEach(t => {
          context += `  ${t.position}. ${t.team} | ${t.points}pts | GF${t.goalsFor} GA${t.goalsAgainst} | Form: ${t.form}\n`
        })
      })
    }

    // ============================================
    // STEP 5: BUILD SYSTEM PROMPT AND CALL CLAUDE
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor.

You have been provided with REAL live football data fetched directly from API-Sports and RapidAPI. This data is current as of today ${today}.

HERE IS THE LIVE DATA:
${context}

YOUR RULES:
1. Always base predictions on the data above
2. If no fixtures were found, use your knowledge of the 2025/26 season to identify this weekend's matches
3. Never refuse to make predictions — always provide analysis
4. For multiple predictions always use this exact HTML table format:
<table>
<thead>
<tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr>
</thead>
<tbody>
<tr><td>Arsenal vs Chelsea</td><td>Premier League</td><td>Arsenal Win</td><td>Match Result</td><td>74%</td><td>Low</td></tr>
</tbody>
</table>
5. Consider home advantage, form, goals scored, goals conceded, head to head
6. Be decisive — give clear confident recommendations
7. Always end with a brief responsible gambling reminder`

    // ============================================
    // STEP 6: CALL CLAUDE
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
        max_tokens: 3000,
        system: systemPrompt,
        messages: (messages || [{ role: 'user', content: question || 'Give me the best bets this weekend' }])
          .slice(-2)
          .map(m => ({
            role: m.role,
            content: typeof m.content === 'string'
              ? m.content.replace(/<[^>]*>/g, '').slice(0, 800)
              : m.content
          })),
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const data = await claudeResponse.json()

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}

export const config = {
  path: '/api/predict'
}
