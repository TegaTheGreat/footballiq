import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, RefreshCw, Newspaper } from 'lucide-react'

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

const SYSTEM_PROMPT = `You are FootballIQ, an elite football analyst and prediction AI with access to real live data including:
- Current league standings and form
- Recent match results with half-time and full-time scores
- Upcoming fixtures across 16+ leagues
- Latest football news including injuries and transfers

When analyzing matches always consider:
- Current league position and points
- Recent form (last 5 matches shown as W/D/L)
- Goals scored and conceded home and away
- Half time vs full time scoring patterns from recent results
- Head to head from recent results data
- Home advantage (home win %, home goals)
- Away performance (away win %, away goals)
- Latest news about injuries, suspensions, transfers

When asked for predictions always provide:
- Winner prediction with confidence %
- Predicted scoreline
- Which half most likely to see goals
- Clean sheet probability for each team
- Best betting markets (1X2, BTTS, Over/Under, Correct Score)
- Risk level (Low/Medium/High)
- Key reasoning based on real data

When asked for top bets or accumulators:
- Rank by confidence level
- Mix different bet types
- Flag high risk picks clearly
- Suggest 3-4 team accumulators

Format responses with emojis, bold text and clear sections.
Always end with a responsible gambling reminder.`

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `👋 Welcome to **FootballIQ** — your AI football prediction engine!\n\nI'm now loading:\n📅 Upcoming fixtures across 16+ leagues\n📊 Live standings and team form\n⚽ Recent results and scoring patterns\n📰 Latest football news and injuries\n\n⏳ Give me a few seconds...`
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

      // Build status message
      const teamsCount = Object.keys(profiles).length
      const newsCount = articles.length

      const upcomingPreview = matches.slice(0, 5).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
        })
        const homeP = profiles[m.homeTeam]
        const awayP = profiles[m.awayTeam]
        const homePos = homeP ? ` (${homeP.position}th, ${homeP.form})` : ''
        const awayPos = awayP ? ` (${awayP.position}th, ${awayP.form})` : ''
        return `• **${m.homeTeam}**${homePos} vs **${m.awayTeam}**${awayPos} — ${date} [${m.competition}]`
      }).join('\n')

      const newsPreview = articles.slice(0, 3).map(n =>
        `• ${n.title}`
      ).join('\n')

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **All data loaded and ready!**\n\n📅 **${matches.length} upcoming fixtures** across all leagues\n📊 **${teamsCount} team profiles** with live standings and form\n⚽ **${results.length} recent results** for pattern analysis\n📰 **${newsCount} news articles** including injuries and transfers\n\n**Upcoming fixtures:**\n${upcomingPreview}${matches.length > 5 ? `\n*...and ${matches.length - 5} more*` : ''}\n\n**Latest news:**\n${newsPreview || 'No news loaded'}\n\n**Ask me anything about this weekend! 👇**`
      }])

    } catch (err) {
      setDataStatus('error')
      setDataReady(true)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Some data couldn't load but I'm still operational!\n\nYou can ask me about any match and I'll use my football knowledge to analyze it. For best results mention:\n• The teams playing\n• The league\n• Any context you know (injuries, form, head to head)\n\n**What would you like to know? 👇**`
      }])
    }
  }

  const buildContext = () => {
    let context = ''

    if (fixtures.length > 0) {
      context += `\n\n=== UPCOMING FIXTURES (Next 7 days) ===\n`
      context += fixtures.slice(0, 60).map(m => {
        const date = new Date(m.date).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
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
      context += `\n\n=== RECENT RESULTS (Last 100 matches) ===\n`
      context += recentResults.map(r => {
        const date = new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        return `${date}: ${r.home} ${r.homeScore}-${r.awayScore} ${r.away} (HT:${r.halfTimeHome ?? '?'}-${r.halfTimeAway ?? '?'}) [${r.competition}]`
      }).join('\n')
    }

    if (news.length > 0) {
      context += `\n\n=== LATEST FOOTBALL NEWS ===\n`
      context += news.slice(0, 20).map(n =>
        `[${n.category}] ${n.title}${n.summary ? ': ' + n.summary.slice(0, 100) : ''}`
      ).join('\n')
    }

    if (Object.keys(teamProfiles).length > 0) {
      context += `\n\n=== LEAGUE STANDINGS (Top 10 per league) ===\n`
      const leagueGroups = {}
      Object.entries(teamProfiles).forEach(([team, data]) => {
        if (!leagueGroups[data.league]) leagueGroups[data.league] = []
        leagueGroups[data.league].push({ team, ...data })
      })
      Object.entries(leagueGroups).forEach(([league, teams]) => {
        context += `\n${league}:\n`
        teams.sort((a, b) => a.position - b.position).slice(0, 10).forEach(t => {
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
        .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.content.includes('loading')))
        .map(m => ({ role: m.role, content: m.content }))

      const messagesPayload = [
        ...conversationHistory,
        {
          role: 'user',
          content: `${text}\n\n${context}`
        }
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
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content[0].text
        }])
      } else {
        throw new Error(data.error?.message || 'Invalid response from AI')
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

  const formatMessage = (content) => {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #1a1a3e',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${
            dataStatus === 'loading' ? 'badge-blue' :
            dataStatus === 'ready' && fixtures.length > 0 ? 'badge-green' :
            dataStatus === 'ready' ? 'badge-blue' : 'badge-red'
          }`}>
            {dataStatus === 'loading' ? '⏳ Loading data...' :
             dataStatus === 'ready' && fixtures.length > 0 ? `✅ ${fixtures.length} fixtures | ${news.length} news` :
             dataStatus === 'ready' ? 'ℹ️ Knowledge mode' : '⚠️ Limited data'}
          </span>
          <button
            onClick={loadAllData}
            style={{
              background: 'transparent', border: '1px solid #1a1a3e',
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
              color: '#666', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12,
            }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </header>

      {/* Quick Questions */}
      <div style={{
        borderBottom: '1px solid #1a1a3e',
        padding: '12px 24px',
        display: 'flex', gap: 8, overflowX: 'auto',
        background: '#0d0d18',
      }}>
        {QUICK_QUESTIONS.map((q, i) => (
          <button
            key={i}
            onClick={() => sendMessage(q)}
            disabled={loading}
            style={{
              background: 'rgba(0,255,135,0.05)',
              border: '1px solid rgba(0,255,135,0.15)',
              color: '#888', borderRadius: 20,
              padding: '6px 14px', fontSize: 12,
              cursor: 'pointer', whiteSpace: 'nowrap',
              flexShrink: 0, transition: 'all 0.2s',
            }}
            onMouseOver={e => {
              e.target.style.color = '#00ff87'
              e.target.style.borderColor = 'rgba(0,255,135,0.4)'
            }}
            onMouseOut={e => {
              e.target.style.color = '#888'
              e.target.style.borderColor = 'rgba(0,255,135,0.15)'
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '24px',
        display: 'flex', flexDirection: 'column', gap: 16,
        maxWidth: 900, width: '100%', margin: '0 auto',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 32, height: 32, borderRadius: '10px',
                background: 'linear-gradient(135deg, #00ff87, #60efff)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginRight: 10, flexShrink: 0, marginTop: 4,
              }}>
                <Trophy size={16} color="#0a0a0f" />
              </div>
            )}
            <div
              style={{
                maxWidth: '80%',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #00ff87, #60efff)'
                  : '#16213e',
                color: msg.role === 'user' ? '#0a0a0f' : '#fff',
                borderRadius: msg.role === 'user'
                  ? '18px 18px 4px 18px'
                  : '18px 18px 18px 4px',
                padding: '14px 18px',
                fontSize: 14,
                lineHeight: 1.6,
                border: msg.role === 'assistant' ? '1px solid #1a1a3e' : 'none',
              }}
              dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
            />
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '10px',
              background: 'linear-gradient(135deg, #00ff87, #60efff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Trophy size={16} color="#0a0a0f" />
            </div>
            <div style={{
              background: '#16213e', border: '1px solid #1a1a3e',
              borderRadius: '18px 18px 18px 4px',
              padding: '14px 18px', display: 'flex', gap: 6, alignItems: 'center'
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#00ff87',
                  animation: `bounce 1s ease infinite ${i * 0.2}s`,
                }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid #1a1a3e',
        padding: '16px 24px',
        background: 'rgba(10,10,15,0.95)',
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{
          maxWidth: 900, margin: '0 auto',
          display: 'flex', gap: 12, alignItems: 'flex-end',
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
            style={{ flex: 1, resize: 'none', borderRadius: 12 }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="btn-primary"
            style={{
              padding: '12px 20px', borderRadius: 12,
              opacity: loading || !input.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Send size={18} />
          </button>
        </div>
        <div style={{ textAlign: 'center', color: '#333', fontSize: 11, marginTop: 8 }}>
          FootballIQ • Live data • Please gamble responsibly 🎗️
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  )
}
