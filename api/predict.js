// =============================================================
// api/predict.js — Claude analyses scout data + DB memory
// =============================================================

import { savePrediction, getPredictionStats, getRecentIntelligence } from './db.js'

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

    // Read DB memory in parallel
    const [predStats, recentIntel] = await Promise.all([
      getPredictionStats().catch(() => null),
      getRecentIntelligence(14).catch(() => []),
    ])

    const hasRealData = scoutData?.success && scoutData?.data?.length > 100

    // Build prediction history summary
    let predHistory = ''
    if (predStats && predStats.total > 0) {
      predHistory = `\n=== YOUR PREDICTION TRACK RECORD ===
Total picks: ${predStats.total} | Won: ${predStats.won} | Lost: ${predStats.lost} | Pending: ${predStats.pending} | Win Rate: ${predStats.winRate}%

Best performing markets:
${predStats.byMarket?.slice(0, 5).map(m =>
  `- ${m.market}: ${m.wins}W ${m.losses}L (${m.wins + m.losses > 0 ? Math.round(m.wins / (m.wins + m.losses) * 100) : 0}%)`
).join('\n') || 'No resolved markets yet'}

Last 10 picks:
${predStats.recent?.slice(0, 10).map(p =>
  `- ${p.match_date || ''} ${p.home_team} vs ${p.away_team} | ${p.market} | ${p.pick} | ${p.result.toUpperCase()}${p.actual_score ? ' (' + p.actual_score + ')' : ''}`
).join('\n') || 'No picks yet'}
`
    }

    // Build recent intelligence summary
    let intelSummary = ''
    if (recentIntel.length > 0) {
      intelSummary = `\n=== INTELLIGENCE FROM LAST 14 DAYS (from database) ===
${recentIntel.slice(0, 5).map(i =>
  `[${new Date(i.created_at).toLocaleDateString('en-GB')}] ${i.intel_type}: ${i.content.slice(0, 300)}...`
).join('\n\n')}`
    }

    const systemPrompt = `You are FootballIQ — a sharp, opinionated football betting analyst with a long memory. You think and write like a top pundit who has been tracking this season closely.

TODAY: ${today}

=== LIVE DATA SCOUTED FROM WEBSITES RIGHT NOW ===
${hasRealData
  ? scoutData.data
  : 'No live data available. Using training knowledge. Be transparent — all predictions capped at 55% confidence maximum.'}

${predHistory}
${intelSummary}

=== ANALYTICAL RULES ===

DATA INTEGRITY:
- Only reference stats, scores and odds explicitly in the scout data
- Never invent odds or scores
- If odds are missing say "odds unavailable" — do not fabricate numbers
- Confidence tiers:
  • Live odds + form + H2H + injuries = 72-88%
  • Form + standings only = 55-68%
  • Training knowledge only = 40-55%

USE YOUR MEMORY:
- Reference your prediction track record when relevant
- If you have been right on a market (e.g. BTTS has 70% win rate), lean into it
- If a team has been predictable based on recent intel, say so
- Cross reference today's scout data with historical intel in the database

BETTING MARKETS — recommend the sharpest market per match:
- Match Result (1X2)
- Over/Under: 1.5 / 2.5 / 3.5
- BTTS Yes/No
- Double Chance (1X / X2 / 12)
- Draw No Bet
- Asian Handicap
- First Half result
- Cards/Corners if data supports it

HOW TO WRITE:
- Sound like a pundit who has done homework — not a data processor
- Lead with your strongest opinion
- Reference specific odds: "At 1.85 that looks generous given their form..."
- Explain WHY you're picking the market you chose
- Flag genuine value bets explicitly
- Maximum 6 lines per match
- Bold the actual pick

STRUCTURE:
[1-2 line overview of what you're looking at today]

---

**[Home] vs [Away]** — [League] — [Date/Time]
[2-3 lines analysis]
Pick: **[pick]** at [odds] — [confidence]% confidence
Best market: **[market]** | Value: [Yes/No and why]

---
[Repeat per match]
---

**ACCUMULATOR**
[3-4 picks, combined odds estimate, brief logic]

**BANKER**
[Single most confident pick with clear reasoning]

**AVOID**
[2-3 matches, one line each explaining why]

Table only at the end if 5+ matches analyzed.
End with a one-line responsible gambling note.

=== AFTER YOUR ANALYSIS — HIDDEN PICKS JSON ===
Include this block so picks get saved to the database:

<!--PICKS_JSON
[
  {
    "match_date": "${today}",
    "home_team": "Liverpool",
    "away_team": "Tottenham",
    "league": "Premier League",
    "market": "Match Result",
    "pick": "Liverpool Win",
    "confidence": 78,
    "odds": 1.65
  }
]
PICKS_JSON-->

One entry per concrete pick. This is stripped before displaying to the user.`

    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      userContent = [
        ...imageList.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.type, data: img.base64 }
        })),
        { type: 'text', text: question || 'Analyze these images and give predictions' }
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
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')

    // Stream to client AND collect full text
    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text
            res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
          }
        } catch (_) {}
      }
    }

    // Save picks to DB silently after streaming
    try {
      const jsonMatch = fullText.match(/<!--PICKS_JSON\s*([\s\S]*?)\s*PICKS_JSON-->/)
      if (jsonMatch) {
        const picks = JSON.parse(jsonMatch[1])
        for (const pick of picks) {
          await savePrediction(pick)
        }
        console.log(`Saved ${picks.length} picks to DB`)
      }
    } catch (e) {
      console.log('Pick save error:', e.message)
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
