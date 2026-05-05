// =============================================================
// api/resolve.js — Gemini finds real results, DB gets updated
// Hit manually: /api/resolve
// =============================================================

import { sql, resolvePendingPredictions, updateTeamElo } from './db.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const today = new Date().toISOString().split('T')[0]

    // Get pending predictions older than match date
    const pending = await sql`
      SELECT DISTINCT home_team, away_team, league, match_date
      FROM predictions
      WHERE result = 'pending'
      AND match_date <= ${today}
      LIMIT 20
    `

    if (pending.rows.length === 0) {
      return res.status(200).json({ message: 'No pending predictions to resolve', resolved: 0 })
    }

    const matchList = pending.rows
      .map(p => `${p.match_date}: ${p.home_team} vs ${p.away_team} (${p.league})`)
      .join('\n')

    const prompt = `You are a football results checker. Today is ${today}.

Search Google for the FINAL SCORES of these matches that have already been played:

${matchList}

Return ONLY results you actually found. Format exactly like this for each match:
RESULT: [Home Team] vs [Away Team] | [Home Goals]-[Away Goals] | [Date]

If you cannot find a result, skip that match entirely. Do not guess.`

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30000)

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 1000 },
        }),
      }
    )

    if (!response.ok) {
      return res.status(200).json({ error: `Gemini ${response.status}`, resolved: 0 })
    }

    let collected = ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(jsonStr)
            const parts = parsed?.candidates?.[0]?.content?.parts
            if (parts) for (const p of parts) { if (p.text) collected += p.text }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Parse results
    const results = []
    const lines = collected.split('\n').filter(l => l.startsWith('RESULT:'))

    for (const line of lines) {
      const match = line.match(/RESULT:\s*(.+?)\s+vs\s+(.+?)\s+\|\s+(\d+)-(\d+)/)
      if (!match) continue
      results.push({
        home_team: match[1].trim(),
        away_team: match[2].trim(),
        home_goals: parseInt(match[3]),
        away_goals: parseInt(match[4]),
      })
    }

    if (results.length > 0) {
      await resolvePendingPredictions(results)

      // Update ELO ratings
      for (const r of results) {
        const pendingRow = pending.rows.find(p =>
          p.home_team.toLowerCase().includes(r.home_team.toLowerCase())
        )
        await updateTeamElo(
          r.home_team, r.away_team,
          r.home_goals, r.away_goals,
          pendingRow?.league || 'Unknown'
        ).catch(() => {})
      }
    }

    return res.status(200).json({
      checked: pending.rows.length,
      resolved: results.length,
      results,
    })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
