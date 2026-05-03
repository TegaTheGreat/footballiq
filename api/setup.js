import { setupDatabase } from './db.js'

export default async function handler(req, res) {
  try {
    await setupDatabase()
    res.status(200).json({ success: true, message: 'All tables created' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
