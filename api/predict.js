// =============================================================
// api/predict.js — Stage 2: Claude streams analysis
// Saves predictions to DB automatically
// =============================================================

import { savePrediction, sql } from './db.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

    const { messages, question, image, images, researchData, predStats } = req.body
    const today = new Date().toISOString().split('T')[0]

    const liveData = researchData?.gemini || ''
    const oddsContext = researchData?.odds?.context || ''
    const totalFixtures = researchData?.odds?.total || 0
    const standingsContext = researchData?.standings || ''

    // Build prediction history summary for Claude
    let predHistorySummary = ''
    if (predStats && predStats.total > 0) {
      predHistorySummary = `\n=== YOUR PREDICTION TRACK RECORD ===
Overall: ${predStats.won} won / ${predStats.lost} lost / ${predStats.pending} pending | Win Rate: ${predStats.winRate}%
${predStats.byMarket?.length > 0 ? `\nBest markets:\n${predStats.byMarket.slice(0, 5).map(m => `- ${m.market}: ${m.wins}W ${m.losses}L`).join('\n')}` : ''}
${predStats.recent?.length > 0 ? `\nLast 5 picks:\n${predStats.recent.slice(0, 5).map(p => `- ${p.home_team} vs ${p.away_team} | ${p.pick} | ${p.result.toUpperCase()}`).join('\n')}` : ''}
`
    }

    const systemPrompt = `You are FootballIQ — a sharp, opinionated football betting analyst. You write like a top pundit, not a data robot.

TODAY: ${today}

=== DATA INTEGRITY RULES ===
1. Never invent results or scores. If you don't have verified data, say so.
2. Only use data explicitly provided below.
3. Betting odds are your most reliable source — bookmakers price in everything.
4. Confidence levels must reflect actual data quality:
   - Full data (odds + standings + form + context): 75-90%
   - Partial data (odds + standings): 55-70%
   - Odds only: 45-60%
   - No data: do not predict

=== AVAILABLE BETTING MARKETS ===
You can now predict across ALL these markets — not just match result:
- **Match Result (1X2)** — Home Win / Draw / Away Win
- **Over/Under Goals** — Over 1.5 / Over 2.5 / Over 3.5 / Under 2.5
- **Both Teams to Score** — BTTS Yes / BTTS No
- **Asian Handicap** — Home -0.5 / Away -0.5 / Home -1.5 etc
- **First Half Result** — 1H Home / 1H Draw / 1H Away
- **Double Chance** — 1X / X2 / 12
- **Cards & Corners** — flag if odds available

When recommending, choose the BEST market for each match — not just match result by default.

=== MATCH CONTEXT ===
${liveData || 'No match context — use odds and standings only. Be transparent.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures with all markets) ===
${oddsContext || 'No odds data available.'}

${standingsContext || ''}

${predHistorySummary}

=== HOW TO WRITE ===
Write like a pundit having a sharp conversation — not like a report generator.

DO:
- Lead with your strongest opinion: "Liverpool win this comfortably. Here's why..."
- Reference specific data: "The odds have them at 1.65 which I think is slightly generous..."
- Show your reasoning out loud
- Use bold for key picks
- Recommend the sharpest market for each match, not just 1X2
- Flag value bets explicitly: "This looks like value to me at those odds"
- End with a tight accumulator and matches to avoid

DO NOT:
- Default to tables for everything — use prose
- Write generic analysis that could apply to any match
- Pad responses with headers for every single point
- Use tables unless showing a final summary slip

ONLY use a table for the final "Quick Reference Summary" at the very end if analyzing multiple matches.

=== PREDICTION TRACKING ===
After your analysis, include a hidden JSON block so picks can be saved:

<!--PICKS_JSON
[{"match_date":"${today}","home_team":"Liverpool","away_team":"Tottenham","league":"Premier League","market":"Match Result","pick":"Liverpool Win","confidence":78,"odds":1.65}]
PICKS_JSON-->

Include one entry per concrete pick you make. This is hidden from the user.

Always end with a brief responsible gambling note.`

    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      userContent = [
        ...imageList.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.base64 } })),
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
        content: typeof m.content === 'string' ? m.content.replace(/<[^>]*>/g, '').slice(0, 1000) : m.content
      }))

    const allMessages = [...conversationHistory, { role: 'user', content: userContent }]

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, stream: true, system: systemPrompt, messages: allMessages }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return res.status(claudeResponse.status).json({ error: `Claude API error: ${claudeResponse.status}`, details: errText.slice(0, 500) })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')

    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

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
              fullText += parsed.delta.text
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
            }
          } catch (_) {}
        }
      }
    }

    // Extract and save picks silently after streaming
    try {
      const jsonMatch = fullText.match(/<!--PICKS_JSON\s*([\s\S]*?)\s*PICKS_JSON-->/)
      if (jsonMatch) {
        const picks = JSON.parse(jsonMatch[1])
        for (const pick of picks) {
          await savePrediction(pick)
        }
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
