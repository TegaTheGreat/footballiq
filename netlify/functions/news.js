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

    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const season = month < 7 ? year - 1 : year

    // Top leagues for injury news
    const leagueIds = [39, 78, 135, 140, 61, 94, 88, 144]

    // Fetch injuries for all leagues in parallel
    const injuryRequests = leagueIds.map(leagueId =>
      fetch(
        `https://v3.football.api-sports.io/injuries?league=${leagueId}&season=${season}`,
        { headers }
      )
      .then(r => r.json())
      .catch(() => ({ response: [] }))
    )

    const injuryResults = await Promise.all(injuryRequests)

    const news = []
    injuryResults.forEach(data => {
      if (!data?.response) return
      data.response.slice(0, 8).forEach(injury => {
        const player = injury.player?.name
        const team = injury.team?.name
        const type = injury.player?.type
        const reason = injury.player?.reason
        const fixture = injury.fixture?.date
          ? new Date(injury.fixture.date).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short'
            })
          : ''

        if (player && team) {
          news.push({
            title: `🚑 ${player} (${team}) — ${type || 'Injured'}${fixture ? ' for match on ' + fixture : ''}`,
            summary: reason || 'Out of upcoming fixtures',
            source: 'API-Sports',
            category: 'Injuries & Suspensions',
            publishedAt: new Date().toISOString(),
          })
        }
      })
    })

    return new Response(JSON.stringify({
      news: news.slice(0, 40),
      total: news.length,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      news: [],
      total: 0,
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
  path: '/api/news'
}
