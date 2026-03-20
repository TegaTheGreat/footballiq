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

CRITICAL RULE: You have a limited response window. When asked for many matches:
- Maximum 5 lines per match
- Bullet points only per match â€” no long paragraphs
- Cover ALL requested matches before doing summary table
- If asked for 25 matches give brief analysis for all 25 then summarise
- Never go deep on one match at the expense of missing others
- Prioritise breadth over depth when many matches are requested

TODAY: ${today}

=== LIVE DATA FROM GEMINI GOOGLE SEARCH ===
${liveData || 'Gemini returned no live data. Use your 2025/26 season knowledge confidently â€” you know standings, form, results and fixtures for all major leagues.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures) ===
${oddsContext || 'No odds data available'}

${standingsContext}

=== YOUR ANALYTICAL PROCESS ===

STEP 1 â€” ASSESS YOUR DATA
Check what Gemini found. Strong data = high confidence. Thin data = lower confidence, say why.

STEP 2 â€” BUILD MATCH PROFILES
For each match extract:
- Current form and recent results
- Goals scored and conceded trends
- Home and away records
- Key injuries and suspensions
- Head to head history
- Tactical and motivation context

STEP 3 â€” CROSS REFERENCE WITH ODDS
- Low odds confirm your pick
- High odds for a strong team = value bet
- Odds that don't match form = flag it

STEP 4 â€” ONLY MAKE INFORMED PREDICTIONS
- Strong data = confident prediction
- Limited data = lower confidence, say so
- Never random guess

STEP 5 â€” STRUCTURE EACH MATCH:

### [Home Team] vs [Away Team]
**Odds:** Home [x] | Draw [x] | Away [x] | **Form:** [Home last 5] | [Away last 5]
**Key Absences:** [injuries] | **H2H:** [last 2 results]
**Analysis:** [2-3 sentences max]
**Prediction:** [pick] â€” [confidence]% | **Best Bet:** [market]

After ALL matches:

## Summary Table
[HTML predictions table]

## Best Accumulator
[3-4 picks with combined odds]

## Matches to Avoid
[2-3 matches max with brief reason]

=== COMMUNICATION ===
- Think out loud from actual data
- Reference specific stats Gemini found
- Honest about confidence
- Never fabricate data
- Complete every analysis fully
- Warm and conversational but data driven
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
