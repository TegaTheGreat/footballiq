// =============================================================
// api/db.js — Vercel Postgres database layer
// Run setupDatabase() once to create all tables
// =============================================================

import { sql } from '@vercel/postgres'

export { sql }

export async function setupDatabase() {
  // Teams table — ELO ratings, persistent stats
  await sql`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      league VARCHAR(100),
      elo_rating FLOAT DEFAULT 1500,
      matches_played INT DEFAULT 0,
      wins INT DEFAULT 0,
      draws INT DEFAULT 0,
      losses INT DEFAULT 0,
      goals_for INT DEFAULT 0,
      goals_against INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `

  // Matches table — historical results
  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      home_team VARCHAR(100) NOT NULL,
      away_team VARCHAR(100) NOT NULL,
      league VARCHAR(100),
      match_date DATE,
      home_goals INT,
      away_goals INT,
      result CHAR(1),
      home_elo_before FLOAT,
      away_elo_before FLOAT,
      home_odds FLOAT,
      draw_odds FLOAT,
      away_odds FLOAT,
      over25_odds FLOAT,
      btts_yes_odds FLOAT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  // Predictions table — every Claude prediction
  await sql`
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      match_date DATE,
      home_team VARCHAR(100) NOT NULL,
      away_team VARCHAR(100) NOT NULL,
      league VARCHAR(100),
      market VARCHAR(50) NOT NULL,
      pick VARCHAR(100) NOT NULL,
      confidence INT,
      odds FLOAT,
      result VARCHAR(20) DEFAULT 'pending',
      actual_outcome VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP
    )
  `

  // Intelligence table — Gemini daily research stored permanently
  await sql`
    CREATE TABLE IF NOT EXISTS intelligence (
      id SERIAL PRIMARY KEY,
      intel_type VARCHAR(50) NOT NULL,
      league VARCHAR(100),
      team VARCHAR(100),
      content TEXT NOT NULL,
      source VARCHAR(100) DEFAULT 'gemini',
      match_date DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  // Odds snapshots — historical odds for backtesting
  await sql`
    CREATE TABLE IF NOT EXISTS odds_snapshots (
      id SERIAL PRIMARY KEY,
      home_team VARCHAR(100) NOT NULL,
      away_team VARCHAR(100) NOT NULL,
      league VARCHAR(100),
      match_date DATE,
      market VARCHAR(50),
      home_odds FLOAT,
      draw_odds FLOAT,
      away_odds FLOAT,
      over15_odds FLOAT,
      over25_odds FLOAT,
      over35_odds FLOAT,
      btts_yes_odds FLOAT,
      btts_no_odds FLOAT,
      asian_handicap_home FLOAT,
      asian_handicap_away FLOAT,
      first_half_home FLOAT,
      first_half_draw FLOAT,
      first_half_away FLOAT,
      snapshot_at TIMESTAMP DEFAULT NOW()
    )
  `

  console.log('Database setup complete')
}

// ELO calculation
export function calculateElo(homeRating, awayRating, homeGoals, awayGoals, k = 32) {
  const homeAdv = 65
  const expectedHome = 1 / (1 + Math.pow(10, (awayRating - (homeRating + homeAdv)) / 400))
  const expectedAway = 1 - expectedHome

  let actualHome, actualAway
  if (homeGoals > awayGoals) { actualHome = 1; actualAway = 0 }
  else if (homeGoals < awayGoals) { actualHome = 0; actualAway = 1 }
  else { actualHome = 0.5; actualAway = 0.5 }

  const goalDiff = Math.abs(homeGoals - awayGoals)
  const margin = Math.log(goalDiff + 1) * 1.0

  const newHomeRating = homeRating + k * margin * (actualHome - expectedHome)
  const newAwayRating = awayRating + k * margin * (actualAway - expectedAway)

  return { newHomeRating, newAwayRating, expectedHome, expectedAway }
}

// Save prediction to DB
export async function savePrediction(prediction) {
  try {
    await sql`
      INSERT INTO predictions (match_date, home_team, away_team, league, market, pick, confidence, odds)
      VALUES (${prediction.match_date}, ${prediction.home_team}, ${prediction.away_team},
              ${prediction.league}, ${prediction.market}, ${prediction.pick},
              ${prediction.confidence}, ${prediction.odds})
    `
  } catch (e) {
    console.log('savePrediction error:', e.message)
  }
}

// Get prediction history + win rates
export async function getPredictionStats() {
  try {
    const total = await sql`SELECT COUNT(*) as count FROM predictions`
    const won = await sql`SELECT COUNT(*) as count FROM predictions WHERE result = 'won'`
    const lost = await sql`SELECT COUNT(*) as count FROM predictions WHERE result = 'lost'`
    const pending = await sql`SELECT COUNT(*) as count FROM predictions WHERE result = 'pending'`

    const byMarket = await sql`
      SELECT market,
        COUNT(*) as total,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as losses
      FROM predictions
      WHERE result != 'pending'
      GROUP BY market
      ORDER BY wins DESC
    `

    const recent = await sql`
      SELECT * FROM predictions
      ORDER BY created_at DESC
      LIMIT 20
    `

    return {
      total: total.rows[0].count,
      won: won.rows[0].count,
      lost: lost.rows[0].count,
      pending: pending.rows[0].count,
      winRate: total.rows[0].count > 0
        ? Math.round((won.rows[0].count / (won.rows[0].count + lost.rows[0].count || 1)) * 100)
        : 0,
      byMarket: byMarket.rows,
      recent: recent.rows
    }
  } catch (e) {
    console.log('getPredictionStats error:', e.message)
    return null
  }
}

// Save intelligence entry
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

// Get recent intelligence for a team or league
export async function getIntelligence(league = null, team = null, days = 14) {
  try {
    if (team) {
      const result = await sql`
        SELECT * FROM intelligence
        WHERE team = ${team}
        AND created_at > NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
        LIMIT 10
      `
      return result.rows
    }
    if (league) {
      const result = await sql`
        SELECT * FROM intelligence
        WHERE league = ${league}
        AND created_at > NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
        LIMIT 20
      `
      return result.rows
    }
    const result = await sql`
      SELECT * FROM intelligence
      WHERE created_at > NOW() - INTERVAL '${days} days'
      ORDER BY created_at DESC
      LIMIT 50
    `
    return result.rows
  } catch (e) {
    console.log('getIntelligence error:', e.message)
    return []
  }
}

// Save odds snapshot
export async function saveOddsSnapshot(fixture) {
  try {
    await sql`
      INSERT INTO odds_snapshots (
        home_team, away_team, league, match_date,
        home_odds, draw_odds, away_odds,
        over25_odds, btts_yes_odds
      ) VALUES (
        ${fixture.home_team}, ${fixture.away_team}, ${fixture.league}, ${fixture.match_date},
        ${fixture.home_odds}, ${fixture.draw_odds}, ${fixture.away_odds},
        ${fixture.over25_odds}, ${fixture.btts_yes_odds}
      )
    `
  } catch (e) {
    console.log('saveOddsSnapshot error:', e.message)
  }
}
