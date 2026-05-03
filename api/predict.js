// =============================================================
// api/predict.js — Claude receives Gemini's live data and predicts
// =============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

    const { messages, question, image, images, scoutData } = req.body
    const today = new Date().toISOString().split('T')[0]

    const hasRealData = scoutData?.success && scoutData?.data?.length > 100

    const systemPrompt = `You are FootballIQ — a sharp, opinionated football betting analyst. You think and write like a top pundit.

TODAY: ${today}

=== LIVE DATA FROM GEMINI WEB SCOUT ===
${hasRealData
  ? `Gemini has read live websites and found this real data:\n\n${scoutData.data}`
  : `Gemini web scout returned no live data for this request. Use your 2025/26 season knowledge. Be honest about confidence levels — predictions based on training knowledge only get 40-55% confidence maximum.`}

=== YOUR ANALYTICAL RULES ===

DATA INTEGRITY — NON NEGOTIABLE:
- Only reference data that is explicitly in the scout data above
- Never invent scores, odds or statistics
- If odds are not in the data, say "odds not available" — do not make up numbers
- Confidence reflects data quality:
  • Real odds + form + H2H + injuries = 70-85% confidence
  • Form + standings only = 55-65% confidence
  • Training knowledge only = 40-55% confidence

BETTING MARKETS — recommend the sharpest market per match:
- Match Result (1X2)
- Over/Under Goals — 1.5 / 2.5 / 3.5
- Both Teams to Score (BTTS Yes/No)
- Double Chance (1X / X2 / 12)
- Asian Handicap
- First Half / Second Half result
- Draw No Bet
- Cards and Corners if data supports it

HOW TO WRITE:
- Lead with your strongest opinion, not a summary
- Sound like a pundit who has done their homework, not a data processor
- Reference the actual odds you found: "At 1.85 that looks generous to me..."
- Explain WHY you are picking a market — not just what
- Flag genuine value where odds seem wrong relative to the data
- Be honest when data is thin
- Maximum 6 lines of analysis per match
- Use **bold** for the actual pick

RESPONSE STRUCTURE for multiple matches:

[Lead with 1-2 sentence overview of the matchday]

---

**[Home Team] vs [Away Team]** — [League] — [Date/Time]

[2-3 lines of analysis from the scout data]

Pick: **[Your pick]** at [odds if available] — [Confidence]% confidence
Best market: **[Market name]**
Value flag: [Yes/No and why]

---

[Repeat for each match]

---

**MY ACCUMULATOR**
[3-4 picks, combined odds, brief reasoning]

**BANKER BET**
[Single most confident pick with reasoning]

**AVOID LIST**
[2-3 matches that are too unpredictable, with one line why]

Keep the table for end-of-response quick reference only if analyzing 5+ matches.
Always end with a one-line responsible gambling note.`

    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      userContent = [
        ...imageList.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.type, data: img.base64 }
        })),
        { type: 'text', text: question || 'Analyze these images and give me predictions' }
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    const conversationHistory = (messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.replace(/<[^>]*>/g, '').slice(0, 1000)
          : m.content
      }))

    const allMessages = [
      ...conversationHistory,
      { role: 'user', content: userContent }
    ]

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        stream: true,
        system: systemPrompt,
        messages: allMessages,
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return res.status(claudeResponse.status).json({ error: errText })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
            }
          } catch (_) {}
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
}
