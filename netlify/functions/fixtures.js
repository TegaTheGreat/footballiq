export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY

    // Get today and next 7 days
    const today = new Date()
    const nextWeek = new Date(today)
    nextWeek.setDate(today.getDate() + 7)
    const from = today.toISOString().split('T')[0]
    const to = nextWeek.toISOString().split('T')[0]

    // League IDs for Free API Live Football Data
    const leagueIds = [
      39,   // Premier League
      40,   // Championship
      41,   // League One
      61,   // Ligue 1
      78,   // Bundesliga
      135,  // Serie A
      140,  // La Liga
      94,   // Primeira Liga
      88,   // Eredivisie
      144,  // Pro League Belgium
      307,  // Saudi Pro League
      128,  // Argentine Primera
      262,  // Liga MX
      2,    // Champions League
      3,    // Europa League
      848,  // Conference League
    ]

    // Fetch fixtures for all leagues in parallel
    const fixtureRequests = leagueIds.map(leagueId =>
      fetch(`https://free-api-live-football-data.p.rapidapi.com/football-get-all-fixtures-by-league?leagueid=${leagueId}&from=${from}&to=${to}`, {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'free-api-live-football-data.p.rapidapi.com',
        }
      }).then(r => r.json()).catch(() => ({ response: [] }))
    )

    const results = await Promise.all(fixtureRequests)

    // Combine and format all fixtures
    const allFixtures = []
    results.forEach(data => {
      if (data?.response && Array.isArray(data.response)) {
        data.response.forEach(fixture => {
          allFixtures.push({
            id: fixture.fixture?.id,
            date: fixture.fixture?.date,
            competition: fixture.league?.name,
            country: fixture.league?.country,
            homeTeam: fixture.teams?.home?.name,
            awayTeam: fixture.teams?.away?.name,
            venue: fixture.fixture?.venue?.name,
            status: fixture.fixture?.status?.long,
          })
        })
      }
    })

    // Sort by date
    allFixtures.sort((a, b) => new Date(a.date) - new Date(b.date))

    return new Response(JSON.stringify({ matches: allFixtures }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, matches: [] }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}

export const config = {
  path: '/api/fixtures'
}
