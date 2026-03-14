import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, Zap, TrendingUp, Shield, RefreshCw } from 'lucide-react'

const QUICK_QUESTIONS = [
  "What are the most predictable matches this weekend?",
  "Give me the top 20 best bets for this week",
  "Which matches are most likely to have over 2.5 goals?",
  "Best clean sheet predictions this weekend?",
  "Which home teams are most likely to win this week?",
  "What are the safest accumulators for this weekend?",
  "Which matches are likely to be high scoring?",
  "Best both teams to score predictions this week?",
]

const SYSTEM_PROMPT = `You are FootballIQ, an expert football analyst and betting prediction AI. You have deep knowledge of:
- Premier League, Championship, League One (England)
- La Liga (Spain), Serie A (Italy), Bundesliga (Germany), Ligue 1 (France)
- Primeira Liga (Portugal), Eredivisie (Netherlands), Pro League (Belgium)
- Scottish Premiership, Austrian Bundesliga, Saudi Pro League
- Champions League, Europa League, Conference League
- Copa America, Copa Libertadores
- Brazilian Série A, Argentine Primera División, Liga MX

When given fixtures data, analyze each match considering:
- Historical head to head records
- Current form (last 5 matches)
- Home and away performance
- Goals scoring patterns (first half vs second half)
- Clean sheet records
- League table positions
- Key player availability
- Tactical matchups

Always provide:
- Clear winner prediction with confidence percentage
- Predicted scoreline
- Goal timing predictions (which half most likely)
- Clean sheet probabilities
- Best betting markets for each match
- Risk level (Low/Medium/High)

Format your responses clearly with emojis and structure. Be confident but note when predictions carry higher risk. Always add a responsible gambling reminder at the end.`

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `👋 Welcome to **FootballIQ** — your AI football prediction engine!

I can analyze upcoming fixtures and give you:
- 🏆 Match predictions with confidence ratings
- ⚽ Scoreline and goal timing predictions  
- 🧤 Clean sheet probabilities
- 💰 Best betting markets and accumulators
- 📊 Top 20 most predictable results

**Try asking me anything below, or click one of the quick questions to get started!**

*Loading this weekend's fixtures...*`
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fixtures, setFixtures] = useState([])
  const [fixturesLoading, setFixturesLoading] = useState(true)
  const [fixturesError, setFixturesError] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    fetchFixtures()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchFixtures = async () => {
    setFixturesLoading(true)
    setFixturesError('')
    try {
      const response = await fetch('/api/fixtures')
      const data = await response.json()
      if (data.matches) {
        setFixtures(data.matches)
        // Auto send fixtures to chat
        if (data.matches.length > 0) {
          const fixturesSummary = data.matches.slice(0, 50).map(m => {
            const date = new Date(m.utcDate).toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short'
            })
            return `${date}: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`
          }).join('\n')

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ **Fixtures loaded!** I've found **${data.matches.length} upcoming matches** across all major leagues.\n\nHere's a preview of what's coming up:\n\n${data.matches.slice(0, 5).map(m => {
              const date = new Date(m.utcDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              return `• **${m.homeTeam.name}** vs **${m.awayTeam.name}** — ${date} (${m.competition.name})`
            }).join('\n')}\n\n*...and ${data.matches.length - 5} more matches loaded.*\n\n**What would you like to know? Ask me anything about these fixtures!**`
          }])
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `ℹ️ No fixtures found for the next 7 days in the database yet. This sometimes happens early in the week before fixtures are confirmed.\n\n**You can still ask me questions!** Just mention the teams you're interested in and I'll analyze them for you.`
          }])
        }
      }
    } catch (err) {
      setFixturesError('Could not load fixtures automatically')
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Couldn't auto-load fixtures right now, but I'm still fully operational! Just ask me about any match or tell me the fixtures you want analyzed and I'll give you the full breakdown.`
      }])
    } finally {
      setFixturesLoading(false)
    }
  }

  const sendMessage = async (messageText) => {
    const text = messageText || input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)

    const fixturesSummary = fixtures.length > 0
      ? `\n\nHere are the upcoming fixtures I have loaded:\n${fixtures.slice(0, 50).map(m => {
          const date = new Date(m.utcDate).toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short'
          })
          return `${date}: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`
        }).join('\n')}`
      : ''

    const userMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])

    try {
      const conversationMessages = [
        ...messages.filter(m => m.role !== 'assistant' || !m.content.includes('Loading this weekend')),
        userMessage
      ].map(m => ({
        role: m.role,
        content: m.role === 'user' && m === userMessage
          ? `${text}${fixturesSummary}`
          : m.content
      }))

      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: conversationMessages,
        }),
      })

      const data = await response.json()

      if (data.content && data.content[0]) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content[0].text
        }])
      } else {
        throw new Error('Invalid response')
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Something went wrong. Please try again.'
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
          {fixturesLoading ? (
            <span className="badge badge-blue">⏳ Loading fixtures...</span>
          ) : fixtures.length > 0 ? (
            <span className="badge badge-green">✅ {fixtures.length} fixtures loaded</span>
          ) : (
            <span className="badge badge-red">⚠️ No fixtures</span>
          )}
          <button
            onClick={fetchFixtures}
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
              transition: 'all 0.2s', flexShrink: 0,
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
            <div style={{
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
            placeholder="Ask anything... e.g. 'What are the best bets this weekend?' or 'Analyze Arsenal vs Chelsea'"
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
          FootballIQ • Powered by Claude AI • Please gamble responsibly
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
