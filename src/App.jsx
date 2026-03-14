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
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#1a1a3e', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, color: '#00ff87', fontSize: 13,
                  marginTop: 24,
                }}>VS</div>
                <div>
                  <label style={{ display: 'block', color: '#888', fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
                    ✈️ Away Team
                  </label>
                  <input
                    className="input-field"
                    placeholder="e.g. Chelsea"
                    value={awayTeam}
                    onChange={e => setAwayTeam(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', color: '#888', fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
                  📋 Additional Context <span style={{ color: '#555' }}>(optional but improves accuracy)</span>
                </label>
                <textarea
                  className="input-field"
                  placeholder={`Add any context:\n• Recent form (e.g. Arsenal W W D L W)\n• Key injuries\n• Head to head history\n• Playing style\n• Recent news`}
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  rows={5}
                  style={{ resize: 'vertical' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {PREDICTION_CONTEXTS.map((ctx, i) => (
                    <button
                      key={i}
                      onClick={() => setContext(prev => prev ? `${prev}\n${ctx}: ` : `${ctx}: `)}
                      style={{
                        background: 'rgba(0,255,135,0.05)',
                        border: '1px solid rgba(0,255,135,0.15)',
                        color: '#888', borderRadius: 6,
                        padding: '4px 10px', fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      + {ctx}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div style={{
                  background: 'rgba(255,99,99,0.1)',
                  border: '1px solid rgba(255,99,99,0.3)',
                  borderRadius: 8, padding: '12px 16px',
                  marginBottom: 16, color: '#ff6363', fontSize: 14,
                }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                className="btn-primary"
                onClick={getPrediction}
                disabled={loading}
                style={{ width: '100%', padding: '16px', fontSize: 16, opacity: loading ? 0.7 : 1 }}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    Analysing match...
                  </span>
                ) : '🔮 Generate Prediction'}
              </button>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>⚡ How It Works</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {[
                  { step: '01', title: 'Select Match', desc: 'Choose your league and enter both teams' },
                  { step: '02', title: 'Add Context', desc: 'Add form, injuries, news for better accuracy' },
                  { step: '03', title: 'Get Prediction', desc: 'AI analyses and returns full breakdown' },
                ].map((item, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: 'rgba(0,255,135,0.2)', marginBottom: 8 }}>
                      {item.step}
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{item.title}</div>
                    <div style={{ color: '#666', fontSize: 13 }}>{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {screen === 'result' && prediction && (
          <div>
            <button
              onClick={resetApp}
              style={{
                background: 'transparent', border: 'none', color: '#00ff87',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                gap: 8, marginBottom: 24, fontSize: 14, fontWeight: 600,
              }}
            >
              ← Back to Predictions
            </button>

            <div className="prediction-card" style={{ marginBottom: 24, textAlign: 'center' }}>
              <div style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>{prediction.league}</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>{prediction.match}</div>
              <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 12 }} className="gradient-text">
                {prediction.prediction?.predicted_score}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="badge badge-green">🏆 {prediction.prediction?.winner}</span>
                <span className="badge badge-blue">📊 {prediction.prediction?.confidence}% confidence</span>
                <span className={`badge ${prediction.risk_level === 'Low' ? 'badge-green' : prediction.risk_level === 'High' ? 'badge-red' : 'badge-blue'}`}>
                  ⚡ {prediction.risk_level} Risk
                </span>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📊 Win Probabilities</h3>
              {[
                { label: homeTeam, value: prediction.prediction?.home_win_probability, color: '#00ff87' },
                { label: 'Draw', value: prediction.prediction?.draw_probability, color: '#60efff' },
                { label: awayTeam, value: prediction.prediction?.away_win_probability, color: '#ff6363' },
              ].map((item, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}%</span>
                  </div>
                  <div className="stat-bar">
                    <div className="stat-bar-fill" style={{ width: `${item.value}%`, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>⚽ Goals Analysis</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {[
                  { label: 'Expected Goals', value: prediction.goals?.total_goals_expected },
                  { label: 'Both Teams Score', value: prediction.goals?.both_teams_to_score },
                  { label: 'Over 2.5 Goals', value: prediction.goals?.over_2_5 },
                  { label: 'Best Scoring Half', value: prediction.goals?.most_likely_scoring_half },
                  { label: 'First Half Goals', value: prediction.goals?.first_half_goals },
                  { label: 'Second Half Goals', value: prediction.goals?.second_half_goals },
                ].map((item, i) => (
                  <div key={i} style={{
                    background: '#0a0a1f', borderRadius: 10,
                    padding: '14px 16px', border: '1px solid #1a1a3e'
                  }}>
                    <div style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>{item.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#00ff87' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🧤 Clean Sheet Probability</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: `${homeTeam} Clean Sheet`, value: prediction.clean_sheets?.home_clean_sheet_probability },
                  { label: `${awayTeam} Clean Sheet`, value: prediction.clean_sheets?.away_clean_sheet_probability },
                ].map((item, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>{item.label}</div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#60efff' }}>{item.value}%</div>
                    <div className="stat-bar" style={{ marginTop: 8 }}>
                      <div className="stat-bar-fill" style={{ width: `${item.value}%`, background: '#60efff' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>🧠 Key Insights</h3>
              {prediction.key_insights?.map((insight, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 12, marginBottom: 12,
                  padding: '12px 16px', background: '#0a0a1f',
                  borderRadius: 8, border: '1px solid #1a1a3e',
                }}>
                  <span style={{ color: '#00ff87', fontWeight: 700, minWidth: 20 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ color: '#ccc', fontSize: 14, lineHeight: 1.5 }}>{insight}</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>💰 Best Bets</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {prediction.best_bets?.map((bet, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px',
                    background: 'rgba(0,255,135,0.05)',
                    border: '1px solid rgba(0,255,135,0.15)',
                    borderRadius: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>🎯</span>
                    <span style={{ color: '#ccc', fontSize: 14 }}>{bet}</span>
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: 16, padding: '12px 16px',
                background: 'rgba(255,99,99,0.05)',
                border: '1px solid rgba(255,99,99,0.15)',
                borderRadius: 8, color: '#ff6363', fontSize: 12,
              }}>
                ⚠️ AI-generated suggestions for informational purposes only. Please gamble responsibly.
              </div>
            </div>

            <button className="btn-primary" onClick={resetApp} style={{ width: '100%', padding: 16, fontSize: 16 }}>
              🔮 Make Another Prediction
            </button>
          </div>
        )}
      </main>

      <footer style={{
        borderTop: '1px solid #1a1a3e', padding: '24px',
        textAlign: 'center', color: '#444', fontSize: 13, marginTop: 48,
      }}>
        FootballIQ • Powered by Claude AI • {LEAGUES.length} Leagues Covered
      </footer>
    </div>
  )
}
