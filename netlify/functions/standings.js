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

    const getSeasonForLeague = (leagueId) => {
      const southAmericanLeagues = [71, 128, 262]
      const summerLeagues = [307]
      if (southAmericanLeagues.includes(leagueId) || summerLeagues.includes(leagueId)) {
        return year
      }
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
      128,  // Argentine Primera
      71,   // Brazilian Serie A
    ]

    // Fetch standings and recent results in parallel
    const [standingsResults, recentMatchResults] = await Promise.all([

      // Standings for all leagues
      Promise.all(leagueIds.map(leagueId => {
        const season = getSeasonForLeague(leagueId)
        return fetch(
          `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`,
          { headers }
        )
        .then(r => r.json())
        .catch(() => null)
      })),

      // Recent finished matches
      Promise.all(leagueIds.slice(0, 8).map(leagueId => {
        const season = getSeasonForLeague(leagueId)
        return fetch(
          `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&status=FT&last=10`,
          { headers }
        )
        .then(r => r.json())
        .catch(() => null)
      }))
    ])

    // Build team profiles from standings
    const teamProfiles = {}
    standingsResults.forEach(data => {
      if (!data?.response) return
      data.response.forEach(league => {
        league.league?.standings?.forEach(group => {
          group.forEach(team => {
            teamProfiles[team.team?.name] = {
              league: league.league?.name,
              position: team.rank,
              played: team.all?.played,
              won: team.all?.win,
              drawn: team.all?.draw,
              lost: team.all?.lose,
              goalsFor: team.all?.goals?.for,
              goalsAgainst: team.all?.goals?.against,
              goalDifference: team.goalsDiff,
              points: team.points,
              form: team.form || '',
              homeWon: team.home?.win,
              homePlayed: team.home?.played,
              homeGoalsFor: team.home?.goals?.for,
              homeGoalsAgainst: team.home?.goals?.against,
              awayWon: team.away?.win,
              awayPlayed: team.away?.played,
              awayGoalsFor: team.away?.goals?.for,
              awayGoalsAgainst: team.away?.goals?.against,
            }
          })
        })
      })
    })

    // Build recent results
    const allResults = []
    recentMatchResults.forEach(data => {
      if (!data?.response) return
      data.response.forEach(f => {
        allResults.push({
          date: f.fixture?.date,
          competition: f.league?.name,
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          homeScore: f.goals?.home,
          awayScore: f.goals?.away,
          halfTimeHome: f.score?.halftime?.home,
          halfTimeAway: f.score?.halftime?.away,
          homeWinner: f.teams?.home?.winner,
        })
      })
    })

    allResults.sort((a, b) => new Date(b.date) - new Date(a.date))

    return new Response(JSON.stringify({
      teamProfiles,
      recentResults: allResults.slice(0, 100),
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      teamProfiles: {},
      recentResults: [],
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
  path: '/api/standings'
}
