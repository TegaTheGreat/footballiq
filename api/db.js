// =============================================================
// api/db.js — Vercel Postgres database layer
// Stores predictions, results, intelligence, ELO ratings
// =============================================================

import { sql } from '@vercel/postgres'
export { sql }

export async function setupDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      match_date DATE,
      home_team VARCHAR(100) NOT NULL,
      away_team VARCHAR(100) NOT NULL,
      league VARCHAR(100),
      market VARCHAR(100) NOT NULL,
      pick VARCHAR(200) NOT NULL,
      confidence INT,
      odds FLOAT,
      result VARCHAR(20) DEFAULT 'pending',
      actual_score VARCHAR(20),
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS intelligence (
      id SERIAL PRIMARY KEY,
      intel_type VARCHAR(50) NOT NULL,
      league VARCHAR(100),
      team VARCHAR(100),
      content TEXT NOT NULL,
      match_date DATE,
      source VARCHAR(100) DEFAULT 'gemini',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      league VARCHAR(100),
      elo_rating FLOAT DEFAULT 1500,
      wins INT DEFAULT 0,
      draws INT DEFAULT 0,
      losses INT DEFAULT 0,
      goals_for INT DEFAULT 0,
      goals_against INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `

  console.log('Database ready')
}

// -------------------------------------------------------
// PREDICTIONS
// -------------------------------------------------------
export async function savePrediction(pred) {
  try {
    await sql`
      INSERT INTO predictions
        (match_date, home_team, away_team, league, market, pick, confidence, odds)
      VALUES
        (${pred.match_date}, ${pred.home_team}, ${pred.away_team},
         ${pred.league}, ${pred.market}, ${pred.pick},
         ${pred.confidence || null}, ${pred.odds || null})
    `
  } catch (e) {
    console.log('savePrediction error:', e.message)
  }
}

export async function getPredictionStats() {
  try {
    const [totals, byMarket, recent] = await Promise.all([
      sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
          SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
          SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending
        FROM predictions
      `,
      sql`
        SELECT market,
          COUNT(*) as total,
          SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as losses
        FROM predictions
        WHERE result != 'pending'
        GROUP BY market
        ORDER BY wins DESC
        LIMIT 8
      `,
      sql`
        SELECT * FROM predictions
        ORDER BY created_at DESC
        LIMIT 10
      `
    ])

    const t = totals.rows[0]
    const resolved = parseInt(t.won) + parseInt(t.lost)

    return {
      total: parseInt(t.total),
      won: parseInt(t.won),
      lost: parseInt(t.lost),
      pending: parseInt(t.pending),
      winRate: resolved > 0 ? Math.round((parseInt(t.won) / resolved) * 100) : 0,
      byMarket: byMarket.rows,
      recent: recent.rows,
    }
  } catch (e) {
    console.log('getPredictionStats error:', e.message)
    return null
  }
}

export async function resolvePendingPredictions(results) {
  // results = [{ home_team, away_team, home_goals, away_goals }]
  for (const r of results) {
    try {
      const pending = await sql`
        SELECT * FROM predictions
        WHERE result = 'pending'
        AND home_team ILIKE ${'%' + r.home_team + '%'}
        AND away_team ILIKE ${'%' + r.away_team + '%'}
      `

      for (const pred of pending.rows) {
        const hg = r.home_goals
        const ag = r.away_goals
        const total = hg + ag
        let outcome = 'lost'

        const pick = pred.pick.toLowerCase()
        if (pick.includes('home win') && hg > ag) outcome = 'won'
        else if (pick.includes('away win') && ag > hg) outcome = 'won'
        else if (pick.includes('draw') && hg === ag) outcome = 'won'
        else if (pick.includes('over 2.5') && total > 2.5) outcome = 'won'
        else if (pick.includes('under 2.5') && total < 2.5) outcome = 'won'
        else if (pick.includes('over 1.5') && total > 1.5) outcome = 'won'
        else if (pick.includes('over 3.5') && total > 3.5) outcome = 'won'
        else if (pick.includes('btts yes') && hg > 0 && ag > 0) outcome = 'won'
        else if (pick.includes('btts no') && (hg === 0 || ag === 0)) outcome = 'won'
        else if (pick.includes('1x') && (hg >= ag)) outcome = 'won'
        else if (pick.includes('x2') && (ag >= hg)) outcome = 'won'
        else if (pick.includes('12') && hg !== ag) outcome = 'won'

        await sql`
          UPDATE predictions
          SET result = ${outcome},
              actual_score = ${hg + '-' + ag},
              resolved_at = NOW()
          WHERE id = ${pred.id}
        `
      }
    } catch (e) {
      console.log('resolve error:', e.message)
    }
  }
}

