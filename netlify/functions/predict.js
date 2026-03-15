export default async (req) => {
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
    const body = await req.json()
    const { messages, system, context } = body

    // Build a rich system prompt that includes all live data
    const fullSystem = `${system}

${context ? `
=== LIVE FOOTBALL DATA (Use this for all predictions) ===
${context}
=== END OF LIVE DATA ===

CRITICAL INSTRUCTION: You have been provided with real live football data above. Always use this data when making predictions. Never say you don't have data. The data includes fixtures, standings, form, goals scored, goals conceded, home and away records, and injury news. Base every prediction on this real data.
` : ''}
`

    // Clean messages — only keep last 4 exchanges
    const cleanMessages = (messages || [])
      .slice(-4)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.replace(/<[^>]*>/g, '').slice(0, 2000)
          : m.content
      }))

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: fullSystem,
        messages: cleanMessages,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      })
    }

    const data = await response.json()

    return new Response(JSON.stringify(data), {
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
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}

export const config = {
  path: '/api/predict'
}
