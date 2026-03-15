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
    const season = 2024

    // Fetch injuries and sidelined players for top leagues
    const leagueIds = [39, 78, 135, 140, 61]

    const injuryRequests = leagueIds.map(leagueId =>
      fetch(`https://v3.football.api-sports.io/injuries?league=${leagueId}&season=${season}`, {
        headers
      })
      .then(r => r.json())
      .catch(() => ({ response: [] }))
    )

    const injuryResults = await Promise.all(injuryRequests)

    // Format injury news
    const news = []
    injuryResults.forEach(data => {
      if (!data?.response) return
      data.response.slice(0, 10).forEach(injury => {
        const player = injury.player?.name
        const team = injury.team?.name
        const type = injury.player?.type
        const reason = injury.player?.reason
        if (player && team) {
          news.push({
            title: `${player} (${team}) — ${type || 'Injury'}`,
            summary: reason || 'Out of upcoming fixtures',
            source: 'API-Sports Injuries',
            category: 'Injuries & Suspensions',
            publishedAt: new Date().toISOString(),
          })
        }
      })
    })

    // Also fetch head to head context for top fixtures
    return new Response(JSON.stringify({
      news: news.slice(0, 30),
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
