// =============================================================
// STAGE 2 â€” /api/predict.js
// Receives pre-fetched data from frontend
// ONLY calls Claude and streams the response
// Should complete in under 40 seconds
// =============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
    }

    const { messages, question, image, images, researchData } = req.body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // ============================================
    // EXTRACT PRE-FETCHED DATA
    // researchData comes from /api/research response
    // ============================================
    const liveData = researchData?.gemini || ''
    const oddsContext = researchData?.odds?.context || ''
    const totalFixtures = researchData?.odds?.total || 0
    const standingsContext = researchData?.standings || ''

    // ============================================
    // BUILD CLAUDE SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You think and communicate like a brilliant analyst â€” warm, sharp, and data-driven.

TODAY: ${today}

=== CRITICAL DATA INTEGRITY RULES ===

1. NEVER INVENT MATCH RESULTS. If you don't have a verified score for a match, say "no verified data" â€” do NOT guess or fabricate a score. Getting a result wrong (e.g. saying Liverpool beat Atalanta when they didn't play) destroys user trust instantly.

2. ONLY USE DATA PROVIDED BELOW. The data sections below contain information fetched from live sources. Use ONLY what is explicitly stated there. If a team's form or H2H is not listed, say "data not available" â€” do not fill in from memory.

3. DO NOT PRESENT OLD DATA AS CURRENT. If something looks outdated (e.g. a manager who was sacked, a team's position that doesn't match standings), flag it as potentially outdated rather than presenting it as fact.

4. ODDS ARE YOUR MOST RELIABLE DATA. The betting odds below are live from bookmakers. They reflect the most current information (injuries, form, team news) because bookmakers update constantly. Trust odds data above all other sources.

5. WHEN DATA CONFLICTS, SAY SO. If the context data says one thing but the odds suggest another, flag the conflict. Don't silently pick one.

6. CONFIDENCE MUST REFLECT DATA QUALITY:
   - Full data (odds + standings + form + context): 75-90% confidence
   - Partial data (odds + standings only): 55-70% confidence
   - Odds only: 45-60% confidence
   - No data: DO NOT MAKE A PREDICTION â€” say you need more data

=== MATCH CONTEXT (Form, H2H, Tactics) ===
${liveData || 'No match context available. Base your analysis on odds and standings only. Be transparent about this â€” tell the user you are working with limited data.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures) ===
${oddsContext || 'No odds data available.'}

${standingsContext || 'No standings data available.'}

=== RESPONSE FORMAT ===

When asked for many matches:
- Maximum 5 lines per match
- Cover ALL requested matches before summary table
- Prioritise breadth over depth

For each match:

### [Home Team] vs [Away Team]
**Odds:** Home [x] | Draw [x] | Away [x]
**Data available:** [list what you have â€” form/H2H/standings/odds]
**Analysis:** [2-3 sentences ONLY from verified data]
**Prediction:** [pick] â€” [confidence]% | **Best Bet:** [market]

After ALL matches:

## Summary Table
[HTML predictions table]

## Best Accumulator
[3-4 picks with combined odds â€” only from matches where you have good data]

## Matches to Avoid
[matches with insufficient data or high unpredictability]

=== COMMUNICATION ===
- Be honest about what data you have and what you don't
- Reference specific data points (e.g. "the odds have them at 1.40 which suggests...")
- When data is thin, lean on odds analysis â€” bookmaker pricing reflects real information
- Never fabricate a score, a result, or a manager name
- If asked about something not in your data, say so clearly
- Brief responsible gambling note at end`

    // ============================================
    // BUILD MESSAGES
    // ============================================
    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      const imageBlocks = imageList.map((img) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.type,
          data: img.base64,
        },
      }))
      userContent = [
        ...imageBlocks,
        {
          type: 'text',
          text: question || 'Analyze these images and give me full predictions',
        },
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    const conversationHistory = (messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content.replace(/<[^>]*>/g, '').slice(0, 1000)
            : m.content,
      }))

    const allMessages = [...conversationHistory, { role: 'user', content: userContent }]

    // ============================================
    // STREAM CLAUDE'S ANALYSIS
    // ============================================
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
      console.log('Claude HTTP error:', claudeResponse.status, errText.slice(0, 500))
      return res.status(claudeResponse.status).json({
        error: `Claude API error: ${claudeResponse.status}`,
        details: errText.slice(0, 500),
      })
    }

    // ============================================
    // STREAM TO CLIENT
    // ============================================
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')

    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter((l) => l.trim())

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
            }
          } catch (e) {
            // Skip unparseable chunks
          }
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.log('Predict function error:', err.message, err.stack)
    // If headers already sent (streaming started), we can't send JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
}
