import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, RefreshCw } from 'lucide-react'

const QUICK_QUESTIONS = [
  "What are the most predictable matches this weekend?",
  "Give me the top 20 best bets for this week",
  "Which matches are most likely to have over 2.5 goals?",
  "Best clean sheet predictions this weekend?",
  "Which home teams are most likely to win this week?",
  "What are the safest accumulators for this weekend?",
  "Which matches are likely to be high scoring?",
  "Best both teams to score predictions this week?",
  "Any injury news affecting this weekend's matches?",
  "Which underdogs could cause upsets this weekend?",
]

const SYSTEM_PROMPT = `You are FootballIQ, an elite football analyst and prediction AI with access to real live data including current league standings, recent match results, upcoming fixtures and latest football news.

When analyzing matches always consider:
- Current league position and points
- Recent form (last 5 matches shown as W/D/L)
- Goals scored and conceded home and away
- Half time vs full time scoring patterns
- Head to head from recent results
- Home advantage statistics
- Latest news about injuries and suspensions

IMPORTANT FORMATTING RULES:
- Always use HTML tables for presenting multiple matches or predictions
- Use this exact table format for predictions:
<table>
  <thead>
    <tr><th>Match</th><th>Prediction</th><th>Score</th><th>Confidence</th><th>Best Bet</th><th>Risk</th></tr>
  </thead>
  <tbody>
    <tr><td>Home vs Away</td><td>Home Win</td><td>2-1</td><td>75%</td><td>Home Win & Over 2.5</td><td>Low</td></tr>
  </tbody>
</table>

- Use tables for standings, comparisons and any list of matches
- Use **bold** for key insights
- Use clear sections with headers
- Be comprehensive and detailed in analysis
- Do not cut responses short — always complete the full analysis
- Always end with a responsible gambling reminder`

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `👋 Welcome to <strong>FootballIQ</strong> — your AI football prediction engine!<br/><br/>I'm now loading:<br/>📅 Upcoming fixtures across 16+ leagues<br/>📊 Live standings and team form<br/>⚽ Recent results and scoring patterns<br/>📰 Latest football news and injuries<br/><br/>⏳ Give me a few seconds...`
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fixtures, setFixtures] = useState([])
  const [teamProfiles, setTeamProfiles] = useState({})
  const [recentResults, setRecentResults] = useState([])
  const [news, setNews] = useState([])
  const [dataReady, setDataReady] = useState(false)
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
    setDataReady(false)
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
      setDataReady(true)
      setDataStatus('ready')

      const teamsCount = Object.keys(profiles).length
      const newsCount = articles.length

      const upcomingPreview = matches.slice(0, 5).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
        })
        const homeP = profiles[m.homeTeam]
        const awayP = profiles[m.awayTeam]
        const homePos = homeP ? ` (${homeP.position}th)` : ''
        const awayPos = awayP ? ` (${awayP.position}th)` : ''
        return `• <strong>${m.homeTeam}</strong>${homePos} vs <strong>${m.awayTeam}</strong>${awayPos} — ${date} [${m.competition}]`
      }).join('<br/>')

      const newsPreview = articles.slice(0, 3).map(n =>
        `• ${n.title}`
      ).join('<br/>')

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ <strong>All data loaded and ready!</strong><br/><br/>
📅 <strong>${matches.length} upcoming fixtures</strong> across all leagues<br/>
📊 <strong>${teamsCount} team profiles</strong> with live standings and form<br/>
⚽ <strong>${results.length} recent results</strong> for pattern analysis<br/>
📰 <strong>${newsCount} news articles</strong> including injuries and transfers<br/><br/>
<strong>Upcoming fixtures:</strong><br/>${upcomingPreview}${matches.length > 5 ? `<br/><em>...and ${matches.length - 5} more</em>` : ''}<br/><br/>
<strong>Latest news:</strong><br/>${newsPreview || 'No news loaded'}<br/><br/>
<strong>Ask me anything about this weekend! 👇</strong>`
      }])

    } catch (err) {
      setDataStatus('error')
      setDataReady(true)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Some data couldn't load but I'm still operational!<br/><br/>Ask me about any match and I'll analyze it using my football knowledge. For best results mention the teams, league and any context you know.<br/><br/><strong>What would you like to know? 👇</strong>`
      }])
    }
  }

  const buildContext = () => {
    let context = ''

    if (fixtures.length > 0) {
      context += `\n\n=== UPCOMING FIXTURES (Next 7 days) ===\n`
      context += fixtures.slice(0, 60).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit'
        })
        const homeP = teamProfiles[m.homeTeam]
        const awayP = teamProfiles[m.awayTeam]
        let line = `${date}: ${m.homeTeam} vs ${m.awayTeam} [${m.competition}]`
        if (homeP) line += ` | ${m.homeTeam}: P${homeP.position} ${homeP.won}W ${homeP.drawn}D ${homeP.lost}L GF${homeP.goalsFor} GA${homeP.goalsAgainst} Form:${homeP.form} HomeW:${homeP.homeWon}/${homeP.homePlayed}`
        if (awayP) line += ` | ${m.awayTeam}: P${awayP.position} ${awayP.won}W ${awayP.drawn}D ${awayP.lost}L GF${awayP.goalsFor} GA${awayP.goalsAgainst} Form:${awayP.form} AwayW:${awayP.awayWon}/${awayP.awayPlayed}`
        return line
      }).join('\n')
    }

    if (recentResults.length > 0) {
      context += `\n\n=== RECENT RESULTS ===\n`
      context += recentResults.map(r => {
        const date = new Date(r.date).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short'
        })
        return `${date}: ${r.home} ${r.homeScore}-${r.awayScore} ${r.away} (HT:${r.halfTimeHome ?? '?'}-${r.halfTimeAway ?? '?'}) [${r.competition}]`
      }).join('\n')
    }

    if (news.length > 0) {
      context += `\n\n=== LATEST FOOTBALL NEWS ===\n`
      context += news.slice(0, 20).map(n =>
        `[${n.category}] ${n.title}${n.summary ? ': ' + n.summary.slice(0, 150) : ''}`
      ).join('\n')
    }

    if (Object.keys(teamProfiles).length > 0) {
      context += `\n\n=== LEAGUE STANDINGS ===\n`
      const leagueGroups = {}
      Object.entries(teamProfiles).forEach(([team, data]) => {
        if (!leagueGroups[data.league]) leagueGroups[data.league] = []
        leagueGroups[data.league].push({ team, ...data })
      })
      Object.entries(leagueGroups).forEach(([league, teams]) => {
        context += `\n${league}:\n`
        teams.sort((a, b) => a.position - b.position).slice(0, 12).forEach(t => {
          context += `  ${t.position}. ${t.team} - ${t.points}pts GF${t.goalsFor} GA${t.goalsAgainst} Form:${t.form}\n`
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
      const context = buildContext()

      const conversationHistory = messages
        .filter(m => m.role === 'user' ||
          (m.role === 'assistant' && !m.content.includes('loading')))
        .map(m => ({ role: m.role, content: m.content }))

      const messagesPayload = [
        ...conversationHistory,
        { role: 'user', content: `${text}\n\n${context}` }
      ]

      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: messagesPayload,
        }),
      })

      const data = await response.json()

      if (data.content && data.content[0]) {
        const rawText = data.content[0].text
        const formatted = rawText
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/\n/g, '<br/>')

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: formatted
        }])
      } else {
        throw new Error(data.error?.message || 'Invalid response')
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
            dataStatus === 'ready' && fixtures.length > 0 ? 'badge-green' :
            dataStatus === 'ready' ? 'badge-blue' : 'badge-red'
          }`}>
            {dataStatus === 'loading' ? '⏳ Loading...' :
             dataStatus === 'ready' && fixtures.length > 0
               ? `✅ ${fixtures.length} fixtures | ${news.length} news`
               : dataStatus === 'ready' ? 'ℹ️ Knowledge mode' : '⚠️ Limited data'}
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
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10
          }}>
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
            placeholder="Ask anything... e.g. 'Best bets this weekend?' or 'Analyze Arsenal vs Chelsea'"
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
