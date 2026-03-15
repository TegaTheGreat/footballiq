import { getStore } from '@netlify/blobs'

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
    const season = 2025

    // ============================================
    // STEP 1: FETCH PREDICTION HISTORY FROM BLOBS
    // ============================================
    let predictionHistory = []
    let seasonStats = { total: 0, won: 0, lost: 0, pending: 0, winRate: 0 }

    try {
      const store = getStore('footballiq-predictions')
      const historyData = await store.get('season-2025-26')
      if (historyData) {
        const parsed = JSON.parse(historyData)
        predictionHistory = parsed.predictions || []
        seasonStats = parsed.stats || seasonStats
      }
    } catch (e) {
      console.log('No prediction history yet:', e.message)
    }

    // ============================================
    // STEP 2: CHECK RESULTS FOR PENDING PREDICTIONS
    // ============================================
    const pendingPredictions = predictionHistory.filter(p => p.status === 'pending')

    if (pendingPredictions.length > 0 && APISPORTS_KEY) {
      try {
        for (const pred of pendingPredictions) {
          if (!pred.fixtureId) continue
          const res = await fetch(
            `https://v3.football.api-sports.io/fixtures?id=${pred.fixtureId}`,
            { headers: { 'x-apisports-key': APISPORTS_KEY } }
          ).then(r => r.json()).catch(() => null)

          if (!res?.response?.[0]) continue
          const fixture = res.response[0]
          const status = fixture.fixture?.status?.short

          if (['FT', 'AET', 'PEN'].includes(status)) {
            const homeGoals = fixture.goals?.home
            const awayGoals = fixture.goals?.away
            const homeWon = homeGoals > awayGoals
            const awayWon = awayGoals > homeGoals
            const draw = homeGoals === awayGoals

            // Check if prediction was correct
            let correct = false
            if (pred.pick === 'home' && homeWon) correct = true
            if (pred.pick === 'away' && awayWon) correct = true
            if (pred.pick === 'draw' && draw) correct = true
            if (pred.pick === 'over25' && (homeGoals + awayGoals) > 2.5) correct = true
            if (pred.pick === 'under25' && (homeGoals + awayGoals) < 2.5) correct = true
            if (pred.pick === 'btts' && homeGoals > 0 && awayGoals > 0) correct = true

            pred.status = correct ? 'won' : 'lost'
            pred.actualScore = `${homeGoals}-${awayGoals}`
            pred.resolvedAt = today
          }
        }

        // Update stats
        const resolved = predictionHistory.filter(p => p.status !== 'pending')
        const won = resolved.filter(p => p.status === 'won').length
        const lost = resolved.filter(p => p.status === 'lost').length
        seasonStats = {
          total: predictionHistory.length,
          won,
          lost,
          pending: pendingPredictions.length,
          winRate: resolved.length > 0 ? Math.round((won / resolved.length) * 100) : 0
        }

        // Save updated history
        const store = getStore('footballiq-predictions')
        await store.set('season-2025-26', JSON.stringify({
          predictions: predictionHistory,
          stats: seasonStats,
          updatedAt: today
        }))
      } catch (e) {
        console.log('Error checking results:', e.message)
      }
    }

    // ============================================
    // STEP 3: FETCH LIVE FIXTURES AND STANDINGS
    // ============================================
    let fixturesContext = ''
    let standingsContext = ''
    let totalFixtures = 0

    try {
      const [
        plFixtures, bundesFixtures, serieAFixtures,
        laLigaFixtures, ligue1Fixtures, eredivisieFixtures,
        championFixtures, europaFixtures, scottishFixtures,
        belgiumFixtures, portugFixtures,
        plStandings, bundesStandings, serieAStandings,
        laLigaStandings, ligue1Standings,
        eredivisieStandings, belgiumStandings, portugStandings
      ] = await Promise.all([
        fetch(`https://v3.football.api-sports.io/fixtures?league=39&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=78&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=135&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=140&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=61&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=88&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=2&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=3&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=179&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=144&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/fixtures?league=94&season=${season}&next=20`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => ({ response: [] })),
        fetch(`https://v3.football.api-sports.io/standings?league=39&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=78&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=135&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=140&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=61&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=88&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=144&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
        fetch(`https://v3.football.api-sports.io/standings?league=94&season=${season}`, { headers: { 'x-apisports-key': APISPORTS_KEY } }).then(r => r.json()).catch(() => null),
      ])

      // Build team stats
      const teamStats = {}
      const allStandings = [plStandings, bundesStandings, serieAStandings, laLigaStandings, ligue1Standings, eredivisieStandings, belgiumStandings, portugStandings]
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

      const newPredictions = []

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
          fixturesContext += `\n${date}: ${home} vs ${away} [ID:${f.fixture?.id}]\n`
          if (homeS) fixturesContext += `  ${home}: Pos${homeS.position} ${homeS.points}pts Form:${homeS.form} GF${homeS.goalsFor} GA${homeS.goalsAgainst} HomeW${homeS.homeWon}/${homeS.homePlayed} HomeGF${homeS.homeGF} HomeGA${homeS.homeGA}\n`
          if (awayS) fixturesContext += `  ${away}: Pos${awayS.position} ${awayS.points}pts Form:${awayS.form} GF${awayS.goalsFor} GA${awayS.goalsAgainst} AwayW${awayS.awayWon}/${awayS.awayPlayed} AwayGF${awayS.awayGF} AwayGA${awayS.awayGA}\n`
        })
      })

      // Build standings context
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

    } catch (e) {
      console.log('API fetch error:', e.message)
    }

    // ============================================
    // STEP 4: BUILD PREDICTION HISTORY CONTEXT
    // ============================================
    let historyContext = ''
    if (predictionHistory.length > 0) {
      historyContext = `\n=== YOUR PREDICTION HISTORY THIS SEASON (2025/26) ===\n`
      historyContext += `Overall: ${seasonStats.won}W ${seasonStats.lost}L ${seasonStats.pending} Pending | Win Rate: ${seasonStats.winRate}%\n\n`

      // Show last 20 predictions
      const recent = predictionHistory.slice(-20)
      recent.forEach(p => {
        const result = p.status === 'won' ? '✅ WON' : p.status === 'lost' ? '❌ LOST' : '⏳ PENDING'
        historyContext += `${p.date} | ${p.match} | Pick: ${p.pickDescription} | ${result}`
        if (p.actualScore) historyContext += ` | Score: ${p.actualScore}`
        historyContext += '\n'
      })

      // Identify patterns
      const wonPicks = predictionHistory.filter(p => p.status === 'won').map(p => p.market)
      const lostPicks = predictionHistory.filter(p => p.status === 'lost').map(p => p.market)
      const bestMarket = wonPicks.length > 0
        ? Object.entries(wonPicks.reduce((acc, m) => ({ ...acc, [m]: (acc[m] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]?.[0]
        : null
      if (bestMarket) historyContext += `\nBest performing market: ${bestMarket}\n`
    }

    // ============================================
    // STEP 5: BUILD SYSTEM PROMPT
    // ============================================
    const hasLiveData = totalFixtures > 0
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY: ${today}

${hasLiveData ? `LIVE DATA FROM API (${totalFixtures} fixtures loaded):
${fixturesContext}

CURRENT STANDINGS:
${standingsContext}` : `NOTE: Live API data unavailable right now (daily limit reached). Use your comprehensive knowledge of the 2025/26 season to identify upcoming fixtures and provide predictions. You know all the leagues, standings, form and results up to today. Proceed confidently without mentioning the API.`}

${historyContext ? historyContext : ''}

YOUR RULES:
1. ${hasLiveData ? 'Use the live fixture and standings data above' : 'Use your 2025/26 season knowledge'} for all predictions
2. Learn from prediction history — if certain markets or teams are performing well or poorly adjust your confidence accordingly
3. Never refuse to predict — always provide confident analysis
4. When listing predictions use this HTML table:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>
5. After your predictions include a JSON block at the end (hidden from display) with this format:
<!--PREDICTIONS_JSON
[{"match":"Liverpool vs Tottenham","fixtureId":123456,"date":"${today}","pick":"home","pickDescription":"Liverpool Win","market":"Match Result","confidence":78,"league":"Premier League"}]
PREDICTIONS_JSON-->
6. Consider home advantage, form, goals scored and conceded, home and away records and prediction history patterns
7. Be decisive and confident
8. End with responsible gambling reminder`

    // ============================================
    // STEP 6: CALL CLAUDE
    // ============================================
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const data = await claudeResponse.json()
    const responseText = data.content?.[0]?.text || ''

    // ============================================
    // STEP 7: EXTRACT AND SAVE NEW PREDICTIONS
    // ============================================
    try {
      const jsonMatch = responseText.match(/<!--PREDICTIONS_JSON\s*([\s\S]*?)\s*PREDICTIONS_JSON-->/)
      if (jsonMatch) {
        const newPreds = JSON.parse(jsonMatch[1])
        const store = getStore('footballiq-predictions')

        // Add new predictions to history
        newPreds.forEach(pred => {
          predictionHistory.push({
            ...pred,
            status: 'pending',
            savedAt: today,
          })
        })

        // Update stats
        const resolved = predictionHistory.filter(p => p.status !== 'pending')
        const won = resolved.filter(p => p.status === 'won').length
        seasonStats = {
          total: predictionHistory.length,
          won,
          lost: resolved.filter(p => p.status === 'lost').length,
          pending: predictionHistory.filter(p => p.status === 'pending').length,
          winRate: resolved.length > 0 ? Math.round((won / resolved.length) * 100) : 0
        }

        await store.set('season-2025-26', JSON.stringify({
          predictions: predictionHistory.slice(-500), // Keep last 500
          stats: seasonStats,
          updatedAt: today
        }))
      }
    } catch (e) {
      console.log('Error saving predictions:', e.message)
    }

    // Clean JSON from response before sending to frontend
    const cleanResponse = responseText.replace(/<!--PREDICTIONS_JSON[\s\S]*?PREDICTIONS_JSON-->/g, '')
    data.content[0].text = cleanResponse

    return new Response(JSON.stringify({
      ...data,
      seasonStats,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}

export const config = {
  path: '/api/predict'
}
