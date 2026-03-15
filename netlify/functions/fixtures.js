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
    const headers = { 'x-apisports-key': APISPORTS_KEY }

    // Smart season detection — football seasons vary by league
    const now = new Date()
    const month = now.getMonth() + 1 // 1-12
    const year = now.getFullYear()

    // Most European leagues run Aug-May, so after June use current year
    // South American leagues run Feb-Dec, so use current year always
    const getSeasonForLeague = (leagueId) => {
      const southAmericanLeagues = [71, 128, 262] // Brazil, Argentina, Mexico
      const summerLeagues = [307] // Saudi runs Feb-Nov
      
      if (southAmericanLeagues.includes(leagueId) || summerLeagues.includes(leagueId)) {
        return year
      }
      // European leagues — if before July use previous year as season start
      return month < 7 ? year - 1 : year
    }

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
      179,  // Scottish Premiership
      218,  // Austrian Bundesliga
      2,    // Champions League
      3,    // Europa League
      848,  // Conference League
      128,  // Argentine Primera
      71,   // Brazilian Serie A
    ]

    // Get date range — today to next 7 days
    const today = now.toISOString().split('T')[0]
    const nextWeek = new Date(now)
    nextWeek.setDate(now.getDate() + 7)
    const to = nextWeek.toISOString().split('T')[0]

    // Fetch fixtures for all leagues in parallel
    const requests = leagueIds.map(leagueId => {
      const season = getSeasonForLeague(leagueId)
      return fetch(
        `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&from=${today}&to=${to}&status=NS`,
        { headers }
      )
      .then(r => r.json())
      .catch(() => ({ response: [] }))
    })

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
