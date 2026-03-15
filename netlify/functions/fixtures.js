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
    const APISPORTS_KEY = process.env.APISPORTS_KEY
    const headers = {
      'x-apisports-key': APISPORTS_KEY,
    }

    const season = 2024
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
      307,  // Saudi Pro League
      2,    // Champions League
      3,    // Europa League
      848,  // Conference League
    ]

    // Get today and next 7 days
    const today = new Date()
    const nextWeek = new Date(today)
    nextWeek.setDate(today.getDate() + 7)
    const from = today.toISOString().split('T')[0]
    const to = nextWeek.toISOString().split('T')[0]

    // Fetch fixtures for all leagues in parallel
    const requests = leagueIds.map(leagueId =>
      fetch(`https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&from=${from}&to=${to}&status=NS`, {
        headers
      })
      .then(r => r.json())
      .catch(() => ({ response: [] }))
    )

    const results = await Promise.all(requests)

    const allFixtures = []
    results.forEach(data => {
      if (!data?.response) return
      data.response.forEach(f => {
        allFixtures.push({
          id: f.fixture?.id,
          date: f.fixture?.date,
          competition: f.league?.name,
          country: f.league?.country,
          homeTeam: f.teams?.home?.name,
          awayTeam: f.teams?.away?.name,
          homeLogo: f.teams?.home?.logo,
          awayLogo: f.teams?.away?.logo,
          venue: f.fixture?.venue?.name,
          status: f.fixture?.status?.long,
        })
      })
    })

    allFixtures.sort((a, b) => new Date(a.date) - new Date(b.date))

    return new Response(JSON.stringify({
      matches: allFixtures,
      total: allFixtures.length,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      matches: [],
    }), {
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
