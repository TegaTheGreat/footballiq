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
    const leagues = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'PPL', 'DED']

    // Fetch standings + recent results for all leagues in parallel
    const [standingsResults, matchResults] = await Promise.all([
      // Standings for each league
      Promise.all(leagues.map(league =>
        fetch(`https://api.football-data.org/v4/competitions/${league}/standings`, {
          headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY }
        }).then(r => r.json()).catch(() => null)
      )),
      // Last 10 finished matches per league
      Promise.all(leagues.map(league =>
        fetch(`https://api.football-data.org/v4/competitions/${league}/matches?status=FINISHED&limit=10`, {
          headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY }
        }).then(r => r.json()).catch(() => null)
      ))
    ])

    // Build team profiles from standings
    const teamProfiles = {}

    standingsResults.forEach((data, i) => {
      if (!data || !data.standings) return
      const league = leagues[i]

      data.standings.forEach(standing => {
        if (standing.type !== 'TOTAL') return
        standing.table.forEach(row => {
          const teamName = row.team.name
          teamProfiles[teamName] = {
            league,
            position: row.position,
            played: row.playedGames,
            won: row.won,
            draw: row.draw,
            lost: row.lost,
            goalsFor: row.goalsFor,
            goalsAgainst: row.goalsAgainst,
            goalDifference: row.goalDifference,
            points: row.points,
            form: row.form || '',
          }
        })
      })
    })

    // Build recent results
    const recentResults = []
    matchResults.forEach(data => {
      if (!data || !data.matches) return
      data.matches.forEach(match => {
        recentResults.push({
          date: match.utcDate,
          competition: match.competition.name,
          home: match.homeTeam.name,
          away: match.awayTeam.name,
          homeScore: match.score.fullTime.home,
          awayScore: match.score.fullTime.away,
          halfTimeHome: match.score.halfTime?.home,
          halfTimeAway: match.score.halfTime?.away,
        })
      })
    })

    // Sort recent results by date descending
    recentResults.sort((a, b) => new Date(b.date) - new Date(a.date))

    return new Response(JSON.stringify({
      teamProfiles,
      recentResults: recentResults.slice(0, 100),
      leaguesCovered: leagues,
    }), {
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
  path: '/api/standings'
}
