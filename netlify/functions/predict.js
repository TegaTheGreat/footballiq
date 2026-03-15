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

    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: 'Missing Anthropic API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const text = await req.text()
    const body = JSON.parse(text)
    const { messages, question } = body

    // Smart season detection
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const europeanSeason = month < 7 ? year - 1 : year

    const getSeasonForLeague = (leagueId) => {
      const summerLeagues = [71, 128, 262, 307]
      return summerLeagues.includes(leagueId) ? year : europeanSeason
    }

    const leagueIds = [
      39, 40,   // Premier League, Championship
      61,       // Ligue 1
      78,       // Bundesliga
      135,      // Serie A
      140,      // La Liga
      94,       // Primeira Liga
      88,       // Eredivisie
      144,      // Pro League Belgium
      307,      // Saudi Pro League
      179,      // Scottish Premiership
      2, 3,     // Champions League, Europa League
    ]

    const today = now.toISOString().split('T')[0]
    const nextWeek = new Date(now)
    nextWeek.setDate(now.getDate() + 7)
    const to = nextWeek.toISOString().split('T')[0]

    // Fetch fixtures, standings and recent results in parallel
    const [fixtureResults, standingResults, recentResults] = await Promise.all([

      // Fixtures for next 7 days
      Promise.all(leagueIds.map(id => {
        const season = getSeasonForLeague(id)
        return fetch(
          `https://v3.football.api-sports.io/fixtures?league=${id}&season=${season}&from=${today}&to=${to}&status=NS`,
          { headers: { 'x-apisports-key': APISPORTS_KEY } }
        ).then(r => r.json()).catch(() => ({ response: [] }))
      })),

      // Current standings
      Promise.all([39, 78, 135, 140, 61, 94, 88].map(id => {
        const season = getSeasonForLeague(id)
        return fetch(
          `https://v3.football.api-sports.io/standings?league=${id}&season=${season}`,
          { headers: { 'x-apisports-key': APISPORTS_KEY } }
        ).then(r => r.json()).catch(() => null)
      })),

      // Recent results last 7 days
      Promise.all([39, 78, 135, 140, 61].map(id => {
        const season = getSeasonForLeague(id)
        return fetch(
          `https://v3.football.api-sports.io/fixtures?league=${id}&season=${season}&status=FT&last=5`,
          { headers: { 'x-apisports-key': APISPORTS_KEY } }
        ).then(r => r.json()).catch(() => null)
      })),
    ])

    // Process fixtures
    const allFixtures = []
    fixtureResults.forEach(data => {
      if (!data?.response) return
      data.response.forEach(f => {
        allFixtures.push({
          date: new Date(f.fixture?.date).toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          }),
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          league: f.league?.name,
          country: f.league?.country,
          venue: f.fixture?.venue?.name,
        })
      })
    })

    // Process standings
    const teamStats = {}
    standingResults.forEach(data => {
      if (!data?.response) return
      data.response.forEach(league => {
        league.league?.standings?.[0]?.forEach(team => {
          teamStats[team.team?.name] = {
            league: league.league?.name,
            position: team.rank,
            points: team.points,
            played: team.all?.played,
            won: team.all?.win,
            drawn: team.all?.draw,
            lost: team.all?.lose,
            goalsFor: team.all?.goals?.for,
            goalsAgainst: team.all?.goals?.against,
            form: team.form,
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

    // Process recent results
    const allRecent = []
    recentResults.forEach(data => {
      if (!data?.response) return
      data.response.forEach(f => {
        allRecent.push({
          date: new Date(f.fixture?.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          score: `${f.goals?.home}-${f.goals?.away}`,
          ht: `${f.score?.halftime?.home}-${f.score?.halftime?.away}`,
          league: f.league?.name,
        })
      })
    })

    // Build rich context string
    let context = `TODAY: ${today}\n\n`

    if (allFixtures.length > 0) {
      context += `UPCOMING FIXTURES (${allFixtures.length} matches):\n`
      allFixtures.forEach(f => {
        const homeS = teamStats[f.home]
        const awayS = teamStats[f.away]
        context += `\n${f.date} | ${f.home} vs ${f.away} | ${f.league}\n`
        if (homeS) {
          context += `  ${f.home}: P${homeS.position} ${homeS.points}pts | W${homeS.won} D${homeS.drawn} L${homeS.lost} | GF${homeS.goalsFor} GA${homeS.goalsAgainst} | Form:${homeS.form} | HomeW:${homeS.homeWon}/${homeS.homePlayed} HomeGF:${homeS.homeGF} HomeGA:${homeS.homeGA}\n`
        }
        if (awayS) {
          context += `  ${f.away}: P${awayS.position} ${awayS.points}pts | W${awayS.won} D${awayS.drawn} L${awayS.lost} | GF${awayS.goalsFor} GA${awayS.goalsAgainst} | Form:${awayS.form} | AwayW:${awayS.awayWon}/${awayS.awayPlayed} AwayGF:${awayS.awayGF} AwayGA:${awayS.awayGA}\n`
        }
      })
    } else {
      context += 'No upcoming fixtures found in database for next 7 days.\n'
    }

    if (allRecent.length > 0) {
      context += `\nRECENT RESULTS:\n`
      allRecent.forEach(r => {
        context += `${r.date}: ${r.home} ${r.score} ${r.away} (HT:${r.ht}) [${r.league}]\n`
      })
    }

    // Build final system prompt with injected data
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor.

You have been given REAL LIVE football data fetched directly from the API-Sports database RIGHT NOW. This data is accurate and current. Use it to make your predictions.

LIVE DATA:
${context}

INSTRUCTIONS:
- Base ALL predictions strictly on the data above
- Never say you don't have data — you have it above
- When giving multiple predictions use HTML tables
- Table format: <table><thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead><tbody>...</tbody></table>
- Be decisive and confident
- Consider form, goals scored/conceded, home/away records
- End with responsible gambling reminder`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 3000,
        system: systemPrompt,
        messages: (messages || [{ role: 'user', content: question || 'Give me the best bets this weekend' }])
          .slice(-2)
          .map(m => ({
            role: m.role,
            content: typeof m.content === 'string'
              ? m.content.replace(/<[^>]*>/g, '').slice(0, 500)
              : m.content
          })),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const data = await response.json()

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
