// =============================================================
// /api/research.js â€” STAGE 1
// Reads ALL data from Redis cache (instant)
// Optional: Gemini live search for breaking news (bonus)
// Expected time: 1-3 seconds (cache) + bonus if time allows
// =============================================================

import { cacheGet } from './_cache.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const { question } = req.body
    const today = new Date().toISOString().split('T')[0]
    const startTime = Date.now()

    const status = {
      odds: { success: false, error: null, fixtures: 0, age: null },
      standings: { success: false, error: null, leagues: 0, age: null },
      context: { success: false, error: null, chars: 0, age: null },
      geminiLive: { success: false, error: null, chars: 0 },
    }

    // ============================================
    // READ ALL CACHED DATA IN PARALLEL (instant)
    // ============================================
    const [
      oddsText, oddsTotal, oddsUpdated,
      standingsText, standingsLeagues, standingsUpdated,
      contextText, contextChars, contextUpdated,
    ] = await Promise.all([
      cacheGet('odds:text'),
      cacheGet('odds:total'),
      cacheGet('odds:updated_at'),
      cacheGet('standings:text'),
      cacheGet('standings:leagues'),
      cacheGet('standings:updated_at'),
      cacheGet('context:text'),
      cacheGet('context:chars'),
      cacheGet('context:updated_at'),
    ])

    // Odds
    if (oddsText && oddsTotal) {
      status.odds.success = true
      status.odds.fixtures = oddsTotal
      status.odds.age = oddsUpdated ? `${Math.round((Date.now() - new Date(oddsUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.odds.error = 'No cached data â€” visit /api/refresh'
    }

    // Standings
    if (standingsText && standingsLeagues) {
      status.standings.success = true
      status.standings.leagues = standingsLeagues
      status.standings.age = standingsUpdated ? `${Math.round((Date.now() - new Date(standingsUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.standings.error = 'No cached data â€” visit /api/refresh'
    }

    // Match context
    if (contextText) {
      status.context.success = true
      status.context.chars = contextChars || contextText.length
      status.context.age = contextUpdated ? `${Math.round((Date.now() - new Date(contextUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.context.error = 'No cached data â€” visit /api/refresh'
    }

    const cacheReadTime = Date.now() - startTime
    console.log(`Cache read: ${cacheReadTime}ms`)

    // ============================================
    // OPTIONAL: Gemini live search for breaking news
    // Only fires if question is provided and time allows
    // ============================================
    let geminiLiveData = ''
    const TOTAL_BUDGET = 23000 // 23s â€” gives live search ~20s after cache read

    if (GEMINI_API_KEY && question) {
      const remainingMs = TOTAL_BUDGET - (Date.now() - startTime)

      if (remainingMs > 6000) {
        try {
          const controller = new AbortController()
          let timedOut = false
          const timeout = setTimeout(() => { timedOut = true; controller.abort() }, remainingMs - 1000)

        const livePrompt = `You are a football research assistant with Google Search. Today is ${today}.

The user is asking: "${question}"

Think about what football matches are relevant to this question. Search Google and find:
- What fixtures are coming up this weekend and next week
- Recent results and current form for the teams involved  
- Any injury news, suspensions or team news
- Current league standings for relevant leagues

Just think naturally and search like a person would. Return bullet points of everything useful you find. Be thorough but concise.`

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
                contents: [{ parts: [{ text: livePrompt }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
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
              if (streamErr.name !== 'AbortError') console.log('Live stream error:', streamErr.message)
            }

            clearTimeout(timeout)

            if (collected.length > 30) {
              geminiLiveData = collected
              status.geminiLive.success = true
              status.geminiLive.chars = collected.length
              if (timedOut) status.geminiLive.error = `Partial (${collected.length} chars)`
            } else {
              status.geminiLive.error = timedOut ? 'Timed out, no data' : 'No breaking news found'
            }
          } else {
            clearTimeout(timeout)
            status.geminiLive.error = `HTTP ${response.status}`
          }
        } catch (e) {
          status.geminiLive.error = e.name === 'AbortError' ? 'Timed out' : e.message
        }
      } else {
        status.geminiLive.error = 'Skipped â€” not enough time'
      }
    }

    // ============================================
    // BUILD COMBINED DATA FOR CLAUDE
    // ============================================
    let geminiCombined = ''
    if (contextText) {
      geminiCombined += '=== MATCH CONTEXT (Form, H2H, Tactics) ===\n' + contextText
    }
    if (geminiLiveData) {
      geminiCombined += '\n\n=== LIVE SEARCH DATA (Current results, form, team news) ===\n' + geminiLiveData
    }

    // Check if cache needs refresh â€” signal to frontend
    const needsRefresh = !oddsText || !standingsText || !contextText

    return res.status(200).json({
      success: true,
      elapsed_ms: Date.now() - startTime,
      cache_read_ms: cacheReadTime,
      needs_refresh: needsRefresh,
      status,
      data: {
        gemini: geminiCombined,
        odds: { context: oddsText || '', total: oddsTotal || 0 },
        standings: standingsText || '',
      },
    })
  } catch (err) {
    console.log('Research error:', err.message, err.stack)
    return res.status(500).json({ success: false, error: err.message })
  }
}
