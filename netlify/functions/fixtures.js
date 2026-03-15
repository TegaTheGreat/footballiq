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

    // Fetch next 20 fixtures per league — no date or status filter
    const requests = leagueIds.map(leagueId => {
      // Season logic — European leagues started Aug 2025 = season 2025
      // South American leagues use current year
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const southAmerican = [71, 128, 262]
      const summer = [307]
      const season = southAmerican.includes(leagueId) || summer.includes(leagueId)
        ? year
        : month < 7 ? year - 1 : year

      return fetch(
        `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&next=20`,
        { headers: { 'x-apisports-key': APISPORTS_KEY } }
      )
      .then(r => r.json())
      .catch(() => ({ response: [] }))
    })

    const results = await Promise.all(requests)

    const allFixtures = []
    results.forEach(data => {
      if (!data?.response) return
      data.response.forEach(f => {
        if (!f?.teams?.home?.name) return
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
```

Commit → **Trigger deploy** → then open this in your browser to test:
```
https://theoddscity.netlify.app/api/fixtures
