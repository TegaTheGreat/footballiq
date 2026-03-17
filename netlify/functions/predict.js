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
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const ODDS_API_KEY = process.env.ODDS_API_KEY

    const bodyText = await req.text()
    const body = JSON.parse(bodyText)
    const { messages, question, image, images } = body

    const now = new Date()
    const today = now.toISOString().split('T')[0]

    // ============================================
    // STEP 1: GEMINI SEARCHES GOOGLE FOR LIVE DATA
    // ============================================
    let liveData = ''

    if (GEMINI_API_KEY) {
      try {
        const geminiPrompt = `You are a professional football data researcher with live Google search access. Today is ${today}.

USER REQUEST: "${question}"

Your job is to gather ALL the intelligence needed to make informed predictions. Do not guess — search for everything.

SEARCH PROTOCOL — execute ALL of these searches:

STEP 1 — IDENTIFY THE MATCHES
Search: "[competition name] fixtures ${today} this week"
Find every match relevant to the request with exact dates and times.

STEP 2 — FOR EACH MATCH FOUND, SEARCH:
- "[Team A] recent results form March 2026" — last 5 results with scores
- "[Team B] recent results form March 2026" — last 5 results with scores
- "[Team A] vs [Team B] head to head history" — last 5 meetings
- "[Team A] injuries suspensions team news March 2026"
- "[Team B] injuries suspensions team news March 2026"
- "[Team A] [Team B] preview prediction March 2026"

STEP 3 — STANDINGS AND CONTEXT
- "[League name] standings table March 2026"
- "[Competition] results this week March 2026"
- Any manager quotes or tactical news relevant to these matches

STEP 4 — RETURN EVERYTHING IN THIS FORMAT:

=== MATCHES FOUND ===
[List every match with date, time, competition, venue]

=== TEAM FORM & RESULTS ===
[For each team: last 5 results with scores, goals scored, goals conceded, home/away record]

=== HEAD TO HEAD ===
[Last 5 meetings between each pair of teams with scores]

=== INJURIES & SUSPENSIONS ===
[Every confirmed injury or suspension found]

=== STANDINGS ===
[Current table position, points, goal difference, form for relevant teams]

=== KEY NEWS & CONTEXT ===
[Manager quotes, tactical notes, motivation factors, anything that affects the match]

=== BETTING CONTEXT ===
[Any odds movement, public betting trends, expert opinions found]

Be thorough. Search multiple times. Return only real data you actually found — never invent anything. If you cannot find data for a specific team or match say so clearly.`

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: geminiPrompt }]
              }],
              tools: [{
                google_search: {}
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4000,
              }
            })
          }
        )

        const geminiData = await geminiResponse.json()

        // Extract text from all parts including search results
        const geminiText = geminiData?.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          ?.map(p => p.text)
          ?.join('\n')

        if (geminiText && geminiText.length > 100) {
          liveData = geminiText
          console.log('Gemini fetched successfully, length:', liveData.length)
        } else {
          console.log('Gemini returned empty or short response:', JSON.stringify(geminiData).slice(0, 300))
        }

      } catch (e) {
        console.log('Gemini error:', e.message)
      }
    }

    // ============================================
    // STEP 2: FETCH LIVE ODDS
    // ============================================
    const sportsToFetch = [
      { key: 'soccer_epl', name: 'Premier League' },
      { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
      { key: 'soccer_italy_serie_a', name: 'Serie A' },
      { key: 'soccer_spain_la_liga', name: 'La Liga' },
      { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
      { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
      { key: 'soccer_belgium_first_div', name: 'Belgian Pro League' },
      { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
      { key: 'soccer_scotland_premiership', name: 'Scottish Premiership' },
      { key: 'soccer_uefa_champs_league', name: 'Champions League' },
      { key: 'soccer_uefa_europa_league', name: 'Europa League' },
      { key: 'soccer_saudi_professional_league', name: 'Saudi Pro League' },
    ]

    let oddsContext = ''
    let totalFixtures = 0

    if (ODDS_API_KEY) {
      try {
        const oddsRequests = sportsToFetch.map(sport =>
          fetch(
            `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&dateFormat=iso&oddsFormat=decimal`
          )
          .then(r => r.json())
          .catch(() => [])
        )

        const results = await Promise.all(oddsRequests)

        results.forEach((fixtures, idx) => {
          if (!Array.isArray(fixtures) || fixtures.length === 0) return
          const sportName = sportsToFetch[idx].name
          oddsContext += `\n${sportName}:\n`

          fixtures.forEach(fixture => {
            if (!fixture.home_team || !fixture.away_team) return
            totalFixtures++

            const date = new Date(fixture.commence_time).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            })

            let homeOdds = null, drawOdds = null, awayOdds = null
            if (fixture.bookmakers?.length > 0) {
              const h2h = fixture.bookmakers[0].markets?.find(m => m.key === 'h2h')
              if (h2h) {
                homeOdds = h2h.outcomes?.find(o => o.name === fixture.home_team)?.price
                awayOdds = h2h.outcomes?.find(o => o.name === fixture.away_team)?.price
                drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price
              }
            }

            oddsContext += `${date}: ${fixture.home_team} vs ${fixture.away_team}`
            if (homeOdds) {
              oddsContext += ` | Home:${homeOdds} Draw:${drawOdds || 'N/A'} Away:${awayOdds}`
              if (homeOdds <= 1.4) oddsContext += ` [STRONG FAVOURITE]`
              if (homeOdds >= 3.5 && awayOdds >= 3.5) oddsContext += ` [OPEN MATCH]`
            }
            oddsContext += '\n'
          })
        })
      } catch (e) {
        console.log('Odds API error:', e.message)
      }
    }

    // ============================================
    // STEP 3: BUILD CLAUDE'S SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor. You work exactly like a professional sports analyst at a top betting firm.

TODAY: ${today}

=== DATA FROM GEMINI GOOGLE SEARCH ===
${liveData
  ? liveData
  : 'Gemini search returned no data for this request. Use your 2025/26 season knowledge but clearly state confidence is based on training knowledge not live search.'}

=== LIVE BETTING ODDS (${totalFixtures} fixtures found) ===
${oddsContext || 'No odds data available'}

=== YOUR ANALYTICAL PROCESS ===

STEP 1 — ASSESS DATA QUALITY
Before predicting, check what Gemini found. If data is thin on a specific match acknowledge it — lower your confidence rating accordingly.

STEP 2 — BUILD TEAM PROFILES FROM THE DATA
For each match extract:
- Current form from Gemini's search results
- Goals scored and conceded trend
- Home or away record
- Key absences — injuries and suspensions Gemini found
- Head to head record
- Motivation and tactical context
- Manager quotes or team news

STEP 3 — CROSS REFERENCE WITH ODDS
- Compare your analysis against the bookmaker odds provided
- If odds say 1.4 for a team but form suggests otherwise — flag it as a warning
- Identify genuine value where the market appears to have it wrong
- Low odds confirm your pick. Inflated odds for a strong team = value bet

STEP 4 — MAKE INFORMED PREDICTIONS ONLY
- Only make confident predictions when Gemini's data supports it
- If you have strong recent form data + H2H + injury news = high confidence prediction
- If Gemini found limited data = lower confidence, state this clearly
- NEVER make random guesses disguised as predictions
- If you genuinely have no data on a match say "Insufficient live data — cannot make a confident prediction"

STEP 5 — STRUCTURE YOUR RESPONSE LIKE THIS:

## [Competition] Match Analysis

### [Home Team] vs [Away Team]
**Date/Time:** [exact date and time]
**Venue:** [stadium if found]

**Form:**
- [Home Team] last 5: [results from Gemini data]
- [Away Team] last 5: [results from Gemini data]

**Head to Head:** [last meetings from Gemini data]

**Key Absences:** [injuries and suspensions from Gemini]

**Tactical Context:** [any manager quotes or news from Gemini]

**Odds:** Home [x.xx] | Draw [x.xx] | Away [x.xx]

**Analysis:** [your reasoning based on the actual data above]

**Prediction:** [pick] — [confidence]% confidence
**Best Bet:** [specific market recommendation with reasoning]
**Value Alert:** [flag if you spot odds that look wrong]

---

After all matches:

## Summary Predictions Table
[HTML table with all predictions]

## Best Accumulator
[3-4 picks, show the combined odds calculation]

## Matches to Avoid
[matches where data is too thin or match is too unpredictable]

=== COMMUNICATION STYLE ===
- Think out loud — show your reasoning from the actual data Gemini found
- Reference specific stats — "according to live search data, their last 5 shows..."
- Be honest about confidence — not everything deserves high confidence
- Never fabricate data — if Gemini did not find something say data is limited
- Complete every analysis fully — never stop mid analysis
- Warm and conversational but always data driven
- End with a brief responsible gambling note`

    // ============================================
    // STEP 4: BUILD MESSAGES WITH IMAGE SUPPORT
    // ============================================
    let userContent
    const imageList = images || (image ? [image] : [])

    if (imageList.length > 0) {
      const imageBlocks = imageList.map(img => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.type,
          data: img.base64,
        }
      }))
      userContent = [
        ...imageBlocks,
        {
          type: 'text',
          text: question || 'Analyze these images and give me full predictions'
        }
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

    // ============================================
    // STEP 5: STREAM CLAUDE'S ANALYSIS
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
      return new Response(JSON.stringify({ error: errText }), {
        status: claudeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    // ============================================
    // STEP 6: STREAM TO CLIENT
    // ============================================
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    const encoder = new TextEncoder()
    const reader = claudeResponse.body.getReader()
    const decoder = new TextDecoder()

    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.trim())

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  await writer.write(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`
                    )
                  )
                }
              } catch (e) {}
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'))
      } catch (e) {
        console.log('Stream error:', e.message)
      } finally {
        await writer.close()
      }
    })()

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
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
