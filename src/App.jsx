import { useState, useRef, useEffect } from 'react'
import { Trophy, Send, RefreshCw, Copy, Check, ImagePlus, X, ChevronRight } from 'lucide-react'

const QUICK_QUESTIONS = [
  "Best 5 bets this weekend?",
  "Top 20 predictions across all leagues",
  "Most likely 2-3 goal matches today",
  "Best clean sheet picks this weekend",
  "Build me a 5 team accumulator",
  "Which teams score first most often?",
  "Best BTTS picks this weekend",
  "Underdogs to watch this weekend",
]

const formatMessage = (text) => {
  return text
    .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^\d+\.\s(.+)$/gm, '<oli>$1</oli>')
    .replace(/(<oli>.*<\/oli>\n?)+/g, (match) => {
      const items = match.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>')
      return `<ol>${items}</ol>`
    })
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
    .replace(/^(?!<[houpl])(.+)$/gm, '<p>$1</p>')
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const plain = text
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    await navigator.clipboard.writeText(plain)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy response"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: '1px solid #e2e8f0',
        borderRadius: 6, padding: '4px 10px',
        cursor: 'pointer', fontSize: 11, fontWeight: 500,
        color: copied ? '#16a34a' : '#94a3b8',
        transition: 'all 0.2s',
      }}
      onMouseOver={e => e.currentTarget.style.borderColor = '#3b82f6'}
      onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function MessageBubble({ msg, isLast, loading }) {
  const isUser = msg.role === 'user'
  const isEmpty = !msg.content && isLast && loading

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      {!isUser && (
        <div style={{
          width: 36, height: 36, borderRadius: '10px',
          background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 2px 8px rgba(59,130,246,0.25)',
          marginTop: 2,
        }}>
          <Trophy size={16} color="#fff" />
        </div>
      )}

      <div style={{
        maxWidth: isUser ? '72%' : '88%',
        display: 'flex', flexDirection: 'column', gap: 6
      }}>
        <div
          style={{
            background: isUser
              ? 'linear-gradient(135deg, #1d4ed8, #2563eb)'
              : '#ffffff',
            color: isUser ? '#ffffff' : '#1e293b',
            borderRadius: isUser
              ? '18px 18px 4px 18px'
              : '4px 18px 18px 18px',
            padding: isUser ? '12px 16px' : '16px 20px',
            fontSize: 14,
            lineHeight: 1.75,
            border: !isUser ? '1px solid #e8edf5' : 'none',
            boxShadow: !isUser ? '0 1px 6px rgba(0,0,0,0.05)' : 'none',
            overflowX: 'auto',
          }}
        >
          {isEmpty ? (
            <div style={{
              display: 'flex', gap: 5,
              alignItems: 'center', padding: '2px 0'
            }}>
              {[0, 1, 2].map(j => (
                <div key={j} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: '#3b82f6',
                  animation: `bounce 1.2s ease infinite ${j * 0.2}s`,
                  opacity: 0.7,
                }} />
              ))}
            </div>
          ) : (
            <div
              className="message-content"
              dangerouslySetInnerHTML={{ __html: msg.content }}
            />
          )}
        </div>

        {!isUser && msg.content && (
          <div style={{ paddingLeft: 4 }}>
            <CopyButton text={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: formatMessage(`## Welcome to FootballIQ ⚽

I'm your personal football analyst — powered by Gemini live search and Claude AI analysis.

Every time you ask me something I search the web for live fixtures, recent results, injuries and team news — then analyse it all to give you sharp, data-driven predictions.

**Here's what I can do:**
- Predict match outcomes with confidence ratings
- Identify best bets by market — BTTS, Over/Under, Match Result
- Build accumulators targeting specific odds
- Analyse screenshots you upload
- Walk you through reasoning league by league

Ask me anything or pick a quick question below.`)
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState([])
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files)
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target.result.split(',')[1]
        setImages(prev => [...prev, {
          base64,
          type: file.type,
          preview: URL.createObjectURL(file),
          name: file.name,
        }])
      }
      reader.readAsDataURL(file)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }

  const sendMessage = async (messageText) => {
    const text = messageText || input.trim()
    if ((!text && images.length === 0) || loading) return

    setInput('')
    setLoading(true)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userContent = text || 'Analyze these images and give me predictions'

    let displayContent = userContent
    if (images.length > 0) {
      const imgHtml = images.map(img =>
        `<img src="${img.preview}" style="max-width:100%;max-height:200px;border-radius:8px;margin-top:8px;display:block"/>`
      ).join('')
      displayContent = `${userContent}${imgHtml}`
    }

    const userMessage = { role: 'user', content: displayContent }
    const sentImages = [...images]
    setImages([])

    const updatedMessages = [...messages, userMessage]
    setMessages([...updatedMessages, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userContent,
          messages: updatedMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => ({
              role: m.role,
              content: m.content.replace(/<[^>]*>/g, '').slice(0, 800)
            })),
          images: sentImages.length > 0
            ? sentImages.map(img => ({
                base64: img.base64,
                type: img.type,
              }))
            : null,
        }),
      })

      if (!response.ok) throw new Error(`Server error: ${response.status}`)

      const contentType = response.headers.get('content-type')

      if (contentType?.includes('text/event-stream')) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let rawText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.trim())

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.text) {
                  rawText += parsed.text
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: formatMessage(rawText)
                    }
                    return updated
                  })
                }
              } catch (e) {}
            }
          }
        }
      } else {
        const data = await response.json()
        if (data.content?.[0]) {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: formatMessage(data.content[0].text)
            }
            return updated
          })
        } else {
          throw new Error(data.error || 'No response')
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `<p>⚠️ Something went wrong: ${err.message}. Please try again.</p>`
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f4f7fc',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Serif+Display&display=swap');

        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }

        .message-content p { margin: 0 0 10px 0; }
        .message-content p:last-child { margin-bottom: 0; }
        .message-content h1 { font-size: 18px; font-weight: 700; margin: 16px 0 8px; color: #1d4ed8; }
        .message-content h2 { font-size: 16px; font-weight: 700; margin: 14px 0 6px; color: #1e40af; }
        .message-content h3 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; color: #1d4ed8; }
        .message-content ul { margin: 8px 0; padding-left: 20px; }
        .message-content ol { margin: 8px 0; padding-left: 20px; }
        .message-content li { margin: 4px 0; line-height: 1.6; }
        .message-content hr { border: none; border-top: 1px solid #e2e8f0; margin: 12px 0; }
        .message-content strong { font-weight: 600; color: #0f172a; }
        .message-content table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
        .message-content thead { background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: white; }
        .message-content thead th { padding: 10px 14px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
        .message-content tbody tr { border-bottom: 1px solid #f0f4ff; transition: background 0.15s; }
        .message-content tbody tr:hover { background: #f8faff; }
        .message-content tbody tr:last-child { border-bottom: none; }
        .message-content tbody td { padding: 9px 14px; color: #374151; font-size: 13px; }
        .message-content tbody tr:nth-child(even) { background: #fafbff; }

        .quick-btn:hover { background: #dbeafe !important; border-color: #3b82f6 !important; color: #1d4ed8 !important; }
        .send-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .upload-btn:hover { border-color: #3b82f6 !important; color: #1d4ed8 !important; }

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid #e8edf5',
        padding: '14px 28px',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        background: '#ffffff',
        boxShadow: '0 1px 12px rgba(0,0,0,0.05)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
          }}>
            <Trophy size={20} color="#fff" />
          </div>
          <div>
            <div style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 20, fontWeight: 400,
              color: '#0f172a', letterSpacing: '-0.3px', lineHeight: 1,
            }}>
              Football<span style={{ color: '#2563eb' }}>IQ</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontWeight: 500 }}>
              AI Match Predictor
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 20, padding: '5px 12px',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 0 2px rgba(34,197,94,0.3)',
            }} />
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
              Live Data
            </span>
          </div>
          <button
            onClick={() => setMessages([{
              role: 'assistant',
              content: formatMessage('## New Session Ready ⚽\n\nFresh start! Ask me about any league, fixture or market and I\'ll search for the latest data. 👇')
            }])}
            style={{
              background: '#f8faff', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '7px 14px',
              cursor: 'pointer', color: '#64748b',
              display: 'flex', alignItems: 'center',
              gap: 6, fontSize: 12, fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            <RefreshCw size={12} /> New Chat
          </button>
        </div>
      </header>

      {/* Quick Questions */}
      <div style={{
        borderBottom: '1px solid #e8edf5',
        padding: '10px 28px',
        display: 'flex', gap: 8,
        overflowX: 'auto', background: '#ffffff',
        scrollbarWidth: 'none',
      }}>
        {QUICK_QUESTIONS.map((q, i) => (
          <button
            key={i}
            className="quick-btn"
            onClick={() => sendMessage(q)}
            disabled={loading}
            style={{
              background: '#f8faff', border: '1px solid #e2e8f0',
              color: '#475569', borderRadius: 20,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.2s', opacity: loading ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <ChevronRight size={10} />
            {q}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '28px 20px',
        display: 'flex', flexDirection: 'column',
        gap: 20, maxWidth: 900,
        width: '100%', margin: '0 auto',
      }}>
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            isLast={i === messages.length - 1}
            loading={loading}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Image Previews */}
      {images.length > 0 && (
        <div style={{
          padding: '10px 28px',
          background: '#ffffff',
          borderTop: '1px solid #e8edf5',
          maxWidth: 900, width: '100%', margin: '0 auto',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          {images.map((img, idx) => (
            <div key={idx} style={{
              position: 'relative',
              border: '1px solid #bfdbfe',
              borderRadius: 8, overflow: 'hidden',
              background: '#f0f7ff',
            }}>
              <img
                src={img.preview}
                alt="upload"
                style={{
                  height: 56, width: 56,
                  objectFit: 'cover', display: 'block'
                }}
              />
              <button
                onClick={() => removeImage(idx)}
                style={{
                  position: 'absolute', top: 2, right: 2,
                  background: 'rgba(0,0,0,0.5)', border: 'none',
                  borderRadius: '50%', width: 16, height: 16,
                  cursor: 'pointer', color: '#fff',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <div style={{
            fontSize: 12, color: '#64748b',
            display: 'flex', alignItems: 'center', paddingLeft: 4,
          }}>
            {images.length} image{images.length > 1 ? 's' : ''} ready
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{
        borderTop: '1px solid #e8edf5',
        padding: '16px 28px 20px',
        background: '#ffffff',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          maxWidth: 900, margin: '0 auto',
          background: '#f8faff',
          border: '1.5px solid #e2e8f0',
          borderRadius: 16, overflow: 'hidden',
          transition: 'border-color 0.2s',
        }}
          onFocusCapture={e => e.currentTarget.style.borderColor = '#3b82f6'}
          onBlurCapture={e => e.currentTarget.style.borderColor = '#e2e8f0'}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize() }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Ask anything... e.g. 'Full analysis of all UCL matches this week'"
            rows={1}
            style={{
              width: '100%', border: 'none', outline: 'none',
              background: 'transparent',
              padding: '14px 16px 0',
              fontSize: 14, lineHeight: 1.6,
              color: '#1e293b', resize: 'none',
              fontFamily: 'inherit', minHeight: 44,
            }}
          />

          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px 10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              <button
                className="upload-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="Upload images"
                style={{
                  background: 'none', border: '1px solid #e2e8f0',
                  borderRadius: 8, padding: '5px 10px',
                  cursor: 'pointer', color: '#94a3b8',
                  display: 'flex', alignItems: 'center',
                  gap: 5, fontSize: 12, fontWeight: 500,
                  transition: 'all 0.2s',
                }}
              >
                <ImagePlus size={14} />
                {images.length > 0
                  ? `${images.length} image${images.length > 1 ? 's' : ''}`
                  : 'Add images'}
              </button>
              <span style={{ fontSize: 11, color: '#cbd5e1' }}>
                Shift+Enter for new line
              </span>
            </div>

            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && images.length === 0)}
              style={{
                background: loading || (!input.trim() && images.length === 0)
                  ? '#e2e8f0'
                  : 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                border: 'none', borderRadius: 10,
                padding: '8px 18px',
                cursor: loading || (!input.trim() && images.length === 0)
                  ? 'not-allowed' : 'pointer',
                color: loading || (!input.trim() && images.length === 0)
                  ? '#94a3b8' : '#fff',
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 13, fontWeight: 600,
                transition: 'all 0.2s',
                boxShadow: loading || (!input.trim() && images.length === 0)
                  ? 'none'
                  : '0 4px 12px rgba(59,130,246,0.3)',
              }}
            >
              <Send size={14} />
              {loading ? 'Analysing...' : 'Send'}
            </button>
          </div>
        </div>

        <div style={{
          textAlign: 'center', color: '#cbd5e1',
          fontSize: 11, marginTop: 10, fontWeight: 500,
        }}>
          FootballIQ • Gemini live search + Claude analysis • Please gamble responsibly
        </div>
      </div>
    </div>
  )
}
