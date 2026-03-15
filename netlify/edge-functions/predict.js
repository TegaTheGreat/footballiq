export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // Build conversation history
    const conversationHistory = (messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.replace(/<[^>]*>/g, '').slice(0, 800)
          : m.content
      }))

    // Build current user message
    let userContent
    if (image) {
      userContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.type,
            data: image.base64,
          }
        },
        {
          type: 'text',
          text: question || 'Analyze this image and give me predictions'
        }
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY IS: ${today}

YOU HAVE ACCESS TO WEB SEARCH. Always search for:
- Today's fixtures and this weekend's matches
- Recent results and current standings
- Team news and injuries
- Head to head records

Search before every prediction. Use queries like:
- "Premier League fixtures today ${today}"
- "Bundesliga results this weekend March 2026"
- "La Liga standings March 2026"
- "Liverpool vs Tottenham preview ${today}"

CONVERSATION MEMORY: You remember everything said in this conversation. Build on previous messages. If asked to modify predictions you made earlier, refer back to them.

YOUR RULES:
1. Always search for live data before predicting
2. Remember previous messages in this conversation
3. Never refuse to predict
4. For multiple predictions use this exact HTML table:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>
5. Be decisive and confident
6. Always end with responsible gambling reminder`

    const allMessages = [
      ...conversationHistory,
      { role: 'user', content: userContent }
    ]

    // First call to Claude with web search
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
        }],
        messages: allMessages,
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    let currentData = await claudeResponse.json()
    let currentMessages = [...allMessages]
    let iterations = 0

    // Handle tool use loop
    while (currentData.stop_reason === 'tool_use' && iterations < 5) {
      iterations++

      currentMessages.push({
        role: 'assistant',
        content: currentData.content
      })

      const toolResults = currentData.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: JSON.stringify(b.input),
        }))

      currentMessages.push({
        role: 'user',
        content: toolResults
      })

      const continueRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          system: systemPrompt,
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
          }],
          messages: currentMessages,
        }),
      })

      currentData = await continueRes.json()
    }

    // Extract final text
    const finalText = currentData.content
      ?.filter(b => b.type === 'text')
      ?.map(b => b.text)
      ?.join('\n') || ''

    return new Response(JSON.stringify({
      content: [{ type: 'text', text: finalText }],
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

export const config = {
  path: '/api/predict'
}
