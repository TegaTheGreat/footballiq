// =============================================================
// api/research.js — Stage 1: Read cache + live news
// =============================================================

import { cacheGet } from './_cache.js'
import { getPredictionStats, getIntelligence } from './db.js'

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

    // Read cache + DB stats in parallel
    const [
      oddsText, oddsTotal, oddsUpdated,
      standingsText, standingsLeagues, standingsUpdated,
      contextText, contextChars, contextUpdated,
      predStats,
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
      getPredictionStats().catch(() => null),
    ])

    if (oddsText) {
      status.odds.success = true
      status.odds.fixtures = oddsTotal
      status.odds.age = oddsUpdated ? `${Math.round((Date.now() - new Date(oddsUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.odds.error = 'No cached data'
    }

    if (standingsText) {
      status.standings.success = true
      status.standings.leagues = standingsLeagues
      status.standings.age = standingsUpdated ? `${Math.round((Date.now() - new Date(standingsUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.standings.error = 'No cached data'
    }

    if (contextText) {
      status.context.success = true
      status.context.chars = contextChars || contextText.length
      status.context.age = contextUpdated ? `${Math.round((Date.now() - new Date(contextUpdated).getTime()) / 3600000)}h ago` : null
    } else {
      status.context.error = 'No cached data'
    }

    const cacheReadTime = Date.now() - startTime

    // Optional: Gemini live search for breaking news
    let geminiLiveData = ''
    const TOTAL_BUDGET = 23000

    if (GEMINI_API_KEY && question) {
      const remainingMs = TOTAL_BUDGET - (Date.now() - startTime)

      if (remainingMs > 6000) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), remainingMs - 1000)

          const livePrompt = `You are a football research assistant. Today is ${today}.

The user is asking: "${question}"

Think about what football matches are relevant. Search Google and find:
- What fixtures are coming up this weekend and next week
- Recent results and current form for the teams involved
- Any confirmed injury news, suspensions or team news from the last 48 hours
- Current league standings for relevant leagues

Think naturally. Return bullet points of everything useful you find. Be thorough but concise. Maximum 25 bullet points.`

          const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
            {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
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
                    if (parts) for (const p of parts) { if (p.text) collected += p.text }
                  } catch (_) {}
                }
              }
            } catch (e) {
              if (e.name !== 'AbortError') console.log('Live stream error:', e.message)
            }

            clearTimeout(timeout)

            if (collected.length > 30) {
              geminiLiveData = collected
              status.geminiLive.success = true
              status.geminiLive.chars = collected.length
            } else {
              status.geminiLive.error = 'No live data found'
            }
          } else {
            clearTimeout(timeout)
            status.geminiLive.error = `HTTP ${response.status}`
          }
        } catch (e) {
          status.geminiLive.error = e.name === 'AbortError' ? 'Timed out' : e.message
        }
      } else {
        status.geminiLive.error = 'Not enough time'
      }
    }

    let geminiCombined = ''
    if (contextText) geminiCombined += '=== MATCH CONTEXT ===\n' + contextText
    if (geminiLiveData) geminiCombined += '\n\n=== LIVE NEWS & BREAKING ===\n' + geminiLiveData

    const needsRefresh = !oddsText || !standingsText || !contextText

    return res.status(200).json({
      success: true,
      elapsed_ms: Date.now() - startTime,
      cache_read_ms: cacheReadTime,
      needs_refresh: needsRefresh,
      status,
      predStats,
      data: {
        gemini: geminiCombined,
        odds: { context: oddsText || '', total: oddsTotal || 0 },
        standings: standingsText || '',
      },
    })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
