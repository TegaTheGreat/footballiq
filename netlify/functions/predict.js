import { getStore } from '@netlify/blobs'

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
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    const APISPORTS_KEY = process.env.APISPORTS_KEY

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const season = 2025

    // ============================================
    // STEP 1: FETCH PREDICTION HISTORY
    // ============================================
    let predictionHistory = []
    let seasonStats = { total: 0, won: 0, lost: 0, pending: 0, winRate: 0 }

    try {
      const store = getStore('footballiq-predictions')
      const historyData = await store.get('season-2025-26')
      if (historyData) {
        const parsed = JSON.parse(historyData)
        predictionHistory = parsed.predictions || []
        seasonStats = parsed.stats || seasonStats
      }
    } catch (e) {
      console.log('No prediction history yet:', e.message)
    }

    // ============================================
    // STEP 2: CHECK RESULTS FOR PENDING PREDICTIONS
    // ============================================
    const pendingPredictions = predictionHistory.filter(p => p.status === 'pending')
    if (pendingPredictions.length > 0 && APISPORTS_KEY) {
      try {
        for (const pred of pendingPredictions) {
          if (!pred.fixtureId) continue
          const res = await fetch(
            `https://v3.football.api-sports.io/fixtures?id=${pred.fixtureId}`,
            { headers: { 'x-apisports-key': APISPORTS_KEY } }
          ).then(r => r.json()).catch(() => null)

          if (!res?.response?.[0]) continue
          const fixture = res.response[0]
          const status = fixture.fixture?.status?.short

          if (['FT', 'AET', 'PEN'].includes(status)) {
            const homeGoals = fixture.goals?.home
            const awayGoals = fixture.goals?.away
            const homeWon = homeGoals > awayGoals
            const awayWon = awayGoals > homeGoals
            const draw = homeGoals === awayGoals

            let correct = false
            if (pred.pick === 'home' && homeWon) correct = true
            if (pred.pick === 'away' && awayWon) correct = true
            if (pred.pick === 'draw' && draw) correct = true
            if (pred.pick === 'over25' && (homeGoals + awayGoals) > 2.5) correct = true
            if (pred.pick === 'under25' && (homeGoals + awayGoals) < 2.5) correct = true
            if (pred.pick === 'btts' && homeGoals > 0 && awayGoals > 0) correct = true

            pred.status = correct ? 'won' : 'lost'
            pred.actualScore = `${homeGoals}-${awayGoals}`
            pred.resolvedAt = today
          }
        }

        const resolved = predictionHistory.filter(p => p.status !== 'pending')
        const won = resolved.filter(p => p.status === 'won').length
        seasonStats = {
          total: predictionHistory.length,
          won,
          lost: resolved.filter(p => p.status === 'lost').length,
          pending: predictionHistory.filter(p => p.status === 'pending').length,
          winRate: resolved.length > 0 ? Math.round((won / resolved.length) * 100) : 0
        }

        const store = getStore('footballiq-predictions')
        await store.set('season-2025-26', JSON.stringify({
          predictions: predictionHistory,
          stats: seasonStats,
          updatedAt: today
        }))
      } catch (e) {
        console.log('Error checking results:', e.message)
      }
    }

    // ============================================
    // STEP 3: BUILD PREDICTION HISTORY CONTEXT
    // ============================================
    let historyContext = ''
    if (predictionHistory.length > 0) {
      historyContext = `\n=== YOUR PREDICTION HISTORY THIS SEASON (2025/26) ===\n`
      historyContext += `Overall: ${seasonStats.won}W ${seasonStats.lost}L ${seasonStats.pending} Pending | Win Rate: ${seasonStats.winRate}%\n\n`
      const recent = predictionHistory.slice(-20)
      recent.forEach(p => {
        const result = p.status === 'won' ? '✅ WON' : p.status === 'lost' ? '❌ LOST' : '⏳ PENDING'
        historyContext += `${p.date} | ${p.match} | Pick: ${p.pickDescription} | ${result}`
        if (p.actualScore) historyContext += ` | Score: ${p.actualScore}`
        historyContext += '\n'
      })

      const wonPicks = predictionHistory.filter(p => p.status === 'won').map(p => p.market)
      const bestMarket = wonPicks.length > 0
        ? Object.entries(wonPicks.reduce((acc, m) => ({ ...acc, [m]: (acc[m] || 0) + 1 }), {}))
            .sort((a, b) => b[1] - a[1])[0]?.[0]
        : null
      if (bestMarket) historyContext += `\nBest performing market so far: ${bestMarket}\n`
    }

    // ============================================
    // STEP 4: BUILD SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season.

