import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, RefreshCw, TrendingUp, Image, X } from 'lucide-react'

const QUICK_QUESTIONS = [
  "Best 5 bets this weekend across all leagues?",
  "Which matches are most likely to have 2-3 goals?",
  "Best clean sheet predictions this weekend?",
  "Which home teams are banker picks this weekend?",
  "Build me a 5 team accumulator for this weekend",
  "Which teams are most likely to score first?",
  "Best both teams to score picks this weekend?",
  "Which underdogs could cause upsets this weekend?",
  "Show me my prediction history and win rate",
  "What markets am I winning most on?",
]

export default function App() {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: `👋 Welcome to <strong>FootballIQ</strong> — your AI football prediction engine!<br/><br/>
I remember everything in our conversation so you can build on previous predictions naturally — just like talking to a real analyst.<br/><br/>
<strong>Ask me anything or upload an image below! 👇</strong>`
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [seasonStats, setSeasonStats] = useState(null)
  const [uploadedImage, setUploadedImage] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [imageType, setImageType] = useState(null)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target.result.split(',')[1]
      setImageBase64(base64)
      setImageType(file.type)
      setUploadedImage(URL.createObjectURL(file))
    }
    reader.readAsDataURL(file)
  }

  const removeImage = () => {
    setUploadedImage(null)
    setImageBase64(null)
    setImageType(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const sendMessage = async (messageText) => {
    const text = messageText || input.trim()
    if ((!text && !imageBase64) || loading) return

    setInput('')
    setLoading(true)

    const userContent = text || 'Analyze this image and give me predictions'

    // Add user message to UI
    const userMessage = {
      role: 'user',
      content: uploadedImage
        ? `${userContent}<br/><img src="${uploadedImage}" style="max-width:100%;border-radius:8px;margin-top:8px"/>`
        : userContent
    }

    const sentImage = imageBase64
    const sentImageType = imageType
    removeImage()

    setMessages(prev => [...prev, userMessage])

    try {
      // Build clean conversation history to send
      const conversationHistory = [...messages, userMessage]
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          // Strip HTML tags for the API
          content: typeof m.content === 'string'
            ? m.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
            : m.content
        }))
        .filter(m => m.content.length > 0)

      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userContent,
          messages: conversationHistory,
          image: sentImage ? {
            base64: sentImage,
            type: sentImageType,
          } : null,
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Server error: ${response.status}`)
      }

      const data = await response.json()

      if (data.seasonStats) {
        setSeasonStats(data.seasonStats)
      }

      if (data.content && data.content[0]) {
        const rawText = data.content[0].text
        const formatted = rawText
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/###\s(.*?)\n/g, '<h3 style="margin:12px 0 6px;color:#1d4ed8;font-size:15px">$1</h3>')
          .replace(/##\s(.*?)\n/g, '<h2 style="margin:14px 0 8px;color:#1d4ed8;font-size:16px">$1</h2>')
          .replace(/\n/g, '<br/>')

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: formatted
        }])
      } else {
        throw new Error(data.error?.message || 'No response received')
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
            <div style={{
              fontWeight: 800, fontSize: 18,
              letterSpacing: '-0.5px', color: '#1a1a2e'
            }}>
              Football<span className="gradient-text">IQ</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -2 }}>
              AI Match Predictor
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {seasonStats && seasonStats.total > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#f0f7ff', border: '1px solid #bfdbfe',
              borderRadius: 10, padding: '6px 12px',
            }}>
              <TrendingUp size={14} color="#1d4ed8" />
              <span style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 600 }}>
                {seasonStats.winRate}% Win Rate
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {seasonStats.won}W {seasonStats.lost}L {seasonStats.pending}P
              </span>
            </div>
          )}
          <span className="badge badge-green">✅ Live Data</span>
          <button
            onClick={() => {
              setMessages([{
                role: 'assistant',
                content: `👋 New conversation started! What would you like to analyze? 👇`
              }])
            }}
            style={{
              background: '#f8faff',
              border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '6px 12px',
              cursor: 'pointer', color: '#64748b',
              display: 'flex', alignItems: 'center',
              gap: 6, fontSize: 12, fontWeight: 500,
            }}
          >
            <RefreshCw size={12} /> New Chat
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
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.2s',
              opacity: loading ? 0.6 : 1,
            }}
            onMouseOver={e => {
              if (!loading) {
                e.target.style.background = '#dbeafe'
                e.target.style.borderColor = '#3b82f6'
              }
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
                Thinking...
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {uploadedImage && (
        <div style={{
          padding: '8px 24px',
          background: '#ffffff',
          borderTop: '1px solid #e2e8f0',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#f0f7ff', border: '1px solid #bfdbfe',
            borderRadius: 10, padding: '6px 10px',
          }}>
            <img
              src={uploadedImage}
              alt="upload"
              style={{ height: 40, width: 40, objectFit: 'cover', borderRadius: 6 }}
            />
            <span style={{ fontSize: 12, color: '#1d4ed8' }}>Image ready</span>
            <button onClick={removeImage} style={{
              background: 'none', border: 'none',
              cursor: 'pointer', color: '#94a3b8',
              display: 'flex', alignItems: 'center',
            }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            style={{
              background: uploadedImage ? '#dbeafe' : '#f8faff',
              border: `1px solid ${uploadedImage ? '#3b82f6' : '#e2e8f0'}`,
              borderRadius: 12, padding: '12px',
              cursor: 'pointer',
              color: uploadedImage ? '#1d4ed8' : '#94a3b8',
              display: 'flex', alignItems: 'center',
              flexShrink: 0, transition: 'all 0.2s',
            }}
            title="Upload image"
          >
            <Image size={20} />
          </button>

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={uploadedImage
              ? "Add context or just hit send..."
              : "Ask anything... build on previous answers naturally"
            }
            className="input-field"
            rows={2}
            style={{
              flex: 1, resize: 'none',
              borderRadius: 12, lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || (!input.trim() && !imageBase64)}
            className="btn-primary"
            style={{
              padding: '12px 20px',
              borderRadius: 12,
              opacity: loading || (!input.trim() && !imageBase64) ? 0.5 : 1,
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
          FootballIQ • Full conversation memory • Upload images • Predictions tracked • Please gamble responsibly 🎗️
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
