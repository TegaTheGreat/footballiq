// =============================================================
// api/predict.js — Claude analyses CACHED weekend scout data
// (falls back to a live scout.js call only if nothing is cached
// yet for the current weekend window)
// =============================================================

import { savePrediction, getPredictionStats, getWeekendScoutData, getWeekendKey } from './db.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

    const { messages, question, image, images } = req.body
    const today = new Date().toISOString().split('T')[0]
    const weekendKey = getWeekendKey()

    const [predStats, weekendRows] = await Promise.all([
      getPredictionStats().catch(() => null),
      getWeekendScoutData(weekendKey).catch(() => []),
    ])

    // Group cached rows by league
    const byLeague = {}
    for (const row of weekendRows) {
      if (!byLeague[row.league]) byLeague[row.league] = {}
      byLeague[row.league][row.intel_type] = row.content
    }
    const coveredLeagues = Object.keys(byLeague)
    const usingCache = coveredLeagues.length > 0

    let scoutContext = ''
    let dataSourceNote = ''

    if (usingCache) {
      scoutContext = coveredLeagues
        .map(league => {
          const entry = byLeague[league]
          let block = `\n### ${league}\n`
          if (entry.weekend_scout) block += entry.weekend_scout
          if (entry.injury_news) block += `\n${entry.injury_news}`
          return block
        })
        .join('\n')
      dataSourceNote = `Cached from this week's scheduled scout run (weekend key: ${weekendKey}). Covers: ${coveredLeagues.join(', ')}.`
    } else {
      // Safety net: nothing cached yet for this window (first deploy,
      // or a question asked before Friday's job has run). Do ONE live
      // scout as a fallback rather than answering with nothing.
      try {
        const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
        const scoutRes = await fetch(`${base}/api/scout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        })
        if (scoutRes.ok) {
          const live = await scoutRes.json()
          if (live.success) {
            scoutContext = live.data
            dataSourceNote = 'No cached data was available for this window yet — this used a live fallback search instead.'
          }
        }
      } catch (_) {}
      if (!scoutContext) {
        dataSourceNote = 'No cached or live data available. Be transparent about this — cap confidence at 55% and rely on general football knowledge only.'
      }
    }

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

    const systemPrompt = `You are FootballIQ — an elite tactical football analyst and automated betting engine, built for someone who thinks like a manager, not a casual punter.

TODAY: ${today}
CURRENT WEEKEND WINDOW: Friday ${weekendKey} through the following Monday.

=== TARGET LEAGUES ===
Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Belgian Pro League,
Primeira Liga, Scottish Premiership, Saudi Pro League, Brazilian Serie A, Argentine Primera,
UEFA Champions League, Europa League, Conference League.

=== YOUR BETTING PHILOSOPHY (THE "NEC NIJMEGEN" RULE) ===
Don't just pick match winners. Hunt for structural, repeating statistical patterns — teams
that consistently score AND concede heavily (bankers for Over 2.5 / BTTS), extreme home/away
splits, or clear tactical mismatches. Prioritize trend-based value bets over unpredictable
1X2 calls made in isolation.

=== DATA AVAILABLE TO YOU ===
${dataSourceNote}
${scoutContext || 'No data available — say so plainly. Do not invent fixtures, teams, or odds.'}
${predHistory}

=== DATA INTEGRITY (STRICT) ===
- Only reference stats, odds and scores present in the data above.
- Never invent fixtures, odds or scores. If odds are missing, say "odds unavailable".
- If a league or match the user asks about isn't in the data above, say you don't have
  current data for it rather than guessing — offer to note it for a future scout run.
- Confidence tiers: live odds+form+H2H+injuries = 72-88% | form+standings only = 55-68% |
  general knowledge only = 40-55%.

=== OUTPUT STRUCTURE — for a weekly slate or "give me the best matches" style request ===
## 1. The Master Matrix
A markdown table: | Competition | Match | Primary Pick | Odds | Confidence | The "Why" |

## 2. The Tactical Accumulators
- 🎯 The Banker Ticket (3–4 high-probability, low-risk picks)
- ⚽ The Goals Ticket (BTTS / Over 2.5 — matches fitting the NEC Nijmegen goal-trend profile)
- ⚠️ The Trap List (favorites to avoid — rotation, fatigue, injuries, tactical mismatch)

## 3. Top 5 Value Deep-Dives
3-sentence tactical breakdown each — cite form, injuries, or tactics from the data above.
Bold the actual pick.

For a single-match question or narrower ask, answer directly and skip the full structure —
don't force a table for one match.

End every response with a one-line responsible-gambling note.

=== AFTER YOUR ANALYSIS — HIDDEN PICKS JSON ===
Include this block so picks get saved to the database (it is stripped before the user sees it):

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

One entry per concrete pick. Omit the block entirely if you made no concrete picks.`

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
