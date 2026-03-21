// =============================================================
// /api/refresh.js — Automated data refresh
//
// SCHEDULES:
//   Odds:          every 48 hours  (~15 calls × 15/month = 225/month)
//   Standings:     every 3 days    (~11 calls × 10/month = 110/month)
//   Match Context: every 24 hours  (~5-10 Gemini calls/day)
//
// TRIGGERS:
//   - Vercel Cron (every 12 hours — checks what's stale)
//   - Manual: visit /api/refresh in browser
//   - Force all: /api/refresh?force=true
//   - Force specific: /api/refresh?force=odds,standings,context
//
// =============================================================

import { cacheGet, cacheSet } from './_cache.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const season = 2025
    const today = new Date().toISOString().split('T')[0]

    const forceParam = (req.query?.force || '').toLowerCase()
    const forceAll = forceParam === 'true'
    const forceOdds = forceAll || forceParam.includes('odds')
    const forceStandings = forceAll || forceParam.includes('standings')
    const forceContext = forceAll || forceParam.includes('context')

    const results = {
      odds: { refreshed: false, reason: '', fixtures: 0 },
      standings: { refreshed: false, reason: '', leagues: 0 },
      context: { refreshed: false, reason: '', chars: 0 },
      timestamp: new Date().toISOString(),
    }

    // ============================================
    // Helper: hours since last update
    // ============================================
    async function hoursSince(key) {
      const ts = await cacheGet(key)
      if (!ts) return 9999
      return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60)
    }

    // ============================================
    // ODDS — Refresh every 48 hours
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

          const allResults = []
          for (let i = 0; i < sports.length; i += 5) {
            const batch = sports.slice(i, i + 5)
            const batchResults = await Promise.all(
              batch.map((s) =>
                fetch(`https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`)
                  .then((r) => r.ok ? r.json() : [])
                  .catch(() => [])
              )
            )
            allResults.push(...batchResults.map((fixtures, idx) => ({
              league: batch[idx].name,
              fixtures: Array.isArray(fixtures) ? fixtures : [],
            })))
          }

          // Build readable context
          let oddsText = ''
          let total = 0
          allResults.forEach(({ league, fixtures }) => {
            if (!fixtures.length) return
            oddsText += `\n${league}:\n`
            fixtures.forEach((f) => {
              if (!f.home_team || !f.away_team) return
              total++
              const date = new Date(f.commence_time).toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short',
                hour: '2-digit', minute: '2-digit',
              })
              let h = null, d = null, a = null
              if (f.bookmakers?.[0]?.markets) {
                const h2h = f.bookmakers[0].markets.find((m) => m.key === 'h2h')
                if (h2h) {
                  h = h2h.outcomes?.find((o) => o.name === f.home_team)?.price
                  a = h2h.outcomes?.find((o) => o.name === f.away_team)?.price
                  d = h2h.outcomes?.find((o) => o.name === 'Draw')?.price
                }
              }
              oddsText += `${date}: ${f.home_team} vs ${f.away_team}`
              if (h) {
                oddsText += ` | Home:${h} Draw:${d || 'N/A'} Away:${a}`
                if (h <= 1.4) oddsText += ` [STRONG FAV]`
                if (h >= 3.5 && a >= 3.5) oddsText += ` [OPEN]`
              }
              oddsText += '\n'
            })
          })

          // Store with 72hr TTL (safety net — we refresh every 48hr)
          await cacheSet('odds:text', oddsText, 259200)
          await cacheSet('odds:total', total, 259200)
          await cacheSet('odds:updated_at', new Date().toISOString(), 259200)

          results.odds.refreshed = true
          results.odds.fixtures = total
          results.odds.reason = `Refreshed (was ${Math.round(oddsAge)}h old)`
        } catch (e) {
          results.odds.reason = `Error: ${e.message}`
        }
      }
    } else {
      results.odds.reason = `Fresh (${Math.round(oddsAge)}h old, refreshes at 48h)`
      results.odds.fixtures = (await cacheGet('odds:total')) || 0
    }

    // ============================================
    // STANDINGS — Refresh every 3 days (72 hours)
    // ============================================
    const standingsAge = await hoursSince('standings:updated_at')

    if (forceStandings || standingsAge > 72) {
      if (!APISPORTS_KEY) {
        results.standings.reason = 'No API key'
      } else {
        try {
          const leagues = [39, 140, 78, 135, 61, 2, 3, 88, 94, 144, 179]
          const leagueResults = await Promise.all(
            leagues.map((id) =>
              fetch(`https://v3.football.api-sports.io/standings?league=${id}&season=${season}`, {
                headers: { 'x-apisports-key': APISPORTS_KEY },
              })
                .then((r) => r.ok ? r.json() : null)
                .catch(() => null)
            )
          )

          let standingsText = ''
          let leagueCount = 0

          leagueResults.forEach((data) => {
            if (data?.errors && Object.keys(data.errors).length > 0) return
            if (!data?.response || !Array.isArray(data.response)) return
            data.response.forEach((l) => {
              if (!l.league?.standings?.[0]) return
              leagueCount++
              standingsText += `\n${l.league?.name}:\n`
              l.league.standings[0].slice(0, 10).forEach((t) => {
                standingsText += `${t.rank}. ${t.team?.name} | ${t.points}pts | W${t.all?.win} D${t.all?.draw} L${t.all?.lose} | GF:${t.all?.goals?.for} GA:${t.all?.goals?.against} | Form:${t.form}\n`
              })
            })
          })

          // Store with 96hr TTL (safety — we refresh every 72hr)
          await cacheSet('standings:text', standingsText, 345600)
          await cacheSet('standings:leagues', leagueCount, 345600)
          await cacheSet('standings:updated_at', new Date().toISOString(), 345600)

          results.standings.refreshed = true
          results.standings.leagues = leagueCount
          results.standings.reason = `Refreshed (was ${Math.round(standingsAge)}h old)`
        } catch (e) {
          results.standings.reason = `Error: ${e.message}`
        }
      }
    } else {
      results.standings.reason = `Fresh (${Math.round(standingsAge)}h old, refreshes at 72h)`
      results.standings.leagues = (await cacheGet('standings:leagues')) || 0
    }

    // ============================================
    // MATCH CONTEXT — Gemini enrichment once daily
    // Reads the cached odds fixtures, asks Gemini
    // to add form, H2H, and tactical context
    // ============================================
    const contextAge = await hoursSince('context:updated_at')

    if (forceContext || contextAge > 24) {
      if (!GEMINI_API_KEY) {
        results.context.reason = 'No Gemini API key'
      } else {
        try {
          // Read cached odds to know which fixtures need context
          const oddsText = await cacheGet('odds:text')

          if (!oddsText) {
            results.context.reason = 'No odds data in cache — refresh odds first'
          } else {
            // Send odds to Gemini in one batch for enrichment
            const prompt = `You are a football analyst. Today is ${today} (2025/26 season).

Here are upcoming fixtures with betting odds:

${oddsText.slice(0, 6000)}

For each fixture listed above, add these facts from your knowledge:

1. FORM — Each team's last 5 results with scores
2. H2H — Last 3 head-to-head results between the teams
3. TACTICAL — Each team's manager, formation, playing style, and current motivation (title race, mid-table, relegation, UCL push, etc.)

Format as bullet points grouped by match. Be concise — facts only, no analysis.`

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 30000)

            const response = await fetch(
              'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
              {
                method: 'POST',
                signal: controller.signal,
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': GEMINI_API_KEY,
                },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
                }),
              }
            )

            clearTimeout(timeout)

            if (response.ok) {
              const data = await response.json()
              const text = data?.candidates?.[0]?.content?.parts
                ?.filter((p) => p.text)
                ?.map((p) => p.text)
                ?.join('\n')

              if (text && text.length > 100) {
                // Store with 30hr TTL (safety — we refresh every 24hr)
                await cacheSet('context:text', text, 108000)
                await cacheSet('context:chars', text.length, 108000)
                await cacheSet('context:updated_at', new Date().toISOString(), 108000)

                results.context.refreshed = true
                results.context.chars = text.length
                results.context.reason = `Refreshed (was ${Math.round(contextAge)}h old)`
              } else {
                results.context.reason = 'Gemini returned empty response'
              }
            } else {
              const err = await response.text()
              results.context.reason = `Gemini HTTP ${response.status}: ${err.slice(0, 150)}`
            }
          }
        } catch (e) {
          results.context.reason = e.name === 'AbortError'
            ? 'Gemini timed out after 30s'
            : `Error: ${e.message}`
        }
      }
    } else {
      results.context.reason = `Fresh (${Math.round(contextAge)}h old, refreshes at 24h)`
      results.context.chars = (await cacheGet('context:chars')) || 0
    }

    return res.status(200).json(results)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