TODAY IS: ${today} (March 15 2026)

YOU HAVE ACCESS TO WEB SEARCH — use it to find:
- Today's and this weekend's fixtures across all major leagues
- Recent results and scores
- Current league standings and form
- Injury and team news
- Head to head records

ALWAYS search for live data before answering prediction questions. Search for things like:
- "Premier League fixtures today March 15 2026"
- "Bundesliga results this weekend"
- "Serie A standings 2025/26"
- "Barcelona vs Sevilla preview March 2026"

${historyContext}

YOUR RULES:
1. Always search for current fixture and result data before predicting
2. Use prediction history to identify your strongest markets and adjust confidence
3. Never refuse to predict — always provide confident analysis
4. For multiple predictions use this exact HTML table:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Liverpool vs Tottenham</td><td>Premier League</td><td>Liverpool Win</td><td>Match Result</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>
5. After predictions include hidden JSON:
<!--PREDICTIONS_JSON
[{"match":"Liverpool vs Tottenham","fixtureId":0,"date":"${today}","pick":"home","pickDescription":"Liverpool Win","market":"Match Result","confidence":78,"league":"Premier League"}]
PREDICTIONS_JSON-->
6. Be decisive and confident
7. Always end with responsible gambling reminder`

    // ============================================
    // STEP 5: BUILD MESSAGES WITH OPTIONAL IMAGE
    // ============================================
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
          text: question || 'Analyze this image and give me predictions based on what you see. Search for any additional context you need.'
        }
      ]
    } else {
      userContent = question || 'Give me the best bets this weekend'
    }

    // ============================================
    // STEP 6: CALL CLAUDE WITH WEB SEARCH
    // ============================================
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
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
          }
        ],
        messages: [
          {
            role: 'user',
            content: userContent
          }
        ],
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const data = await claudeResponse.json()

    // ============================================
    // STEP 7: HANDLE TOOL USE RESPONSES
    // Extract final text from potentially multi-turn tool use
    // ============================================
    let finalMessages = [{ role: 'user', content: userContent }]
    let currentData = data
    let iterations = 0
    const maxIterations = 5

    while (
      currentData.stop_reason === 'tool_use' &&
      iterations < maxIterations
    ) {
      iterations++

      // Add assistant response to messages
      finalMessages.push({
        role: 'assistant',
        content: currentData.content
      })

      // Process tool calls
      const toolResults = []
      for (const block of currentData.content) {
        if (block.type === 'tool_use') {
          // Web search results come back automatically
          // We just pass them back as tool results
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Search completed. Use the results to provide accurate predictions.'
          })
        }
      }

      if (toolResults.length === 0) break

      finalMessages.push({
        role: 'user',
        content: toolResults
      })

      // Continue conversation
      const continueResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
            }
          ],
          messages: finalMessages,
        }),
      })

      currentData = await continueResponse.json()
    }

    // Extract final text response
    const finalText = currentData.content
      ?.filter(block => block.type === 'text')
      ?.map(block => block.text)
      ?.join('\n') || ''

    // ============================================
    // STEP 8: SAVE NEW PREDICTIONS
    // ============================================
    try {
      const jsonMatch = finalText.match(/<!--PREDICTIONS_JSON\s*([\s\S]*?)\s*PREDICTIONS_JSON-->/)
      if (jsonMatch) {
        const newPreds = JSON.parse(jsonMatch[1])
        const store = getStore('footballiq-predictions')

        newPreds.forEach(pred => {
          predictionHistory.push({
            ...pred,
            status: 'pending',
            savedAt: today,
          })
        })

        const resolved = predictionHistory.filter(p => p.status !== 'pending')
        const won = resolved.filter(p => p.status === 'won').length
        seasonStats = {
          total: predictionHistory.length,
          won,
          lost: resolved.filter(p => p.status === 'lost').length,
          pending: predictionHistory.filter(p => p.status === 'pending').length,
          winRate: resolved.length > 0 ? Math.round((won / resolved.length) * 100) : 0
        }

        await store.set('season-2025-26', JSON.stringify({
          predictions: predictionHistory.slice(-500),
          stats: seasonStats,
          updatedAt: today
        }))
      }
    } catch (e) {
      console.log('Error saving predictions:', e.message)
    }

    // Clean JSON from response
    const cleanResponse = finalText.replace(/<!--PREDICTIONS_JSON[\s\S]*?PREDICTIONS_JSON-->/g, '')

    return new Response(JSON.stringify({
      content: [{ type: 'text', text: cleanResponse }],
      seasonStats,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}

export const config = {
  path: '/api/predict'
}
