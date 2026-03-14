import { useState } from 'react'
import { Trophy, TrendingUp, Shield, Zap } from 'lucide-react'

const LEAGUES = [
  { id: 'PL', name: 'Premier League', country: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 England' },
  { id: 'ELC', name: 'Championship', country: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 England' },
  { id: 'EL1', name: 'League One', country: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 England' },
  { id: 'BSA', name: 'Série A', country: '🇧🇷 Brazil' },
  { id: 'SA', name: 'Serie A', country: '🇮🇹 Italy' },
  { id: 'PD', name: 'La Liga', country: '🇪🇸 Spain' },
  { id: 'BL1', name: 'Bundesliga', country: '🇩🇪 Germany' },
  { id: 'FL1', name: 'Ligue 1', country: '🇫🇷 France' },
  { id: 'SPL', name: 'Scottish Premiership', country: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland' },
  { id: 'DED', name: 'Eredivisie', country: '🇳🇱 Netherlands' },
  { id: 'PPL', name: 'Primeira Liga', country: '🇵🇹 Portugal' },
  { id: 'BEL', name: 'Pro League', country: '🇧🇪 Belgium' },
  { id: 'SAU', name: 'Saudi Pro League', country: '🇸🇦 Saudi Arabia' },
  { id: 'ARG', name: 'Primera División', country: '🇦🇷 Argentina' },
  { id: 'MX1', name: 'Liga MX', country: '🇲🇽 Mexico' },
  { id: 'CL', name: 'Champions League', country: '🌍 Europe' },
  { id: 'EL', name: 'Europa League', country: '🌍 Europe' },
  { id: 'COPA', name: 'Copa America', country: '🌎 Americas' },
]

const PREDICTION_CONTEXTS = [
  'Last 5 match results',
  'Head to head history',
  'Home/Away form',
  'Goals scored per half',
  'Clean sheet record',
  'Key injuries/suspensions',
  'Playing style',
  'Recent news',
]

export default function App() {
  const [screen, setScreen] = useState('home')
  const [selectedLeague, setSelectedLeague] = useState('')
  const [homeTeam, setHomeTeam] = useState('')
  const [awayTeam, setAwayTeam] = useState('')
  const [context, setContext] = useState('')
  const [prediction, setPrediction] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const getPrediction = async () => {
    if (!homeTeam || !awayTeam || !selectedLeague) {
      setError('Please fill in all fields')
      return
    }
    setError('')
    setLoading(true)
    setPrediction(null)

    try {
      const league = LEAGUES.find(l => l.id === selectedLeague)
      const prompt = `You are an expert football analyst and predictor. Analyze this upcoming match and provide a detailed prediction.

MATCH: ${homeTeam} vs ${awayTeam}
LEAGUE: ${league?.name} (${league?.country})
ADDITIONAL CONTEXT: ${context || 'No additional context provided'}

Respond ONLY with this exact JSON, no extra text:
{
  "match": "${homeTeam} vs ${awayTeam}",
  "league": "${league?.name}",
  "prediction": {
    "winner": "either '${homeTeam}', '${awayTeam}', or 'Draw'",
    "confidence": 75,
    "predicted_score": "2-1",
    "home_win_probability": 55,
    "draw_probability": 25,
    "away_win_probability": 20
  },
  "goals": {
    "total_goals_expected": 2.5,
    "both_teams_to_score": "Yes",
    "over_2_5": "Yes",
    "first_half_goals": 1.1,
    "second_half_goals": 1.4,
    "most_likely_scoring_half": "Second Half"
  },
  "clean_sheets": {
    "home_clean_sheet_probability": 30,
    "away_clean_sheet_probability": 20
  },
  "key_insights": [
    "insight 1",
    "insight 2",
    "insight 3",
    "insight 4"
  ],
  "best_bets": [
    "bet suggestion 1",
    "bet suggestion 2",
    "bet suggestion 3"
  ],
  "risk_level": "Medium"
}`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      const data = await response.json()
      const text = data.content[0].text
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setPrediction(parsed)
      setScreen('result')
    } catch (err) {
      setError('Something went wrong. Check your API key and try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const resetApp = () => {
    setScreen('home')
    setPrediction(null)
    setHomeTeam('')
    setAwayTeam('')
    setSelectedLeague('')
    setContext('')
    setError('')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #1a1a3e',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        background: 'rgba(10,10,15,0.95)',
        backdropFilter: 'blur(10px)',
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '10px',
            background: 'linear-gradient(135deg, #00ff87, #60efff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Trophy size={20} color="#0a0a0f" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>
              Football<span className="gradient-text">IQ</span>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: -2 }}>AI Match Predictor</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge badge-green">⚡ AI Powered</span>
          <span className="badge badge-blue">🌍 {LEAGUES.length} Leagues</span>
        </div>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
        {screen === 'home' && (
          <div>
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.2)',
                borderRadius: 20, padding: '6px 16px', marginBottom: 24,
                fontSize: 13, color: '#00ff87'
              }}>
                <Zap size={14} /> Powered by Claude AI
              </div>
              <h1 style={{ fontSize: 48, fontWeight: 900, lineHeight: 1.1, marginBottom: 16 }}>
                Predict Any<br />
                <span className="gradient-text">Football Match</span>
              </h1>
              <p style={{ color: '#888', fontSize: 18, maxWidth: 500, margin: '0 auto' }}>
                AI-powered predictions covering scorelines, goal timing, clean sheets and more across {LEAGUES.length} leagues worldwide.
              </p>
            </div>

            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
              {[
                { icon: <Trophy size={20} />, label: 'Leagues', value: '18+' },
                { icon: <TrendingUp size={20} />, label: 'Data Points', value: '12+' },
                { icon: <Shield size={20} />, label: 'Predictions', value: 'Unlimited' },
              ].map((stat, i) => (
                <div key={i} className="card" style={{ textAlign: 'center' }}>
                  <div style={{ color: '#00ff87', marginBottom: 8 }}>{stat.icon}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{stat.value}</div>
                  <div style={{ color: '#666', fontSize: 13 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Form */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>🔮 Get a Prediction</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', color: '#888', fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
                  Select League
                </label>
                <select
                  className="input-field"
                  value={selectedLeague}
                  onChange={e => setSelectedLeague(e.target.value)}
                >
                  <option value="">Choose a league...</option>
                  {LEAGUES.map(l => (
                    <option key={l.id} value={l.id}>{l.country} {l.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', color: '#888', fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
                    🏠 Home Team
                  </label>
                  <input
                    className="input-field"
                    placeholder="e.g. Arsenal"
                    value={homeTeam}
                    onChange={e => setHomeTeam(e.target.value)}
                  />
                </div>