// -------------------------------------------------------
// INTELLIGENCE
// -------------------------------------------------------
export async function saveIntelligence(type, league, team, content, matchDate = null) {
  try {
    await sql`
      INSERT INTO intelligence (intel_type, league, team, content, match_date)
      VALUES (${type}, ${league}, ${team}, ${content}, ${matchDate})
    `
  } catch (e) {
    console.log('saveIntelligence error:', e.message)
  }
}

export async function getRecentIntelligence(days = 14) {
  try {
    const result = await sql`
      SELECT * FROM intelligence
      WHERE created_at > NOW() - (${days} || ' days')::INTERVAL
      ORDER BY created_at DESC
      LIMIT 30
    `
    return result.rows
  } catch (e) {
    console.log('getIntelligence error:', e.message)
    return []
  }
}

// -------------------------------------------------------
// ELO
// -------------------------------------------------------
export async function updateTeamElo(homeTeam, awayTeam, homeGoals, awayGoals, league) {
  try {
    const homeRow = await sql`SELECT * FROM teams WHERE name = ${homeTeam}`
    const awayRow = await sql`SELECT * FROM teams WHERE name = ${awayTeam}`

    const homeElo = homeRow.rows[0]?.elo_rating || 1500
    const awayElo = awayRow.rows[0]?.elo_rating || 1500

    const K = 32
    const homeAdv = 65
    const expected = 1 / (1 + Math.pow(10, (awayElo - (homeElo + homeAdv)) / 400))
    const actual = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0
    const goalDiff = Math.abs(homeGoals - awayGoals)
    const margin = Math.log(goalDiff + 1)

    const newHome = homeElo + K * margin * (actual - expected)
    const newAway = awayElo + K * margin * ((1 - actual) - (1 - expected))

    await sql`
      INSERT INTO teams (name, league, elo_rating, wins, draws, losses, goals_for, goals_against)
      VALUES (${homeTeam}, ${league}, ${newHome},
        ${homeGoals > awayGoals ? 1 : 0},
        ${homeGoals === awayGoals ? 1 : 0},
        ${homeGoals < awayGoals ? 1 : 0},
        ${homeGoals}, ${awayGoals})
      ON CONFLICT (name) DO UPDATE SET
        elo_rating = ${newHome},
        wins = teams.wins + ${homeGoals > awayGoals ? 1 : 0},
        draws = teams.draws + ${homeGoals === awayGoals ? 1 : 0},
        losses = teams.losses + ${homeGoals < awayGoals ? 1 : 0},
        goals_for = teams.goals_for + ${homeGoals},
        goals_against = teams.goals_against + ${awayGoals},
        updated_at = NOW()
    `

    await sql`
      INSERT INTO teams (name, league, elo_rating, wins, draws, losses, goals_for, goals_against)
      VALUES (${awayTeam}, ${league}, ${newAway},
        ${awayGoals > homeGoals ? 1 : 0},
        ${awayGoals === homeGoals ? 1 : 0},
        ${awayGoals < homeGoals ? 1 : 0},
        ${awayGoals}, ${homeGoals})
      ON CONFLICT (name) DO UPDATE SET
        elo_rating = ${newAway},
        wins = teams.wins + ${awayGoals > homeGoals ? 1 : 0},
        draws = teams.draws + ${awayGoals === homeGoals ? 1 : 0},
        losses = teams.losses + ${awayGoals < homeGoals ? 1 : 0},
        goals_for = teams.goals_for + ${awayGoals},
        goals_against = teams.goals_against + ${homeGoals},
        updated_at = NOW()
    `
  } catch (e) {
    console.log('updateTeamElo error:', e.message)
  }
}

export async function getTeamElo(teamName) {
  try {
    const result = await sql`
      SELECT * FROM teams WHERE name ILIKE ${'%' + teamName + '%'}
    `
    return result.rows[0] || null
  } catch (e) {
    return null
  }
}
