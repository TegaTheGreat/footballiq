// =============================================================
// api/refresh.js — Daily automated data refresh
// Triggered by Vercel Cron at 7am every day
// Also callable manually: /api/refresh?force=true
// =============================================================

import { cacheGet, cacheSet } from './_cache.js'
import { saveIntelligence, saveOddsSnapshot, sql } from './db.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const today = new Date().toISOString().split('T')[0]

    const forceParam = (req.query?.force || '').toLowerCase()
    const forceAll = forceParam === 'true'
    const forceOdds = forceAll || forceParam.includes('odds')
    const forceStandings = forceAll || forceParam.includes('standings')
    const forceContext = forceAll || forceParam.includes('context')
    const forceResults = forceAll || forceParam.includes('results')
    const forcePredictions = forceAll || forceParam.includes('predictions')

    const results = {
      odds: { refreshed: false, reason: '', fixtures: 0 },
      standings: { refreshed: false, reason: '', leagues: 0 },
      context: { refreshed: false, reason: '', chars: 0 },
      results: { refreshed: false, reason: '', checked: 0 },
      predictions: { refreshed: false, reason: '', resolved: 0 },
      timestamp: new Date().toISOString(),
    }

    async function hoursSince(key) {
      const ts = await cacheGet(key)
      if (!ts) return 9999
      return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60)
    }

    async function geminiSearch(prompt, timeoutMs = 55000) {
      if (!GEMINI_API_KEY) return ''
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
          {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
            }),
          }
        )

        if (!response.ok) {
          clearTimeout(timeout)
          const err = await response.text()
          return `ERROR:${response.status}:${err.slice(0, 100)}`
        }

        let collected = ''
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const jsonStr = line.slice(6).trim()
              if (!jsonStr || jsonStr === '[DONE]') continue
              try {
                const parsed = JSON.parse(jsonStr)
                const parts = parsed?.candidates?.[0]?.content?.parts
                if (parts) for (const p of parts) { if (p.text) collected += p.text }
              } catch (_) {}
            }
          }
        } catch (streamErr) {
          if (streamErr.name !== 'AbortError') console.log('Stream error:', streamErr.message)
        }

        clearTimeout(timeout)
        return collected
      } catch (e) {
        clearTimeout(timeout)
        return ''
      }
    }

    // ============================================
    // STEP 1: FETCH ODDS — All markets
    // ============================================
    const oddsAge = await hoursSince('odds:updated_at')

    if (forceOdds || oddsAge > 48) {
      if (!ODDS_API_KEY) {
        results.odds.reason = 'No API key'
      } else {
        try {
          const sports = [
            { key: 'soccer_epl', name: 'Premier League' },
            { key: 'soccer_uefa_champs_league', name: 'Champions League' },
            { key: 'soccer_uefa_europa_league', name: 'Europa League' },
            { key: 'soccer_uefa_europa_conference_league', name: 'Conference League' },
            { key: 'soccer_spain_la_liga', name: 'La Liga' },
            { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
            { key: 'soccer_italy_serie_a', name: 'Serie A' },
            { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
            { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
            { key: 'soccer_belgium_first_div', name: 'Belgian Pro League' },
            { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
            { key: 'soccer_scotland_premiership', name: 'Scottish Premiership' },
            { key: 'soccer_saudi_professional_league', name: 'Saudi Pro League' },
            { key: 'soccer_brazil_campeonato', name: 'Brazilian Serie A' },
            { key: 'soccer_argentina_primera_division', name: 'Argentine Primera' },
          ]

          // Fetch H2H + totals (over/under) + btts in parallel per league
          const allOdds = []
          for (let i = 0; i < sports.length; i += 5) {
            const batch = sports.slice(i, i + 5)
            const batchResults = await Promise.all(
              batch.flatMap(s => [
                fetch(`https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h,totals,btts&dateFormat=iso&oddsFormat=decimal`)
                  .then(r => r.ok ? r.json() : [])
                  .catch(() => [])
              ])
            )
            batchResults.forEach((fixtures, idx) => {
              allOdds.push({ league: batch[idx].name, fixtures: Array.isArray(fixtures) ? fixtures : [] })
            })
          }

          let oddsText = ''
          let total = 0

          for (const { league, fixtures } of allOdds) {
            if (!fixtures.length) continue
            oddsText += `\n${league}:\n`

            for (const f of fixtures) {
              if (!f.home_team || !f.away_team) continue
              total++

              const date = new Date(f.commence_time).toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
              })

              // Extract all markets
              let h2hHome = null, h2hDraw = null, h2hAway = null
              let over25 = null, under25 = null, over15 = null, over35 = null
              let bttsYes = null, bttsNo = null

              for (const bm of (f.bookmakers || [])) {
                for (const market of (bm.markets || [])) {
                  if (market.key === 'h2h') {
                    h2hHome = market.outcomes?.find(o => o.name === f.home_team)?.price
                    h2hAway = market.outcomes?.find(o => o.name === f.away_team)?.price
                    h2hDraw = market.outcomes?.find(o => o.name === 'Draw')?.price
                  }
                  if (market.key === 'totals') {
                    over25 = market.outcomes?.find(o => o.name === 'Over' && o.point === 2.5)?.price
                    under25 = market.outcomes?.find(o => o.name === 'Under' && o.point === 2.5)?.price
                    over15 = market.outcomes?.find(o => o.name === 'Over' && o.point === 1.5)?.price
                    over35 = market.outcomes?.find(o => o.name === 'Over' && o.point === 3.5)?.price
                  }
                  if (market.key === 'btts') {
                    bttsYes = market.outcomes?.find(o => o.name === 'Yes')?.price
                    bttsNo = market.outcomes?.find(o => o.name === 'No')?.price
                  }
                }
                break // use first bookmaker only
              }

              let line = `${date}: ${f.home_team} vs ${f.away_team}`
              if (h2hHome) line += ` | 1X2: ${h2hHome}/${h2hDraw || 'N/A'}/${h2hAway}`
              if (over25) line += ` | O2.5:${over25} U2.5:${under25 || 'N/A'}`
              if (over15) line += ` | O1.5:${over15}`
              if (over35) line += ` | O3.5:${over35}`
              if (bttsYes) line += ` | BTTS Y:${bttsYes} N:${bttsNo || 'N/A'}`
              if (h2hHome <= 1.4) line += ` [STRONG FAV]`
              oddsText += line + '\n'

              // Save snapshot to DB
              await saveOddsSnapshot({
                home_team: f.home_team,
                away_team: f.away_team,
                league,
                match_date: f.commence_time?.split('T')[0],
                home_odds: h2hHome,
                draw_odds: h2hDraw,
                away_odds: h2hAway,
                over25_odds: over25,
                btts_yes_odds: bttsYes
              }).catch(() => {})
            }
          }

          await cacheSet('odds:text', oddsText, 259200)
          await cacheSet('odds:total', total, 259200)
          await cacheSet('odds:updated_at', new Date().toISOString(), 259200)

          results.odds.refreshed = true
          results.odds.fixtures = total
          results.odds.reason = `Refreshed — ${total} fixtures with all markets`
        } catch (e) {
          results.odds.reason = `Error: ${e.message}`
        }
      }
    } else {
      results.odds.reason = `Fresh (${Math.round(oddsAge)}h old)`
      results.odds.fixtures = (await cacheGet('odds:total')) || 0
    }

    // ============================================
    // STEP 2: STANDINGS via Gemini
    // ============================================
    const standingsAge = await hoursSince('standings:updated_at')

    if (forceStandings || standingsAge > 72) {
      const standingsPrompt = `You are a football data researcher. Today is ${today}.

Search Google for the CURRENT 2025/26 season standings for:
Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, Eredivisie, Primeira Liga, Belgian Pro League, Scottish Premiership

For each league, return top 10 in this format:
[League Name]:
1. [Team] | [Points]pts | W[w] D[d] L[l] | GD:[gd] | Form:[last5]

Return ONLY standings data. No intro.`

      const collected = await geminiSearch(standingsPrompt)

      if (collected && !collected.startsWith('ERROR') && collected.length > 200) {
        const leagueCount = ['Premier League','La Liga','Bundesliga','Serie A','Ligue 1','Champions League','Europa League','Eredivisie','Primeira Liga','Belgian','Scottish']
          .filter(n => collected.toLowerCase().includes(n.toLowerCase())).length

        const standingsText = '\n=== CURRENT STANDINGS ===\n' + collected
        await cacheSet('standings:text', standingsText, 345600)
        await cacheSet('standings:leagues', leagueCount, 345600)
        await cacheSet('standings:updated_at', new Date().toISOString(), 345600)

        // Save to DB for history
        await saveIntelligence('standings', 'all', null, collected)

        results.standings.refreshed = true
        results.standings.leagues = leagueCount
        results.standings.reason = `Refreshed — ${leagueCount} leagues`
      } else {
        results.standings.reason = collected?.startsWith('ERROR')
          ? collected
          : `Too little data (${collected?.length || 0} chars)`
      }
    } else {
      results.standings.reason = `Fresh (${Math.round(standingsAge)}h old)`
      results.standings.leagues = (await cacheGet('standings:leagues')) || 0
    }

    // ============================================
    // STEP 3: MATCH CONTEXT via Gemini
    // ============================================
    const contextAge = await hoursSince('context:updated_at')

    if (forceContext || contextAge > 24) {
      const oddsText = await cacheGet('odds:text')

      const fixtureLines = oddsText
        ? oddsText.split('\n').filter(l => l.includes(' vs ')).slice(0, 20).join('\n')
        : ''

      const contextPrompt = `You are a football intelligence researcher. Today is ${today}. Season: 2025/26.

${fixtureLines
  ? `Upcoming fixtures:\n${fixtureLines}\n\nFor each fixture, search for:`
  : `Search Google for all club football fixtures this weekend and next week across Premier League, Bundesliga, Serie A, La Liga, Ligue 1, UCL, UEL. Then for each match provide:`
}

1. Last 5 results with scores for each team
2. Last 3 head-to-head meetings with scores
3. Current manager, formation, key playing style
4. Any injury or suspension news
5. Home/away record this season

Format as bullet points per match. Facts only, no analysis.`

      const collected = await geminiSearch(contextPrompt)

      if (collected && !collected.startsWith('ERROR') && collected.length > 100) {
        await cacheSet('context:text', collected, 108000)
        await cacheSet('context:chars', collected.length, 108000)
        await cacheSet('context:updated_at', new Date().toISOString(), 108000)

        await saveIntelligence('match_context', 'all', null, collected)

        results.context.refreshed = true
        results.context.chars = collected.length
        results.context.reason = `Refreshed — ${collected.length} chars`
      } else {
        results.context.reason = collected?.startsWith('ERROR')
          ? collected
          : `Insufficient data`
      }
    } else {
      results.context.reason = `Fresh (${Math.round(contextAge)}h old)`
      results.context.chars = (await cacheGet('context:chars')) || 0
    }

    // ============================================
    // STEP 4: CHECK RESULTS for pending predictions
    // ============================================
    if (forceResults || forceAll) {
      try {
        const pending = await sql`
          SELECT * FROM predictions
          WHERE result = 'pending'
          AND match_date < NOW()
          LIMIT 20
        `

        if (pending.rows.length > 0) {
          const resultsPrompt = `You are a football results checker. Today is ${today}.

I need you to search Google for the actual FINAL scores of these matches that have already been played:

${pending.rows.map(p => `${p.match_date}: ${p.home_team} vs ${p.away_team} (${p.league})`).join('\n')}

For each match return EXACTLY this format:
RESULT: [Home Team] vs [Away Team] | [Home Goals]-[Away Goals] | FT

Only return matches you found. If you cannot find the score, skip it.`

          const resultsData = await geminiSearch(resultsPrompt, 30000)

          let resolved = 0

          if (resultsData && !resultsData.startsWith('ERROR')) {
            const lines = resultsData.split('\n').filter(l => l.startsWith('RESULT:'))

            for (const line of lines) {
              const match = line.match(/RESULT:\s*(.+)\s+vs\s+(.+)\s+\|\s+(\d+)-(\d+)/)
              if (!match) continue

              const [, homeTeam, awayTeam, homeGoals, awayGoals] = match
              const hg = parseInt(homeGoals)
              const ag = parseInt(awayGoals)

              // Find matching pending predictions
              const matchingPreds = pending.rows.filter(p =>
                p.home_team.toLowerCase().includes(homeTeam.trim().toLowerCase()) ||
                homeTeam.trim().toLowerCase().includes(p.home_team.toLowerCase())
              )

              for (const pred of matchingPreds) {
                let outcome = 'lost'
                const actualOutcome = `${hg}-${ag}`

                if (pred.market === 'Match Result') {
                  if (pred.pick.includes('Win') && pred.pick.includes(pred.home_team) && hg > ag) outcome = 'won'
                  else if (pred.pick.includes('Win') && pred.pick.includes(pred.away_team) && ag > hg) outcome = 'won'
                  else if (pred.pick === 'Draw' && hg === ag) outcome = 'won'
                } else if (pred.market === 'Over/Under') {
                  const total = hg + ag
                  if (pred.pick.includes('Over 2.5') && total > 2.5) outcome = 'won'
                  else if (pred.pick.includes('Under 2.5') && total < 2.5) outcome = 'won'
                  else if (pred.pick.includes('Over 1.5') && total > 1.5) outcome = 'won'
                  else if (pred.pick.includes('Over 3.5') && total > 3.5) outcome = 'won'
                } else if (pred.market === 'BTTS') {
                  if (pred.pick === 'BTTS Yes' && hg > 0 && ag > 0) outcome = 'won'
                  else if (pred.pick === 'BTTS No' && (hg === 0 || ag === 0)) outcome = 'won'
                }

                await sql`
                  UPDATE predictions
                  SET result = ${outcome}, actual_outcome = ${actualOutcome}, resolved_at = NOW()
                  WHERE id = ${pred.id}
                `
                resolved++
              }
            }
          }

          results.results.refreshed = true
          results.results.checked = pending.rows.length
          results.results.reason = `Checked ${pending.rows.length} pending, resolved ${resolved}`
        } else {
          results.results.reason = 'No pending predictions to check'
        }
      } catch (e) {
        results.results.reason = `Error: ${e.message}`
      }
    }

    return res.status(200).json(results)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
