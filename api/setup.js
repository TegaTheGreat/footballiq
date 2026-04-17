// =============================================================
// api/setup.js — Run once to create database tables
// Visit /api/setup in browser after deploying
// =============================================================

import { setupDatabase } from './db.js'

export default async function handler(req, res) {
  try {
    await setupDatabase()
    return res.status(200).json({ success: true, message: 'Database ready' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
