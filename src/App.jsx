import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, RefreshCw } from 'lucide-react'

const QUICK_QUESTIONS = [
  "Best 5 bets this weekend across all leagues?",
  "Which matches are most likely to have 2-3 goals?",
  "Best clean sheet predictions this weekend?",
  "Which home teams are banker picks this weekend?",
  "Build me a 5 team accumulator for this weekend",
  "Which teams are most likely to score first?",
  "Best both teams to score picks this weekend?",
  "Which underdogs could cause upsets this weekend?",
]

const SYSTEM_PROMPT = `You are FootballIQ, an elite football analyst with access to real live data including fixtures, standings, recent results and injury news across all major leagues.

IMPORTANT: You will receive real data in every message including:
- Upcoming fixtures with dates and competitions
- Team standings with position, points, goals for/against, form
- Recent match results with half time and full time scores
- Injury news

Always base your analysis on this real data. Never say you don't have data — use what is provided.

When making predictions always consider:
- League position and points
- Recent form (W/D/L sequence)
- Goals scored and conceded at home and away
- Half time scoring patterns from recent results
- Head to head from recent results
- Home advantage

When asked for predictions or bets always provide:
- Clear prediction with confidence %
- Predicted scoreline
- Best betting market
- Risk level Low Medium or High
- Brief reasoning from the data

Always use HTML tables for lists of predictions:
<table>
<thead><tr><th>Match</th><th>League</th><th>Pick</th><th>Market</th><th>Confidence</th><th>Risk</th></tr></thead>
<tbody>
<tr><td>Team A vs Team B</td><td>Premier League</td><td>Team A Win</td><td>1X2</td><td>78%</td><td>Low</td></tr>
</tbody>
</table>

Be decisive and confident. Always end with a responsible gambling reminder.`

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fixtures, setFixtures] = useState([])
  const [teamProfiles, setTeamProfiles] = useState({})
  const [recentResults, setRecentResults] = useState([])
  const [news, setNews] = useState([])
  const [dataStatus, setDataStatus] = useState('loading')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    loadAllData()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadAllData = async () => {
    setDataStatus('loading')
    setMessages([{
      role: 'assistant',
      content: `👋 Welcome to <strong>FootballIQ</strong> — your AI football prediction engine!<br/><br/>⏳ Loading live fixtures, standings and injury news...`
    }])

    try {
      const [fixturesRes, standingsRes, newsRes] = await Promise.all([
        fetch('/api/fixtures'),
        fetch('/api/standings'),
        fetch('/api/news'),
      ])

      const fixturesData = await fixturesRes.json()
      const standingsData = await standingsRes.json()
      const newsData = await newsRes.json()

      const matches = fixturesData.matches || []
      const profiles = standingsData.teamProfiles || {}
      const results = standingsData.recentResults || []
      const articles = newsData.news || []

      setFixtures(matches)
      setTeamProfiles(profiles)
      setRecentResults(results)
      setNews(articles)
      setDataStatus(matches.length > 0 ? 'ready' : 'limited')

      const teamsCount = Object.keys(profiles).length
      const upcomingPreview = matches.slice(0, 6).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
        })
        const homeP = profiles[m.homeTeam]
        const awayP = profiles[m.awayTeam]
        const homePos = homeP ? ` (${homeP.position}th, Form: ${homeP.form})` : ''
        const awayPos = awayP ? ` (${awayP.position}th, Form: ${awayP.form})` : ''
        return `• <strong>${m.homeTeam}</strong>${homePos} vs <strong>${m.awayTeam}</strong>${awayPos} — ${date} [${m.competition}]`
      }).join('<br/>')

      setMessages([{
        role: 'assistant',
        content: `✅ <strong>FootballIQ is ready!</strong><br/><br/>
📅 <strong>${matches.length} upcoming fixtures</strong> loaded<br/>
📊 <strong>${teamsCount} team profiles</strong> with live standings and form<br/>
⚽ <strong>${results.length} recent results</strong> for pattern analysis<br/>
📰 <strong>${articles.length} injury/news items</strong> loaded<br/><br/>
<strong>This weekend's fixtures preview:</strong><br/>
${upcomingPreview}
${matches.length > 6 ? `<br/><em>...and ${matches.length - 6} more fixtures loaded</em>` : ''}<br/><br/>
<strong>Ask me anything or click a quick question below! 👇</strong>`
      }])

    } catch (err) {
      setDataStatus('limited')
      setMessages([{
        role: 'assistant',
        content: `⚠️ <strong>Running in knowledge mode</strong> — live data unavailable right now.<br/><br/>I can still analyze matches using my football knowledge. Ask me about any team or fixture and I'll give you my best analysis!`
      }])
    }
  }

  const buildContext = (userMessage) => {
    let context = '\n\n=== LIVE DATA ==='

    // Smart context — only include relevant leagues based on user message
    const message = userMessage.toLowerCase()
    const allLeagues = Object.values(teamProfiles).map(t => t.league).filter(Boolean)
    const uniqueLeagues = [...new Set(allLeagues)]

    // Filter fixtures to relevant ones
    let relevantFixtures = fixtures
    if (message.includes('premier league') || message.includes('england')) {
      relevantFixtures = fixtures.filter(f => f.competition?.includes('Premier') || f.competition?.includes('Championship'))
    } else if (message.includes('bundesliga') || message.includes('germany')) {
      relevantFixtures = fixtures.filter(f => f.competition?.includes('Bundesliga'))
    } else if (message.includes('la liga') || message.includes('spain')) {
      relevantFixtures = fixtures.filter(f => f.competition?.includes('La Liga'))
    } else if (message.includes('serie a') || message.includes('italy')) {
      relevantFixtures = fixtures.filter(f => f.competition?.includes('Serie A'))
    } else if (message.includes('ligue 1') || message.includes('france')) {
      relevantFixtures = fixtures.filter(f => f.competition?.includes('Ligue 1'))
    }

    // Upcoming fixtures
    if (relevantFixtures.length > 0) {
      context += '\n\nUPCOMING FIXTURES:\n'
      context += relevantFixtures.slice(0, 30).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        })
        const homeP = teamProfiles[m.homeTeam]
        const awayP = teamProfiles[m.awayTeam]
        let line = `${date}: ${m.homeTeam} vs ${m.awayTeam} [${m.competition}]`
        if (homeP) line += ` | HOME: P${homeP.position} W${homeP.won} D${homeP.drawn} L${homeP.lost} GF${homeP.goalsFor} GA${homeP.goalsAgainst} Form:${homeP.form} HomeGoals:${homeP.homeGoalsFor}scored/${homeP.homeGoalsAgainst}conceded`
        if (awayP) line += ` | AWAY: P${awayP.position} W${awayP.won} D${awayP.drawn} L${awayP.lost} GF${awayP.goalsFor} GA${awayP.goalsAgainst} Form:${awayP.form} AwayGoals:${awayP.awayGoalsFor}scored/${awayP.awayGoalsAgainst}conceded`
        return line
      }).join('\n')
    }

    // Recent results
    if (recentResults.length > 0) {
      context += '\n\nRECENT RESULTS (with half time scores):\n'
      context += recentResults.slice(0, 30).map(r => {
        const date = new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        return `${date}: ${r.home} ${r.homeScore}-${r.awayScore} ${r.away} (HT:${r.halfTimeHome ?? '?'}-${r.halfTimeAway ?? '?'}) [${r.competition}]`
      }).join('\n')
    }

    // Injuries
    if (news.length > 0) {
      context += '\n\nINJURY NEWS:\n'
      context += news.slice(0, 15).map(n => n.title).join('\n')
    }

    // League standings summary
    if (Object.keys(teamProfiles).length > 0) {
      context += '\n\nLEAGUE STANDINGS:\n'
      const leagueGroups = {}
      Object.entries(teamProfiles).forEach(([team, data]) => {
        if (!leagueGroups[data.league]) leagueGroups[data.league] = []
        leagueGroups[data.league].push({ team, ...data })
      })
      Object.entries(leagueGroups).slice(0, 6).forEach(([league, teams]) => {
        context += `\n${league} Top 8:\n`
        teams.sort((a, b) => a.position - b.position).slice(0, 8).forEach(t => {
          context += `${t.position}. ${t.team} ${t.points}pts GF${t.goalsFor} GA${t.goalsAgainst} Form:${t.form}\n`
        })
      })
    }

    return context
  }

  const sendMessage = async (messageText) => {
    const text = messageText || input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)

    const userMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])

    try {
      const context = buildContext(text)
      const contextualMessage = `${text}\n${context}`

      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: contextualMessage }],
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Server error: ${response.status}`)
      }

      const data = await response.json()

      if (data.content && data.content[0]) {
        const rawText = data.content[0].text
        const formatted = rawText
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/###\s(.*?)(<br>|$)/g, '<h3 style="margin:12px 0 6px;color:#1d4ed8">$1</h3>')
          .replace(/##\s(.*?)(<br>|$)/g, '<h2 style="margin:14px 0 8px;color:#1d4ed8">$1</h2>')
          .replace(/\n/g, '<br/>')

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: formatted
        }])
      } else {
        throw new Error(data.error?.message || 'No response from AI')
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Something went wrong: ${err.message}. Please try again.`
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8faff',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #e2e8f0',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#ffffff',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 38, height: 38, borderRadius: '10px',
            background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
          }}>
            <Trophy size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#1a1a2e' }}>
              Football<span className="gradient-text">IQ</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -2 }}>
              AI Match Predictor
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${
            dataStatus === 'loading' ? 'badge-blue' :
            dataStatus === 'ready' ? 'badge-green' : 'badge-blue'
          }`}>
            {dataStatus === 'loading' ? '⏳ Loading...' :
             dataStatus === 'ready' ? `✅ ${fixtures.length} fixtures loaded` :
             'ℹ️ Knowledge mode'}
          </span>
          <button
            onClick={loadAllData}
            style={{
              background: '#f8faff',
              border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '6px 12px',
              cursor: 'pointer', color: '#64748b',
              display: 'flex', alignItems: 'center',
              gap: 6, fontSize: 12, fontWeight: 500,
            }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </header>

      {/* Quick Questions */}
      <div style={{
        borderBottom: '1px solid #e2e8f0',
        padding: '10px 24px',
        display: 'flex', gap: 8,
        overflowX: 'auto', background: '#ffffff',
      }}>
        {QUICK_QUESTIONS.map((q, i) => (
          <button
            key={i}
            onClick={() => sendMessage(q)}
            disabled={loading}
            style={{
              background: '#f0f7ff',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 12, fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseOver={e => {
              e.target.style.background = '#dbeafe'
              e.target.style.borderColor = '#3b82f6'
            }}
            onMouseOut={e => {
              e.target.style.background = '#f0f7ff'
              e.target.style.borderColor = '#bfdbfe'
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '24px 16px',
        display: 'flex', flexDirection: 'column',
        gap: 16, maxWidth: 960,
        width: '100%', margin: '0 auto',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            alignItems: 'flex-start',
            gap: 10,
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 34, height: 34, borderRadius: '10px',
                background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(59,130,246,0.2)',
              }}>
                <Trophy size={16} color="#fff" />
              </div>
            )}
            <div
              style={{
                maxWidth: msg.role === 'assistant' ? '90%' : '75%',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)'
                  : '#ffffff',
                color: msg.role === 'user' ? '#ffffff' : '#1e293b',
                borderRadius: msg.role === 'user'
                  ? '18px 18px 4px 18px'
                  : '4px 18px 18px 18px',
                padding: '14px 18px',
                fontSize: 14,
                lineHeight: 1.7,
                border: msg.role === 'assistant'
                  ? '1px solid #e2e8f0' : 'none',
                boxShadow: msg.role === 'assistant'
                  ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                overflowX: 'auto',
              }}
              dangerouslySetInnerHTML={{ __html: msg.content }}
            />
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '10px',
              background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(59,130,246,0.2)',
            }}>
              <Trophy size={16} color="#fff" />
            </div>
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '4px 18px 18px 18px',
              padding: '14px 20px',
              display: 'flex', gap: 6,
              alignItems: 'center',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              {[0, 1, 2].map(j => (
                <div key={j} style={{
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  animation: `bounce 1s ease infinite ${j * 0.2}s`,
                }} />
              ))}
              <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 13 }}>
                Analysing matches...
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid #e2e8f0',
        padding: '16px 24px',
        background: '#ffffff',
        boxShadow: '0 -1px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          maxWidth: 960, margin: '0 auto',
          display: 'flex', gap: 12,
          alignItems: 'flex-end',
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Ask anything... e.g. 'Best bets this weekend?' or 'Which teams are likely to score first?'"
            className="input-field"
            rows={2}
            style={{
              flex: 1, resize: 'none',
              borderRadius: 12, lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="btn-primary"
            style={{
              padding: '12px 20px',
              borderRadius: 12,
              opacity: loading || !input.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
              flexShrink: 0,
            }}
          >
            <Send size={18} />
          </button>
        </div>
        <div style={{
          textAlign: 'center', color: '#94a3b8',
          fontSize: 11, marginTop: 10,
        }}>
          FootballIQ • Powered by Claude AI • Please gamble responsibly 🎗️
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-8px); }
        }
        table { margin: 12px 0; }
        @media (max-width: 600px) {
          table { font-size: 11px; }
          thead th, tbody td { padding: 8px 10px; }
        }
      `}</style>
    </div>
  )
}
