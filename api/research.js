// =============================================================
// STAGE 1 â€” /api/research.js
// Fetches Gemini (STREAMING) + Odds + Standings in parallel
// Returns raw JSON to frontend â€” NO Claude, NO streaming to client
// Gemini uses streamGenerateContent so partial data is captured
// even if the full response takes too long
// =============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const ODDS_API_KEY = process.env.ODDS_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY

    const { question } = req.body
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const season = 2025

    // Track what succeeded and what failed â€” frontend can show this
    const status = {
      gemini: { success: false, error: null, chars: 0 },
      odds: { success: false, error: null, fixtures: 0 },
      standings: { success: false, error: null, leagues: 0 },
    }

    // ============================================
    // GEMINI â€” Live data scout (STREAMING)
    // Uses streamGenerateContent so partial data
    // is captured even if the full response is slow.
    // Timeout at 28s â€” if Gemini is still going,
    // we keep whatever arrived so far.
    // ============================================
    const fetchGemini = async () => {
      if (!GEMINI_API_KEY) {
        status.gemini.error = 'API key not configured'
        return ''
      }
      if (!question) {
        status.gemini.error = 'No question provided'
        return ''
      }

      try {
        const controller = new AbortController()
        let timedOut = false
        const GEMINI_TIMEOUT = 28000 // 28s â€” generous but within Vercel's 30s budget

        const timeout = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, GEMINI_TIMEOUT)

        const scoutPrompt = `You are a football data scout with Google Search. Today is ${today}.

User question: "${question}"

Search for ONLY these 4 things per match/team mentioned:

1. FORM â€” Last 5 match results with scores (e.g. W 2-1, L 0-3, D 1-1)
2. STANDINGS â€” Current league position and points
3. H2H â€” Last 3 head-to-head results between the teams
4. TACTICAL â€” Manager approach, formation, playing style, motivation (e.g. fighting relegation, resting players for UCL)

If the question is broad (e.g. "best bets this weekend"), identify the key fixtures across top leagues and cover each one.

DO NOT search for: injury news, transfer rumours, match previews, pundit opinions, or odds.

Return ONLY a bullet list of raw facts. No intro, no analysis, no outro. Example format:

- Arsenal form: W 3-1, W 2-0, D 1-1, W 4-0, L 0-1
- Arsenal: 2nd in PL, 68pts
- Arsenal vs Chelsea H2H: Arsenal 2-1, Chelsea 1-0, Draw 2-2
- Arsenal: Arteta plays 4-3-3, strong pressing, prioritising league title

Be concise. Facts only.`

        // KEY CHANGE: streamGenerateContent instead of generateContent
        // &alt=sse tells Gemini to use Server-Sent Events format
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': GEMINI_API_KEY,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: scoutPrompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
            }),
          }
        )

        if (!response.ok) {
          clearTimeout(timeout)
          const errBody = await response.text()
          status.gemini.error = `HTTP ${response.status}: ${errBody.slice(0, 200)}`
          console.log('Gemini HTTP error:', response.status, errBody.slice(0, 300))
          return ''
        }

        // ========================================
        // READ THE STREAM â€” accumulate text chunks
        // If timeout fires mid-stream, we keep
        // whatever we already captured
        // ========================================
        let collectedText = ''
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const jsonStr = line.slice(6).trim()
              if (!jsonStr || jsonStr === '[DONE]') continue

              try {
                const parsed = JSON.parse(jsonStr)

                // Check for API errors in the stream
                if (parsed.error) {
                  status.gemini.error = `Stream error: ${parsed.error.message || JSON.stringify(parsed.error).slice(0, 200)}`
                  console.log('Gemini stream error:', parsed.error)
                  continue
                }

                // Extract text from each streamed chunk
                const parts = parsed?.candidates?.[0]?.content?.parts
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      collectedText += part.text
                    }
                  }
                }
              } catch (parseErr) {
                // Skip unparseable chunks â€” common with SSE
              }
            }
          }
        } catch (streamErr) {
          // AbortError means our timeout fired â€” that's OK if we have partial data
          if (streamErr.name !== 'AbortError') {
            console.log('Gemini stream read error:', streamErr.message)
          }
        }

        clearTimeout(timeout)

        // ========================================
        // EVALUATE WHAT WE GOT
        // ========================================
        if (collectedText.length > 50) {
          status.gemini.success = true
          status.gemini.chars = collectedText.length

          if (timedOut) {
            // We got useful data BUT the stream was cut short
            status.gemini.error = `Partial data (timed out at ${GEMINI_TIMEOUT / 1000}s, captured ${collectedText.length} chars)`
            console.log(`Gemini partial success: ${collectedText.length} chars before timeout`)
          } else {
            console.log(`Gemini full success: ${collectedText.length} chars`)
          }

          return collectedText
        }

        // Nothing useful came through
        if (timedOut) {
          status.gemini.error = `Timed out after ${GEMINI_TIMEOUT / 1000}s with no usable data`
          console.log('Gemini timed out with no data')
        } else {
          status.gemini.error = `Empty response (${collectedText.length} chars)`
          console.log('Gemini empty response')
        }
        return ''
      } catch (e) {
        if (e.name === 'AbortError') {
          // This catches the abort if it fires before the stream even starts
          status.gemini.error = 'Timed out before stream started'
          console.log('Gemini aborted before streaming')
        } else {
          status.gemini.error = e.message
          console.log('Gemini error:', e.message)
        }
        return ''
      }
    }

    // ============================================
    // ODDS â€” Live betting data
    // Fetch in batches of 5 to avoid rate limiting
    // ============================================
    const fetchOdds = async () => {
      if (!ODDS_API_KEY) {
        status.odds.error = 'API key not configured'
        return { context: '', total: 0 }
      }

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

      try {
        // Batch into groups of 5 to be gentle on rate limits
        const batchSize = 5
        const allResults = []

        for (let i = 0; i < sports.length; i += batchSize) {
          const batch = sports.slice(i, i + batchSize)
          const batchResults = await Promise.all(
            batch.map((s) =>
              fetch(
                `https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`
              )
                .then(async (r) => {
                  if (!r.ok) {
                    const errText = await r.text().catch(() => '')
                    console.log(`Odds ${s.key} HTTP ${r.status}: ${errText.slice(0, 100)}`)
                    return []
                  }
                  return r.json()
                })
                .catch((err) => {
                  console.log(`Odds ${s.key} fetch error: ${err.message}`)
                  return []
                })
            )
          )
          allResults.push(...batchResults)
        }

        let context = ''
        let total = 0
        const errors = []

        allResults.forEach((fixtures, idx) => {
          // Check if it's an error object instead of an array
          if (fixtures && !Array.isArray(fixtures)) {
            if (fixtures.message) {
              errors.push(`${sports[idx].name}: ${fixtures.message}`)
            }
            return
          }
          if (!Array.isArray(fixtures) || !fixtures.length) return

          context += `\n${sports[idx].name}:\n`
          fixtures.forEach((f) => {
            if (!f.home_team || !f.away_team) return
            total++
            const date = new Date(f.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
            let h = null,
              d = null,
              a = null
            if (f.bookmakers?.[0]?.markets) {
              const h2h = f.bookmakers[0].markets.find((m) => m.key === 'h2h')
              if (h2h) {
                h = h2h.outcomes?.find((o) => o.name === f.home_team)?.price
                a = h2h.outcomes?.find((o) => o.name === f.away_team)?.price
                d = h2h.outcomes?.find((o) => o.name === 'Draw')?.price
              }
            }
            context += `${date}: ${f.home_team} vs ${f.away_team}`
            if (h) {
              context += ` | Home:${h} Draw:${d || 'N/A'} Away:${a}`
              if (h <= 1.4) context += ` [STRONG FAV]`
              if (h >= 3.5 && a >= 3.5) context += ` [OPEN]`
            }
            context += '\n'
          })
        })

        if (errors.length > 0) {
          status.odds.error = errors.join('; ')
        }

        status.odds.success = total > 0
        status.odds.fixtures = total
        return { context, total }
      } catch (e) {
        status.odds.error = e.message
        console.log('Odds error:', e.message)
        return { context: '', total: 0 }
      }
    }

    // ============================================
    // STANDINGS â€” League tables
    // ============================================
    const fetchStandings = async () => {
      if (!APISPORTS_KEY) {
        status.standings.error = 'API key not configured'
        return ''
      }

      try {
        const leagues = [39, 140, 78, 135, 61, 2, 3, 88, 94, 144, 179]
        const results = await Promise.all(
          leagues.map((id) =>
            fetch(`https://v3.football.api-sports.io/standings?league=${id}&season=${season}`, {
              headers: { 'x-apisports-key': APISPORTS_KEY },
            })
              .then(async (r) => {
                if (!r.ok) return null
                return r.json()
              })
              .catch(() => null)
          )
        )

        let context = '\n=== STANDINGS ===\n'
        let leagueCount = 0

        results.forEach((data) => {
          // Check for API-Sports error responses (quota exceeded, etc.)
          if (data?.errors && Object.keys(data.errors).length > 0) {
            const errMsg = Object.values(data.errors).join(', ')
            console.log('API-Sports error:', errMsg)
            if (!status.standings.error) status.standings.error = errMsg
            return
          }

          if (!data?.response || !Array.isArray(data.response)) return

          data.response.forEach((l) => {
            if (!l.league?.standings?.[0]) return
            leagueCount++
            context += `\n${l.league?.name}:\n`
            l.league.standings[0].slice(0, 8).forEach((t) => {
              context += `${t.rank}. ${t.team?.name} | ${t.points}pts | Form:${t.form}\n`
            })
          })
        })

        status.standings.success = leagueCount > 0
        status.standings.leagues = leagueCount
        return context
      } catch (e) {
        status.standings.error = e.message
        console.log('Standings error:', e.message)
        return ''
      }
    }

    // ============================================
    // FIRE ALL THREE IN PARALLEL
    // ============================================
    const startTime = Date.now()

    const [liveData, oddsData, standingsContext] = await Promise.all([
      fetchGemini(),
      fetchOdds(),
      fetchStandings(),
    ])

    const elapsed = Date.now() - startTime

    // ============================================
    // RETURN EVERYTHING TO FRONTEND
    // ============================================
    return res.status(200).json({
      success: true,
      elapsed_ms: elapsed,
      status, // tells frontend exactly what worked
      data: {
        gemini: liveData,
        odds: {
          context: oddsData.context,
          total: oddsData.total,
        },
        standings: standingsContext,
      },
    })
  } catch (err) {
    console.log('Research function error:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: err.message,
    })
  }
}
