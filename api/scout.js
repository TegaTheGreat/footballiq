// =============================================================
// api/scout.js — Gemini reads live websites for match data
// No football APIs needed
// =============================================================

import { saveIntelligence } from './db.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' })

    const { question } = req.body
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const fullDate = now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })

    const scoutPrompt = `You are an elite football data scout. Today is ${fullDate}.

The user wants: "${question}"

Browse the internet RIGHT NOW and find real, live football data. Use these sources:

FIXTURES & RESULTS — search and read:
- flashscore.com for today and this weekend's fixtures
- bbc.co.uk/sport/football for latest scores and results
- sofascore.com for upcoming fixtures
- the specific competition the user mentioned

ODDS — search and read:
- oddschecker.com for the specific matches you find
- Search "[Team A] vs [Team B] betting odds" for each match
- Find Over/Under odds, BTTS odds, Asian Handicap odds

FORM & STATS — search and read:
- "[Team] last 5 results 2025-26"
- "[Team A] vs [Team B] head to head history"
- whoscored.com or fbref.com for team stats

INJURY NEWS — search and read:
- "[Team] injury news team news [current month year]"
- bbc sport or sky sports for confirmed absences

STANDINGS — search and read:
- "[League] table standings 2025-26"

Return ONLY real data you found. Structure it exactly like this:

=== FIXTURES ===
[Date Time] [Home] vs [Away] ([League/Competition])

=== RECENT RESULTS (last 7 days) ===
[Date] [Home] [Score] [Away]

=== ODDS ===
[Home] vs [Away]:
- Match Result: Home [x.xx] | Draw [x.xx] | Away [x.xx]
- Over 2.5 Goals: [x.xx] | Under 2.5: [x.xx]
- Over 1.5 Goals: [x.xx]
- BTTS Yes: [x.xx] | No: [x.xx]
- Asian Handicap: Home -0.5 [x.xx] | Away -0.5 [x.xx]

=== FORM ===
[Team]: [Last 5 — e.g. W3-1 D1-1 L0-2 W2-0 W1-0]

=== HEAD TO HEAD ===
[Team A] vs [Team B]: [Last 3 results with dates and scores]

=== INJURIES & SUSPENSIONS ===
[Team]: [Player] — [status, expected return]

=== STANDINGS ===
[League]:
1. [Team] [Pts]pts W[w] D[d] L[l] GD[gd] Form:[last5]

=== MATCH INTELLIGENCE ===
[Tactical notes, motivation factors, managerial comments, anything relevant]

Be thorough. Read multiple pages. If you cannot find something say "Not found" — never invent data.`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55000)

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
          contents: [{ parts: [{ text: scoutPrompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 4000 },
        }),
      }
    )

    if (!response.ok) {
      clearTimeout(timeout)
      const errText = await response.text()
      return res.status(200).json({
        success: false, data: '',
        error: `Gemini ${response.status}: ${errText.slice(0, 200)}`,
      })
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
    } catch (e) {
      if (e.name !== 'AbortError') console.log('Scout stream error:', e.message)
    }

    clearTimeout(timeout)

    const hasData = collected.length > 200 && collected.includes('===')

    // Save to DB for future reference
    if (hasData) {
      await saveIntelligence('scout', 'all', null, collected, today).catch(() => {})
    }

    console.log(`Scout: ${collected.length} chars, hasData: ${hasData}`)

    return res.status(200).json({
      success: hasData,
      data: collected,
      chars: collected.length,
    })

  } catch (err) {
    return res.status(200).json({ success: false, data: '', error: err.message })
  }
}
