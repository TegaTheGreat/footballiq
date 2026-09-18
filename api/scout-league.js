// =============================================================
// api/scout-league.js — Scouts ONE league at a time, saves to DB
// Triggered by GitHub Actions on a schedule (see
// .github/workflows/scout-schedule.yml), NOT Vercel Cron.
//
// mode=full  -> fixtures, odds, form, H2H, standings (Fri morning)
// mode=news  -> confirmed injuries/team news only (Fri evening)
//
// Auth: requires header  x-cron-secret: <CRON_SECRET>
// =============================================================

import { saveScoutData, getWeekendKey } from './db.js'

export const LEAGUES = {
  epl: 'Premier League',
  ucl: 'UEFA Champions League',
  uel: 'UEFA Europa League',
  uecl: 'UEFA Europa Conference League',
  laliga: 'La Liga',
  bundesliga: 'Bundesliga',
  seriea: 'Serie A',
  ligue1: 'Ligue 1',
  eredivisie: 'Eredivisie',
  belgian: 'Belgian Pro League',
  primeira: 'Primeira Liga',
  scottish: 'Scottish Premiership',
  saudi: 'Saudi Pro League',
  brazil: 'Brazilian Serie A',
  argentina: 'Argentine Primera Division',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const secret = req.headers['x-cron-secret']
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { league, mode } = req.query
  const leagueName = LEAGUES[league]
  if (!leagueName) {
    return res.status(400).json({
      error: `Unknown league key "${league}". Valid keys: ${Object.keys(LEAGUES).join(', ')}`,
    })
  }
  if (mode !== 'full' && mode !== 'news') {
    return res.status(400).json({ error: 'mode must be "full" or "news"' })
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' })

    const now = new Date()
    const fullDate = now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
    // Season computed dynamically — never hardcode a year here.
    const season = `${now.getFullYear()}/${String(now.getFullYear() + 1).slice(2)}`

    const prompt = mode === 'full'
      ? `You are an elite football data scout. Today is ${fullDate}. Current season: ${season}.

Find REAL, LIVE data for ${leagueName} matches happening this Friday through Monday (the current matchday window). Browse flashscore.com, sofascore.com, oddschecker.com, and official league sites.

Return ONLY, in this exact structure:

=== FIXTURES ===
[Date Time] [Home] vs [Away]

=== ODDS ===
[Home] vs [Away]: 1X2 [x.xx/x.xx/x.xx] | O/U 2.5 [x.xx/x.xx] | BTTS [x.xx/x.xx]

=== FORM (last 5) ===
[Team]: [e.g. W3-1 D1-1 L0-2 W2-0 W1-0]

=== HEAD TO HEAD ===
[Team A] vs [Team B]: last 3 results with dates/scores

=== STANDINGS (top 10) ===
1. [Team] [Pts]pts W[w] D[d] L[l] GD[gd]

If you cannot find something, write "Not found" — never invent data.`
      : `You are a football team-news scout. Today is ${fullDate}. Season ${season}.

Find CONFIRMED injury, suspension, and team-news updates for ${leagueName} clubs playing this Friday through Monday. Search official club sites, BBC Sport, Sky Sports, and recent press-conference reports (last 48 hours).

Return ONLY, in this exact structure:

=== INJURIES & SUSPENSIONS ===
[Team]: [Player] — [status, expected return]

=== TEAM NEWS / MANAGER QUOTES ===
[Team]: [anything relevant to team selection or motivation]

If nothing confirmed, write "Nothing new reported" — never invent news.`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 2500 },
        }),
      }
    )

    if (!response.ok) {
      clearTimeout(timeout)
      const errText = await response.text()
      return res.status(200).json({
        success: false, league, mode,
        error: `Gemini ${response.status}: ${errText.slice(0, 200)}`,
      })
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
    } catch (e) {
      if (e.name !== 'AbortError') console.log('scout-league stream error:', e.message)
    }

    clearTimeout(timeout)

    const hasData = collected.length > 80 && collected.includes('===')
    const weekendKey = getWeekendKey(now)

    if (hasData) {
      await saveScoutData(leagueName, mode, collected, weekendKey)
    }

    console.log(`scout-league: ${league} (${mode}) — ${collected.length} chars, saved: ${hasData}`)

    return res.status(200).json({
      success: hasData,
      league: leagueName,
      mode,
      weekendKey,
      chars: collected.length,
    })

  } catch (err) {
    return res.status(200).json({ success: false, league, mode, error: err.message })
  }
}

export const config = { maxDuration: 50 }
