// =============================================================
// STAGE 1 â€” /api/research.js
// Fetches Gemini + Odds + Standings in parallel
// Returns raw JSON to frontend â€” NO Claude, NO streaming
// Should complete in 15-25 seconds
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
    // GEMINI â€” Live data scout
    // Increased timeout to 25s since this endpoint
    // has its own budget separate from Claude
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
        const timeout = setTimeout(() => controller.abort(), 25000) // 25s â€” more breathing room

        const scoutPrompt = `You are an elite sports researcher with live Google Search access. Today is ${today}.

The user is asking: "${question}"

STEP 1 â€” THINK before you search. Identify:
- What specific teams, leagues or competitions are being asked about?
- If the request is general like "best bets this weekend" â€” automatically identify the biggest matches happening this weekend across Premier League, Championship, Champions League, Europa League, Bundesliga, Serie A, La Liga, Ligue 1, Eredivisie, Scottish Premiership, Belgian Pro League, Primeira Liga, Saudi Pro League

STEP 2 â€” SEARCH for each identified match or team:
- "[Team A] vs [Team B] preview ${today}"
- "[Team A] recent form results March 2026"
- "[Team B] recent form results March 2026"
- "[Team A] injuries suspensions team news March 2026"
- "[Competition] fixtures this week March 2026"
- "[Competition] standings table March 2026"

STEP 3 â€” RETURN a concise bulleted list of raw facts only. No intro, no outro:

- [Match]: [date and time]
- [Team] form: [last 5 results with scores]
- [Team] key absence: [player name, reason]
- [Team] vs [Team] H2H: [last 3 results with scores]
- [League] top 6: [teams with points]
- Breaking news: [any relevant injury or tactical news]

Be fast and concise. Return only facts.`

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
              contents: [{ parts: [{ text: scoutPrompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
            }),
          }
        )

        clearTimeout(timeout)

        if (!response.ok) {
          const errBody = await response.text()
          status.gemini.error = `HTTP ${response.status}: ${errBody.slice(0, 200)}`
          console.log('Gemini HTTP error:', response.status, errBody.slice(0, 300))
          return ''
        }

        const data = await response.json()

        // Check for API-level errors (wrong key, quota exceeded, etc.)
        if (data.error) {
          status.gemini.error = `API error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`
          console.log('Gemini API error:', data.error)
          return ''
        }

        const text = data?.candidates?.[0]?.content?.parts
          ?.filter((p) => p.text)
          ?.map((p) => p.text)
          ?.join('\n')

        if (text && text.length > 50) {
          status.gemini.success = true
          status.gemini.chars = text.length
          console.log('Gemini success, chars:', text.length)
          return text
        }

        // If we got here, response was empty or too short
        status.gemini.error = `Empty response. Raw: ${JSON.stringify(data).slice(0, 300)}`
        console.log('Gemini empty:', JSON.stringify(data).slice(0, 300))
        return ''
      } catch (e) {
        if (e.name === 'AbortError') {
          status.gemini.error = 'Timed out after 25s'
          console.log('Gemini timed out after 25s')
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
