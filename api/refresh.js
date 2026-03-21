// =============================================================
// /api/refresh.js â€” Automated data refresh
//
// DATA SOURCES:
//   Odds:      The Odds API â€” every 48 hours
//   Standings: Gemini + Google Search â€” every 3 days
//   Context:   Gemini (training knowledge) â€” every 24 hours
//
// TRIGGERS:
//   - Vercel Cron (every 12 hours â€” checks what's stale)
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
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
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
    // ODDS â€” Refresh every 48 hours
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

          // Store with 72hr TTL (safety net â€” we refresh every 48hr)
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
    // STANDINGS â€” Gemini WITH Google Search
    // Searches for current league tables once daily
    // Uses search grounding â€” slow but accurate
    // 55s timeout is fine for a background job
    // Costs 1 Gemini call per refresh
    // ============================================
    const standingsAge = await hoursSince('standings:updated_at')

    if (forceStandings || standingsAge > 72) {
      if (!GEMINI_API_KEY) {
        results.standings.reason = 'No Gemini API key'
      } else {
        try {
          const standingsPrompt = `You are a football data researcher with Google Search. Today is ${today}.

Search for the CURRENT 2025/26 season standings for these leagues:
1. Premier League
2. La Liga
3. Bundesliga
4. Serie A
5. Ligue 1
6. Champions League group/league stage
7. Europa League
8. Eredivisie
9. Primeira Liga (Portugal)
10. Belgian Pro League
11. Scottish Premiership

For each league, return the top 10 teams in this exact format:

[League Name]:
1. [Team] | [Points]pts | W[wins] D[draws] L[losses] | GD:[goal difference]
2. [Team] | [Points]pts | W[wins] D[draws] L[losses] | GD:[goal difference]
...

Return ONLY the standings data. No intro, no analysis, no outro. Be accurate â€” use the most recent data you can find.`

          const controller = new AbortController()
          let timedOut = false
          const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 55000)

          // Use streaming so we capture partial data if it's slow
          const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
            {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': GEMINI_API_KEY,
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: standingsPrompt }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
              }),
            }
          )

          if (response.ok) {
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
                    if (parts) {
                      for (const p of parts) {
                        if (p.text) collected += p.text
                      }
                    }
                  } catch (_) {}
                }
              }
            } catch (streamErr) {
              if (streamErr.name !== 'AbortError') {
                console.log('Standings stream error:', streamErr.message)
              }
            }

            clearTimeout(timeout)

            // Count how many leagues we got by looking for common league name patterns
            const leagueCount = [
              'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1',
              'Champions League', 'Europa League', 'Eredivisie', 'Primeira Liga',
              'Belgian', 'Scottish'
            ].filter(name => collected.toLowerCase().includes(name.toLowerCase())).length

            if (collected.length > 200) {
              const standingsText = '\n=== STANDINGS ===\n' + collected

              await cacheSet('standings:text', standingsText, 345600)
              await cacheSet('standings:leagues', leagueCount, 345600)
              await cacheSet('standings:updated_at', new Date().toISOString(), 345600)

              results.standings.refreshed = true
              results.standings.leagues = leagueCount
              results.standings.reason = timedOut
                ? `Partial refresh â€” ${collected.length} chars before timeout`
                : `Refreshed (was ${Math.round(standingsAge)}h old)`
            } else {
              results.standings.reason = timedOut
                ? `Timed out with only ${collected.length} chars`
                : `Too little data (${collected.length} chars)`
            }
          } else {
            clearTimeout(timeout)
            const err = await response.text()
            results.standings.reason = `Gemini HTTP ${response.status}: ${err.slice(0, 150)}`
          }
        } catch (e) {
          results.standings.reason = e.name === 'AbortError'
            ? 'Timed out after 55s'
            : `Error: ${e.message}`
        }
      }
    } else {
      results.standings.reason = `Fresh (${Math.round(standingsAge)}h old, refreshes at 72h)`
      results.standings.leagues = (await cacheGet('standings:leagues')) || 0
    }

    // ============================================
    // MATCH CONTEXT â€” Gemini enrichment once daily
    // NO search grounding â€” uses training knowledge
    // 55s timeout since this is a background job
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
            results.context.reason = 'No odds data in cache â€” refresh odds first'
          } else {
            // Extract just team names and leagues (not full odds text)
            // This keeps the prompt small so Gemini responds faster
            const fixtureLines = oddsText
              .split('\n')
              .filter(line => line.includes(' vs '))
              .slice(0, 60) // cap at 60 fixtures
              .join('\n')

            const prompt = `You are a football analyst. Today is ${today} (2025/26 season).

Here are upcoming fixtures:

${fixtureLines}

For each fixture, provide from your knowledge:

1. FORM â€” Each team's last 5 results with scores (e.g. W 2-1, L 0-3)
2. H2H â€” Last 3 head-to-head results
3. TACTICAL â€” Manager, formation, playing style, motivation (title race, relegation, UCL focus, etc.)

Format as bullet points grouped by match. Be concise â€” facts only, no analysis, no intro, no outro.`

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 55000) // 55s â€” background job, no rush

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
                  // NO tools â€” no google_search â€” pure training knowledge = fast
                  generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
                }),
              }
            )

            clearTimeout(timeout)

            if (response.ok) {
              const data = await response.json()

              if (data.error) {
                results.context.reason = `Gemini API error: ${data.error.message || JSON.stringify(data.error).slice(0, 150)}`
              } else {
                const text = data?.candidates?.[0]?.content?.parts
                  ?.filter((p) => p.text)
                  ?.map((p) => p.text)
                  ?.join('\n')

                if (text && text.length > 100) {
                  await cacheSet('context:text', text, 108000)
                  await cacheSet('context:chars', text.length, 108000)
                  await cacheSet('context:updated_at', new Date().toISOString(), 108000)

                  results.context.refreshed = true
                  results.context.chars = text.length
                  results.context.reason = `Refreshed (was ${Math.round(contextAge)}h old)`
                } else {
                  results.context.reason = `Gemini returned too little (${text?.length || 0} chars)`
                }
              }
            } else {
              const err = await response.text()
              results.context.reason = `Gemini HTTP ${response.status}: ${err.slice(0, 150)}`
            }
          }
        } catch (e) {
          results.context.reason = e.name === 'AbortError'
            ? 'Gemini timed out after 55s'
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
