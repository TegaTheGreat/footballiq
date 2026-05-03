import { useState, useRef, useEffect } from 'react'
import { Send, ImagePlus, Copy, Check, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react'

const QUICK_QUESTIONS = [
  'Best bets this weekend across all leagues',
  'Champions League predictions this week',
  'Premier League — best Over/Under picks',
  'Build me a 5-fold accumulator targeting 15 odds',
  'Best BTTS picks this weekend',
  'Give me your banker bet of the day',
  'Which matches should I completely avoid?',
  'Europa League — best value bets this week',
  'Give me a safe 3-fold under 5 odds',
  'Bundesliga predictions this weekend',
]

function formatMessage(text) {
  if (!text) return ''
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [scoutStatus, setScoutStatus] = useState(null)
  const [uploadedImages, setUploadedImages] = useState([])
  const [copiedId, setCopiedId] = useState(null)

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px'
    }
  }

  const handleImageUpload = (e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        setUploadedImages(prev => [...prev, {
          base64: ev.target.result.split(',')[1],
          type: file.type,
          name: file.name,
          preview: ev.target.result
        }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const copyMessage = (id, html) => {
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(h[1-6]|p|div|li|ul|ol|tr|td|th|table|hr)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const sendMessage = async (questionOverride) => {
    const question = questionOverride || input.trim()
    if (!question && uploadedImages.length === 0) return
    if (loading) return

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: question,
      images: uploadedImages.map(i => i.preview)
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setScoutStatus(null)

    const currentImages = [...uploadedImages]
    setUploadedImages([])

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({ role: m.role, content: m.rawContent || '' }))

    let scoutData = { success: false, data: '', error: null }

    try {
      // Stage 1: Gemini scouts websites
      setLoadingStage('scouting')

      const scoutRes = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (scoutRes.ok) {
        scoutData = await scoutRes.json()
        setScoutStatus({
          success: scoutData.success,
          chars: scoutData.chars,
          elapsed: scoutData.elapsed_ms,
          error: scoutData.error,
        })
      }

      // Stage 2: Claude analyses
      setLoadingStage('analysing')

      const predictBody = {
        question,
        messages: history,
        scoutData,
      }

      if (currentImages.length > 0) {
        predictBody.images = currentImages.map(i => ({ base64: i.base64, type: i.type }))
      }

      const predictRes = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictBody),
      })

      if (!predictRes.ok) throw new Error(`Predict error: ${predictRes.status}`)

      // Stage 3: Stream response
      setLoadingStage('streaming')

      const assistantMsg = { id: Date.now() + 1, role: 'assistant', content: '', rawContent: '' }
      setMessages(prev => [...prev, assistantMsg])

      const reader = predictRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n').filter(l => l.trim())) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.text) {
                fullText += parsed.text
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: formatMessage(fullText), rawContent: fullText }
                    : m
                ))
              }
            } catch (_) {}
          }
        }
      }

    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 2,
        role: 'assistant',
        content: `<p style="color:#ef4444"><strong>Error:</strong> ${err.message}</p>`,
        rawContent: err.message
      }])
    } finally {
      setLoading(false)
      setLoadingStage('')
    }
  }

  const loadingLabel = {
    scouting: '🔍 Scouting live websites...',
    analysing: '🧠 Analysing data...',
    streaming: '✍️ Writing analysis...',
  }[loadingStage] || 'Thinking...'

  return (
    <div style={s.root}>
      <style>{css}</style>

      {/* Header */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logoMark}>⚽</span>
          <div>
            <div style={s.logoText}>Football<span style={s.logoAccent}>IQ</span></div>
            <div style={s.logoSub}>AI Betting Analyst</div>
          </div>
        </div>

        <div style={s.headerRight}>
          {scoutStatus && (
            <div style={{
              ...s.scoutBadge,
              borderColor: scoutStatus.success ? '#1a3a1a' : '#3a1a1a',
              color: scoutStatus.success ? '#5a9a5a' : '#9a5a5a',
            }}>
              {scoutStatus.success
                ? <Wifi size={11} />
                : <WifiOff size={11} />
              }
              {scoutStatus.success
                ? `Live data · ${(scoutStatus.chars / 1000).toFixed(1)}k chars`
                : 'Training knowledge only'
              }
            </div>
          )}
          <button
            onClick={() => { setMessages([]); setScoutStatus(null) }}
            style={s.iconBtn}
            title="New chat"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main style={s.main}>
        {messages.length === 0 ? (
          <div style={s.welcome}>
            <h1 style={s.welcomeTitle}>
              What are you <em>betting on?</em>
            </h1>
            <p style={s.welcomeSub}>
              Gemini scouts live websites. Claude analyses. You bet smarter.
            </p>
            <div style={s.quickGrid}>
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="quick-btn"
                  style={s.quickBtn}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className="msg-in"
              style={{
                ...s.msgWrap,
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              {msg.role === 'user' ? (
                <div style={s.userBubble}>
                  {msg.images?.length > 0 && (
                    <div style={s.imageRow}>
                      {msg.images.map((src, i) => (
                        <img key={i} src={src} alt="" style={s.inlineImg} />
                      ))}
                    </div>
                  )}
                  <p style={s.userText}>{msg.content}</p>
                </div>
              ) : (
                <div style={s.assistantWrap}>
                  <div
                    dangerouslySetInnerHTML={{ __html: msg.content }}
                    style={s.assistantText}
                  />
                  {msg.content && (
                    <div style={s.copyBarBottom}>
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        style={s.copyBtn}
                        className="copy-btn"
                      >
                        {copiedId === msg.id
                          ? <><Check size={11} /> Copied</>
                          : <><Copy size={11} /> Copy</>
                        }
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div style={s.loadingWrap}>
            <div style={s.loadingDots}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ ...s.dot, animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <span style={s.loadingText}>{loadingLabel}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Image previews */}
      {uploadedImages.length > 0 && (
        <div style={s.imageBar}>
          {uploadedImages.map((img, i) => (
            <div key={i} style={s.thumbWrap}>
              <img src={img.preview} alt="" style={s.thumb} />
              <button
                onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))}
                style={s.removeThumb}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <footer style={s.footer}>
        <div style={s.inputWrap} className="input-wrap">
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
            placeholder="Ask about any match, league, market or accumulator..."
            disabled={loading}
            rows={1}
            style={s.textarea}
          />
          <div style={s.inputRight}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              style={s.imgBtn}
              title="Upload screenshot"
            >
              <ImagePlus size={16} />
              {uploadedImages.length > 0 && (
                <span style={s.imgCount}>{uploadedImages.length}</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && uploadedImages.length === 0)}
              style={{
                ...s.sendBtn,
                opacity: loading || (!input.trim() && uploadedImages.length === 0) ? 0.4 : 1
              }}
              className="send-btn"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
        <p style={s.footerNote}>
          Gemini scouts live data · Claude analyses · Please gamble responsibly
        </p>
      </footer>
    </div>
  )
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #d4d4e8; font-family: 'Sora', sans-serif; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: #1e1e30; border-radius: 2px; }

  h1 { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; color: #f0f0ff; margin: 16px 0 8px; }
  h2 { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 400; color: #c8c8f0; margin: 14px 0 6px; }
  h3 { font-size: 12px; font-weight: 600; color: #7070a0; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; }
  strong { color: #f0f0ff; font-weight: 600; }
  em { color: #a0a0d0; font-style: italic; }
  hr { border: none; border-top: 1px solid #1a1a2a; margin: 16px 0; }
  ul { padding-left: 18px; margin: 6px 0; }
  li { margin: 5px 0; line-height: 1.65; color: #c0c0dc; }
  p { margin: 0 0 8px; }

  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 12px; border-radius: 8px; overflow: hidden; }
  th { background: #12121e; color: #6060a0; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; padding: 8px 12px; border: 1px solid #1e1e30; }
  td { padding: 8px 12px; border: 1px solid #1a1a28; color: #b0b0cc; }
  tr:nth-child(even) td { background: #0c0c18; }

  @keyframes fadeSlide { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform: translateY(0) } }
  @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }

  .msg-in { animation: fadeSlide 0.25s ease; }
  .quick-btn:hover { background: #12122a !important; border-color: #3030a0 !important; color: #a0a0e0 !important; }
  .send-btn:hover:not(:disabled) { background: #4040c0 !important; transform: scale(1.02); }
  .copy-btn:hover { background: #12121e !important; color: #8080c0 !important; }
  .input-wrap:focus-within { border-color: #2a2a5a !important; }
`

const s = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    maxWidth: 840,
    margin: '0 auto',
    background: '#080810',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '13px 20px',
    borderBottom: '1px solid #12121e',
    background: '#080810',
    position: 'sticky',
    top: 0,
    zIndex: 20,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { fontSize: 22 },
  logoText: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
    color: '#f0f0ff',
    lineHeight: 1.1,
  },
  logoAccent: { color: '#5050e0' },
  logoSub: { fontSize: 10, color: '#303050', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 1 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  scoutBadge: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: '#0a0a14', border: '1px solid',
    borderRadius: 20, padding: '4px 10px',
    fontSize: 11, fontWeight: 500,
  },
  iconBtn: {
    background: 'none', border: '1px solid #1a1a2a',
    borderRadius: 8, padding: '6px 8px',
    cursor: 'pointer', color: '#404060',
    display: 'flex', alignItems: 'center',
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  welcome: { textAlign: 'center', padding: '32px 16px' },
  welcomeTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 38,
    fontWeight: 400,
    color: '#f0f0ff',
    marginBottom: 12,
    lineHeight: 1.2,
  },
  welcomeSub: {
    fontSize: 14,
    color: '#3a3a60',
    maxWidth: 400,
    margin: '0 auto 28px',
    lineHeight: 1.6,
  },
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 8,
    maxWidth: 700,
    margin: '0 auto',
  },
  quickBtn: {
    padding: '11px 14px',
    border: '1px solid #14142a',
    borderRadius: 10,
    background: '#0a0a18',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left',
    color: '#60608a',
    lineHeight: 1.4,
    transition: 'all 0.15s',
  },
  msgWrap: { display: 'flex', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: '75%',
    background: '#10101e',
    border: '1px solid #1a1a2e',
    borderRadius: '16px 16px 4px 16px',
    padding: '12px 16px',
    marginLeft: 'auto',
  },
  userText: { fontSize: 14, lineHeight: 1.65, color: '#c0c0e0' },
  imageRow: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  inlineImg: { width: 68, height: 68, objectFit: 'cover', borderRadius: 6 },
  assistantWrap: { maxWidth: '93%' },
  assistantText: { fontSize: 14, lineHeight: 1.8, color: '#b8b8d0' },
  copyBarBottom: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #12121e',
  },
  copyBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'none',
    border: '1px solid #1a1a2a',
    borderRadius: 6, padding: '4px 10px',
    cursor: 'pointer', color: '#404060',
    fontSize: 11, fontWeight: 500,
    transition: 'all 0.15s',
  },
  loadingWrap: { display: 'flex', alignItems: 'center', gap: 10 },
  loadingDots: { display: 'flex', gap: 4 },
  dot: {
    width: 5, height: 5, borderRadius: '50%',
    background: '#3030a0',
    animation: 'pulse 1.2s ease infinite',
  },
  loadingText: { fontSize: 13, color: '#30305a' },
  imageBar: {
    display: 'flex', gap: 8,
    padding: '8px 20px',
    borderTop: '1px solid #12121e',
    overflowX: 'auto',
  },
  thumbWrap: { position: 'relative', flexShrink: 0 },
  thumb: { width: 50, height: 50, objectFit: 'cover', borderRadius: 7, border: '1px solid #1e1e30' },
  removeThumb: {
    position: 'absolute', top: -5, right: -5,
    width: 16, height: 16, borderRadius: '50%',
    background: '#c02020', color: '#fff',
    border: 'none', fontSize: 11,
    cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  },
  footer: { padding: '12px 20px 16px', borderTop: '1px solid #12121e', background: '#080810' },
  inputWrap: {
    display: 'flex', alignItems: 'flex-end',
    background: '#0c0c18',
    border: '1px solid #1a1a2a',
    borderRadius: 14,
    padding: '10px 12px',
    gap: 8,
    transition: 'border-color 0.2s',
  },
  textarea: {
    flex: 1, background: 'none', border: 'none',
    color: '#d0d0e8', fontSize: 14,
    fontFamily: "'Sora', sans-serif",
    lineHeight: 1.5, resize: 'none',
    minHeight: 24, maxHeight: 140, outline: 'none',
  },
  inputRight: { display: 'flex', alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  imgBtn: {
    background: 'none', border: 'none',
    cursor: 'pointer', color: '#303050',
    padding: '3px', display: 'flex',
    position: 'relative',
  },
  imgCount: {
    position: 'absolute', top: -4, right: -4,
    background: '#5050d0', color: '#fff',
    borderRadius: '50%', width: 13, height: 13,
    fontSize: 8, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontWeight: 700,
  },
  sendBtn: {
    background: '#3030b0', border: 'none',
    borderRadius: 9, padding: '7px 10px',
    cursor: 'pointer', color: '#fff',
    display: 'flex', alignItems: 'center',
    transition: 'all 0.15s',
  },
  footerNote: {
    textAlign: 'center', fontSize: 10,
    color: '#18182a', marginTop: 8,
  },
}
