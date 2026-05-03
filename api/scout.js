// =============================================================
// api/scout.js — Gemini reads live websites for match data
// No API keys for football data needed — Gemini scrapes directly
// =============================================================

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
    const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' })
    const fullDate = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    const scoutPrompt = `You are an elite football data scout with the ability to browse the live internet. Today is ${fullDate} (${today}).

The user wants: "${question}"

Your job is to find REAL, LIVE football data right now by searching these specific sources:

STEP 1 — Find upcoming fixtures and recent results:
Search and read: "flashscore football fixtures ${today}"
Search and read: "bbc sport football scores results today"
Search and read: "premier league fixtures this weekend" if relevant
Search and read: "champions league fixtures this week" if relevant
Search and read: the specific competition the user is asking about

STEP 2 — For each relevant match you find, search for:
- "[Team A] vs [Team B] preview odds ${today}"
- "[Team A] form last 5 matches results"
- "[Team B] form last 5 matches results"
- "[Team A] injury news team news"
- "[Team A] vs [Team B] head to head"

STEP 3 — Find current odds:
Search: "oddschecker [Team A] vs [Team B]"
Search: "[Team A] vs [Team B] betting odds over under btts"

STEP 4 — Find league standings if relevant:
Search: "[League name] standings table 2025-26"

RETURN everything you find in this exact structured format — REAL DATA ONLY, nothing invented:

=== FIXTURES FOUND ===
- [Date/Time] [Home Team] vs [Away Team] ([League])

=== RECENT RESULTS (last 7 days) ===
- [Date] [Home Team] [Score] [Away Team] ([League])

=== TEAM FORM ===
- [Team]: [Last 5 results as W/D/L with scores]
- [Team]: [Last 5 results as W/D/L with scores]

=== HEAD TO HEAD ===
- [Team A] vs [Team B]: [Last 3 results with scores and dates]

=== LIVE ODDS ===
- [Home Team] vs [Away Team]: Win [x.xx] / Draw [x.xx] / Win [x.xx] | Over 2.5: [x.xx] | BTTS Yes: [x.xx]

=== INJURIES & SUSPENSIONS ===
- [Team]: [Player] — [injury/suspension, expected return]

=== STANDINGS ===
- [League]: [Position]. [Team] [Points]pts [Form]

=== KEY MATCH INTELLIGENCE ===
- [Any tactical, motivational or context notes you found]

Be thorough. Read multiple pages. Only return data you actually found on real websites. If you cannot find something, say "Not found" for that section rather than inventing data.`

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
          generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 4000,
          },
        }),
      }
    )

    if (!response.ok) {
      clearTimeout(timeout)
      const errText = await response.text()
      return res.status(200).json({
        success: false,
        data: '',
        error: `Gemini HTTP ${response.status}: ${errText.slice(0, 200)}`,
        elapsed_ms: 0,
      })
    }

    const startRead = Date.now()
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

    const elapsed = Date.now() - startRead
    const hasData = collected.length > 100 && !collected.includes('Not found') && collected.includes('===')

    console.log(`Scout: ${collected.length} chars in ${elapsed}ms`)

    return res.status(200).json({
      success: hasData,
      data: collected,
      chars: collected.length,
      elapsed_ms: elapsed,
    })

  } catch (err) {
    console.log('Scout error:', err.message)
    return res.status(200).json({
      success: false,
      data: '',
      error: err.message,
      elapsed_ms: 0,
    })
  }
}
