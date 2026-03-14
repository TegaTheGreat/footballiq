export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const url = new URL(req.url)
    const competition = url.searchParams.get('competition') || 'PL'
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')

    // Get today and next 7 days if no dates provided
    const today = new Date()
    const nextWeek = new Date(today)
    nextWeek.setDate(today.getDate() + 7)

    const from = dateFrom || today.toISOString().split('T')[0]
    const to = dateTo || nextWeek.toISOString().split('T')[0]

    // Fetch from multiple leagues in parallel
    const leagues = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'PPL', 'DED', 'BSA']
    
    const requests = leagues.map(league => 
      fetch(`https://api.football-data.org/v4/competitions/${league}/matches?dateFrom=${from}&dateTo=${to}&status=SCHEDULED`, {
        headers: {
          'X-Auth-Token': process.env.FOOTBALL_DATA_KEY,
        }
      }).then(r => r.json()).catch(() => ({ matches: [] }))
    )

    const results = await Promise.all(requests)
    
    // Combine all matches
    const allMatches = results.flatMap(r => r.matches || [])

    // Sort by date
    allMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))

    return new Response(JSON.stringify({ matches: allMatches }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
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
