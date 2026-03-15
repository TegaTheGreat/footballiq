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

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // Fetch fixtures and standings simultaneously
    const [
      plFixtures, bundesFixtures, serieAFixtures,
      laLigaFixtures, ligue1Fixtures, eredivisieFixtures,
      championFixtures, europaFixtures,
      scottishFixtures, belgiumFixtures, portugFixtures,
      plStandings, bundesStandings, serieAStandings,
      laLigaStandings, ligue1Standings,
      eredivisieStandings, belgiumStandings, portugStandings
    ] = await Promise.all([
      // Fixtures — next 20 per league
      fetch('https://v3.football.api-sports.io/fixtures?league=39&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=78&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=135&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=140&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=61&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=88&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=2&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=3&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=179&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=144&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
      fetch('https://v3.football.api-sports.io/fixtures?league=94&season=2025&next=20', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),

      // Standings
      fetch('https://v3.football.api-sports.io/standings?league=39&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=78&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=135&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=140&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=61&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=88&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=144&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      fetch('https://v3.football.api-sports.io/standings?league=94&season=2025', { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
    ])

    // Build team stats lookup from standings
    const teamStats = {}
    const allStandings = [
      plStandings, bundesStandings, serieAStandings,
      laLigaStandings, ligue1Standings, eredivisieStandings,
      belgiumStandings, portugStandings
    ]

    allStandings.forEach(data => {
      if (!data?.response) return
      data.response.forEach(league => {
        league.league?.standings?.[0]?.forEach(team => {
          if (!team?.team?.name) return
          teamStats[team.team.name] = {
            league: league.league?.name,
            position: team.rank,
            points: team.points,
            played: team.all?.played,
            won: team.all?.win,
            drawn: team.all?.draw,
            lost: team.all?.lose,
            goalsFor: team.all?.goals?.for,
            goalsAgainst: team.all?.goals?.against,
            form: team.form || '',
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

    // Build fixtures context
    const allFixtureSets = [
      { data: plFixtures, name: 'Premier League' },
      { data: bundesFixtures, name: 'Bundesliga' },
      { data: serieAFixtures, name: 'Serie A' },
      { data: laLigaFixtures, name: 'La Liga' },
      { data: ligue1Fixtures, name: 'Ligue 1' },
      { data: eredivisieFixtures, name: 'Eredivisie' },
      { data: championFixtures, name: 'Champions League' },
      { data: europaFixtures, name: 'Europa League' },
      { data: scottishFixtures, name: 'Scottish Premiership' },
      { data: belgiumFixtures, name: 'Pro League Belgium' },
      { data: portugFixtures, name: 'Primeira Liga' },
    ]

    let fixturesContext = ''
    let totalFixtures = 0

    allFixtureSets.forEach(({ data, name }) => {
      if (!data?.response?.length) return
      fixturesContext += `\n=== ${name} ===\n`
      data.response.forEach(f => {
        if (!f?.teams?.home?.name) return
        totalFixtures++
        const date = new Date(f.fixture?.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit'
        })
        const home = f.teams.home.name
        const away = f.teams.away.name
        const homeS = teamStats[home]
        const awayS = teamStats[away]
        fixturesContext += `\n${date}: ${home} vs ${away}\n`
        if (homeS) {
          fixturesContext += `  ${home}: Pos${homeS.position} | ${homeS.points}pts | W${homeS.won} D${homeS.drawn} L${homeS.lost} | GF${homeS.goalsFor} GA${homeS.goalsAgainst} | Form:${homeS.form} | HomeW:${homeS.homeWon}/${homeS.homePlayed} HomeGF:${homeS.homeGF} HomeGA:${homeS.homeGA}\n`
        }
        if (awayS) {
          fixturesContext += `  ${away}: Pos${awayS.position} | ${awayS.points}pts | W${awayS.won} D${awayS.drawn} L${awayS.lost} | GF${awayS.goalsFor} GA${awayS.goalsAgainst} | Form:${awayS.form} | AwayW:${awayS.awayWon}/${awayS.awayPlayed} AwayGF:${awayS.awayGF} AwayGA:${awayS.awayGA}\n`
        }
      })
    })

    // Build standings context
    let standingsContext = '\n=== CURRENT STANDINGS (Top 10 per league) ===\n'
    const leagueGroups = {}
    Object.entries(teamStats).forEach(([team, data]) => {
      if (!leagueGroups[data.league]) leagueGroups[data.league] = []
      leagueGroups[data.league].push({ team, ...data })
    })
    Object.entries(leagueGroups).forEach(([league, teams]) => {
      standingsContext += `\n${league}:\n`
      teams.sort((a, b) => a.position - b.position).slice(0, 10).forEach(t => {
        standingsContext += `${t.position}. ${t.team} | ${t.points}pts | GF${t.goalsFor} GA${t.goalsAgainst} | Form:${t.form}\n`
      })
    })

    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY: ${today} (Sunday March 15 2026)

REAL LIVE DATA FROM API-SPORTS (${totalFixtures} upcoming fixtures loaded):

${fixturesContext}

${standingsContext}

YOUR RULES:
1. Use the fixture and standings data above for all predictions
2. You can predict for today, tomorrow, this week or any upcoming fixture in the data
3. Never say you have no data
4. For multiple predictions always use this exact HTML table:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>
5. Consider home advantage, form, goals scored and conceded, home and away records
6. Be decisive and confident
7. Always end with a responsible gambling reminder`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        messages: (messages || [{ role: 'user', content: question }])
          .slice(-2)
          .map(m => ({
            role: m.role,
            content: typeof m.content === 'string'
              ? m.content.replace(/<[^>]*>/g, '').slice(0, 1000)
              : m.content
          })),
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const data = await claudeResponse.json()

    return new Response(JSON.stringify(data), {
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
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

export const config = {
  path: '/api/predict'
}
