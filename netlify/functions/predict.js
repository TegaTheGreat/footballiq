export default async function handler(req, res) {
  // CORS Headers
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) throw new Error("Gemini API key missing")

    const { question } = req.body
    const today = new Date().toISOString().split('T')[0]

    // ============================================
    // THE FOOTBALL-IQ MANAGER BRAIN (SYSTEM PROMPT)
    // ============================================
    const systemInstruction = `You are FootballIQ, an elite football analyst and betting advisor for the 2026/27 season. Today is ${today}. 

YOUR TARGET LEAGUES: 
Premier League, La Liga, Serie A, Bundesliga, Eredivisie (Dutch), Belgian Pro League, Primeira Liga (Portugal), English Championship, Scottish Premiership, Champions League, Europa League, and Conference League.

YOUR BETTING PHILOSOPHY (THE "NEC NIJMEGEN" RULE):
You do not just pick match winners. You look for extreme, reliable, repeating statistical patterns. For example: a team that consistently scores and concedes heavily (making them a "sure banker" for Over 2.5 Goals or BTTS). Prioritize these trend-based value bets over unpredictable 1X2 outcomes.

WHEN THE USER ASKS FOR A WEEKLY SLATE (e.g., "Top 30 matches"):
Always structure your exact response in this order:

## 1. The Master Matrix (Top Matches)
[Create a markdown table for the matches found across the target leagues]
Columns: | Competition | Match | Primary Pick | Odds | Confidence | The "Why" |

## 2. The Tactical Accumulators
Break the matches down into specific tickets based on structural patterns:
- **The Banker Ticket:** 3-4 highly reliable picks.
- **The Goals Ticket (BTTS / Over 2.5):** Matches fitting the "NEC Nijmegen" profile of extreme goal trends.
- **The Trap List:** Matches where heavy favorites should be avoided due to fatigue, injuries, or tactical mismatches.

## 3. Top 5 Value Deep-Dives
Provide a short, 3-sentence tactical breakdown of the 5 absolute best bets of the weekend, citing recent form, injuries, or tactical setups you found via search.

SEARCH INSTRUCTIONS:
Always use the Google Search tool to find live odds, recent results, and injury news for the requested leagues before generating the table. Never fabricate odds.`

    // ============================================
    // STREAMING GEMINI WITH GOOGLE SEARCH
    // ============================================
    // We use streamGenerateContent?alt=sse for standard server-sent events
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        role: "user",
        parts: [{ text: question || "Give me the weekend slate for my target leagues." }]
      }],
      tools: [{ google_search: {} }], // This enables live Google Search!
      generationConfig: { 
        temperature: 0.2, 
        maxOutputTokens: 8192 
      }
    }

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(err)
    }

    // Set headers for streaming back to your React frontend
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')

    // Read the stream and pipe it to the client
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      // Gemini SSE chunks start with "data: "
      const lines = chunk.split('\n').filter(l => l.trim().startsWith('data: '))
      
      for (const line of lines) {
        const dataStr = line.slice(6) // remove "data: "
        try {
          const parsed = JSON.parse(dataStr)
          // Extract the text token from the Gemini response structure
          const textToken = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
          if (textToken) {
            // Send it to your frontend exactly how your App.jsx expects it
            res.write(`data: ${JSON.stringify({ text: textToken })}\n\n`)
          }
        } catch (e) {
          // Ignore parsing errors for incomplete chunks
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()

  } catch (err) {
    console.log('Function error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

export const config = {
  maxDuration: 60, // Vercel/Netlify timeout setting
}
