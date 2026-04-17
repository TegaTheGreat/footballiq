import { useState, useRef, useEffect } from 'react'
import { Send, ImagePlus, X, Copy, Check, RefreshCw, TrendingUp, Target, ChevronDown, Trash2 } from 'lucide-react'

const API_BASE = ''

const QUICK_QUESTIONS = [
  'Best bets this weekend across all leagues',
  'Champions League predictions this week',
  'Give me a 5-fold accumulator targeting 15 odds',
  'Premier League — best Over/Under picks this weekend',
  'Which matches are best for BTTS this weekend?',
  'Give me your banker bet of the day',
  'Which matches should I completely avoid?',
  'Europa League predictions and best markets',
]

function formatMessage(text) {
  if (!text) return ''
  // Remove hidden picks JSON before display
  text = text.replace(/<!--PICKS_JSON[\s\S]*?PICKS_JSON-->/g, '')

  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>')
    .replace(/((<li>.*?<\/li>)(<br\/>)?)+/g, m => '<ul>' + m.replace(/<br\/>/g, '') + '</ul>')
    .replace(/(<br\/>)?(\|(.+)\|)(<br\/>)/g, (match, pre, full, content) => {
      const cells = content.split('|').map(c => c.trim())
      if (cells.every(c => /^-+$/.test(c))) return ''
      const isHeader = pre === undefined
      const tag = isHeader ? 'th' : 'td'
      return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`
    })
    .replace(/((<tr>.*?<\/tr>)\s*)+/g, m => `<table>${m}</table>`)
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [dataStatus, setDataStatus] = useState(null)
  const [predStats, setPredStats] = useState(null)
  const [uploadedImages, setUploadedImages] = useState([])
  const [copiedId, setCopiedId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showStats, setShowStats] = useState(false)

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)
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

  const triggerRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/api/refresh?force=true`)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { alert('Refresh response: ' + text.slice(0, 200)); setRefreshing(false); return }
      alert(`Refresh complete!\nOdds: ${data.odds?.fixtures || 0} fixtures\nStandings: ${data.standings?.leagues || 0} leagues\nContext: ${data.context?.chars || 0} chars`)
    } catch (e) {
      alert('Refresh failed: ' + e.message)
    }
    setRefreshing(false)
  }

  const handleImageUpload = (e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader()
      reader.onload = event => {
        setUploadedImages(prev => [...prev, {
          base64: event.target.result.split(',')[1],
          type: file.type,
          name: file.name,
          preview: event.target.result
        }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const copyMessage = (id, html) => {
    const text = html
      .replace(/<!--PICKS_JSON[\s\S]*?PICKS_JSON-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(h[1-6]|p|div|li|ul|ol|tr|td|th|table|thead|tbody)>/gi, '\n')
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

    const userMsg = { id: Date.now(), role: 'user', content: question, images: uploadedImages.map(i => i.preview) }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setDataStatus(null)

    const currentImages = [...uploadedImages]
    setUploadedImages([])

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))

    try {
      setLoadingStage('research')

      const researchRes = await fetch(`${API_BASE}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      let researchData = null
      let latestPredStats = predStats

      if (researchRes.ok) {
        const rj = await researchRes.json()
        researchData = rj.data
        setDataStatus(rj.status)
        if (rj.predStats) { setPredStats(rj.predStats); latestPredStats = rj.predStats }
        if (rj.needs_refresh) fetch(`${API_BASE}/api/refresh`).catch(() => {})
      }

      setLoadingStage('predict')

      const predictBody = { question, messages: history, researchData: researchData || {}, predStats: latestPredStats }
      if (currentImages.length > 0) predictBody.images = currentImages.map(i => ({ base64: i.base64, type: i.type }))

      const predictRes = await fetch(`${API_BASE}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictBody),
      })

      if (!predictRes.ok) throw new Error(`Predict failed: ${predictRes.status}`)

      setLoadingStage('streaming')

      const assistantMsg = { id: Date.now() + 1, role: 'assistant', content: '' }
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
                  m.id === assistantMsg.id ? { ...m, content: formatMessage(fullText) } : m
                ))
              }
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 2, role: 'assistant',
        content: `<p style="color:#dc2626"><strong>Error:</strong> ${err.message}</p>`
      }])
    } finally {
      setLoading(false)
      setLoadingStage('')
    }
  }

  const coreOk = dataStatus ? ['odds','standings','context'].filter(k => dataStatus[k]?.success).length : 0
  const hasLive = dataStatus?.geminiLive?.success

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #e8e8e8; font-family: 'Manrope', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
        th, td { border: 1px solid #2a2a3a; padding: 8px 12px; text-align: left; }
        th { background: #16161f; color: #a0a0c0; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        tr:hover td { background: #13131c; }
        h1 { font-family: 'Instrument Serif', serif; font-size: 22px; font-weight: 400; color: #fff; margin: 16px 0 8px; }
        h2 { font-family: 'Instrument Serif', serif; font-size: 18px; font-weight: 400; color: #e0e0ff; margin: 14px 0 6px; }
        h3 { font-size: 14px; font-weight: 600; color: #a0a0e0; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
        ul { padding-left: 18px; margin: 6px 0; }
        li { margin: 4px 0; line-height: 1.6; }
        strong { color: #fff; font-weight: 600; }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .msg-enter { animation: fadeIn 0.3s ease; }
        .quick-btn:hover { background: #1a1a2e !important; border-color: #4040a0 !important; }
        .send-btn:hover:not(:disabled) { background: #5050d0 !important; }
        textarea:focus { outline: none; border-color: #4040a0 !important; }
      `}</style>

      {/* Header */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.logo}>
            <span style={s.logoText}>Football</span>
            <span style={s.logoAccent}>IQ</span>
          </div>
          <div style={s.tagline}>AI Betting Analyst</div>
        </div>

        <div style={s.headerRight}>
          {/* Prediction stats pill */}
          {predStats && predStats.total > 0 && (
            <button onClick={() => setShowStats(!showStats)} style={s.statsPill}>
              <Target size={12} color="#60a060" />
              <span style={{ color: '#60a060', fontWeight: 700 }}>{predStats.winRate}%</span>
              <span style={{ color: '#606080', fontSize: 11 }}>{predStats.won}W {predStats.lost}L</span>
              <ChevronDown size={10} color="#606080" style={{ transform: showStats ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
            </button>
          )}

          {/* Data status */}
          {dataStatus && (
            <div style={{
              ...s.statusPill,
              borderColor: coreOk === 3 ? '#304030' : coreOk > 0 ? '#403020' : '#402020',
              color: coreOk === 3 ? '#60a060' : coreOk > 0 ? '#a08040' : '#a04040',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: coreOk === 3 ? '#60a060' : coreOk > 0 ? '#a08040' : '#a04040' }} />
              {coreOk}/3{hasLive ? ' +live' : ''}
            </div>
          )}

          <button onClick={triggerRefresh} disabled={refreshing} style={s.iconBtn} title="Refresh data">
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>

          <button onClick={() => { setMessages([]); setDataStatus(null); setPredStats(null) }} style={s.iconBtn} title="New chat">
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {/* Stats dropdown */}
      {showStats && predStats && (
        <div style={s.statsPanel}>
          <div style={s.statsGrid}>
            <div style={s.statBox}>
              <div style={s.statNum}>{predStats.total}</div>
              <div style={s.statLabel}>Total Picks</div>
            </div>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: '#60a060' }}>{predStats.won}</div>
              <div style={s.statLabel}>Won</div>
            </div>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: '#a04040' }}>{predStats.lost}</div>
              <div style={s.statLabel}>Lost</div>
            </div>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: '#8080c0' }}>{predStats.winRate}%</div>
              <div style={s.statLabel}>Win Rate</div>
            </div>
          </div>
          {predStats.byMarket?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#606080', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>By Market</div>
              {predStats.byMarket.slice(0, 5).map(m => (
                <div key={m.market} style={s.marketRow}>
                  <span style={{ color: '#a0a0c0', fontSize: 13 }}>{m.market}</span>
                  <span style={{ fontSize: 12, color: '#606080' }}>{m.wins}W {m.losses}L</span>
                  <span style={{ fontSize: 12, color: '#8080c0', fontWeight: 600 }}>
                    {m.wins + m.losses > 0 ? Math.round(m.wins / (m.wins + m.losses) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <main style={s.main}>
        {messages.length === 0 ? (
          <div style={s.welcome}>
            <div style={s.welcomeHeadline}>
              <span style={s.welcomeTitle}>What are you</span>
              <span style={s.welcomeItalic}> betting on?</span>
            </div>
            <p style={s.welcomeSub}>
              Live odds across 15 leagues. Match context, form, H2H. Every prediction tracked.
            </p>
            <div style={s.quickGrid}>
              {QUICK_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q)} disabled={loading} className="quick-btn" style={s.quickBtn}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="msg-enter" style={{ ...s.msgWrap, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'user' ? (
                <div style={s.userBubble}>
                  {msg.images?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {msg.images.map((src, i) => <img key={i} src={src} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />)}
                    </div>
                  )}
                  <p style={s.userText}>{msg.content}</p>
                </div>
              ) : (
                <div style={s.assistantBubble}>
                  <div dangerouslySetInnerHTML={{ __html: msg.content }} style={s.assistantText} />
                  {msg.content && (
                    <div style={s.copyBar}>
                      <button onClick={() => copyMessage(msg.id, msg.content)} style={s.copyBtn}>
                        {copiedId === msg.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div style={s.loadingBubble}>
            <div style={s.loadingDots}>
              {[0,1,2].map(i => <div key={i} style={{ ...s.dot, animationDelay: `${i * 0.15}s` }} />)}
            </div>
            <span style={s.loadingText}>
              {loadingStage === 'research' && '📡 Reading match data...'}
              {loadingStage === 'predict' && '🧠 Analysing...'}
              {loadingStage === 'streaming' && '✍️ Writing...'}
              {!loadingStage && 'Thinking...'}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Image previews */}
      {uploadedImages.length > 0 && (
        <div style={s.imageBar}>
          {uploadedImages.map((img, i) => (
            <div key={i} style={s.imageThumbWrap}>
              <img src={img.preview} alt="" style={s.imageThumb} />
              <button onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))} style={s.removeImg}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <footer style={s.footer}>
        <div style={s.inputBox}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Ask about any match, league, market or accumulator..."
            disabled={loading}
            rows={1}
            style={s.textarea}
          />
          <div style={s.inputActions}>
            <button onClick={() => fileInputRef.current?.click()} disabled={loading} style={s.imageBtn} title="Upload images">
              <ImagePlus size={16} />
              {uploadedImages.length > 0 && <span style={s.imageBadge}>{uploadedImages.length}</span>}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />
            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && uploadedImages.length === 0)}
              className="send-btn"
              style={{ ...s.sendBtn, opacity: loading || (!input.trim() && uploadedImages.length === 0) ? 0.4 : 1 }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
        <div style={s.footerNote}>FootballIQ · Live odds · All picks tracked · Gamble responsibly</div>
      </footer>
    </div>
  )
}

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100dvh', maxWidth: 820, margin: '0 auto', background: '#0a0a0f' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #16161f', background: '#0a0a0f', position: 'sticky', top: 0, zIndex: 20 },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: 10 },
  logo: { display: 'flex', alignItems: 'baseline', gap: 1 },
  logoText: { fontFamily: "'Instrument Serif', serif", fontSize: 24, fontWeight: 400, color: '#fff', letterSpacing: '-0.5px' },
  logoAccent: { fontFamily: "'Instrument Serif', serif", fontSize: 24, fontWeight: 400, color: '#6060d0', letterSpacing: '-0.5px' },
  tagline: { fontSize: 11, color: '#404060', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  statsPill: { display: 'flex', alignItems: 'center', gap: 6, background: '#0f0f18', border: '1px solid #202030', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
  statusPill: { display: 'flex', alignItems: 'center', gap: 6, background: '#0f0f18', border: '1px solid #202030', borderRadius: 20, padding: '5px 10px', fontSize: 12, fontWeight: 600 },
  iconBtn: { background: 'none', border: '1px solid #202030', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: '#606080', display: 'flex', alignItems: 'center' },
  statsPanel: { background: '#0d0d16', borderBottom: '1px solid #16161f', padding: '16px 20px' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 },
  statBox: { textAlign: 'center' },
  statNum: { fontSize: 22, fontWeight: 700, color: '#fff', fontFamily: "'Instrument Serif', serif" },
  statLabel: { fontSize: 11, color: '#404060', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 },
  marketRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #16161f' },
  main: { flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 },
  welcome: { textAlign: 'center', padding: '40px 20px 20px' },
  welcomeHeadline: { marginBottom: 12 },
  welcomeTitle: { fontFamily: "'Instrument Serif', serif", fontSize: 36, fontWeight: 400, color: '#fff' },
  welcomeItalic: { fontFamily: "'Instrument Serif', serif", fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: '#6060d0' },
  welcomeSub: { color: '#404060', fontSize: 14, maxWidth: 440, margin: '0 auto 28px', lineHeight: 1.6 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, maxWidth: 680, margin: '0 auto' },
  quickBtn: { padding: '11px 14px', border: '1px solid #1a1a2a', borderRadius: 10, background: '#0d0d16', cursor: 'pointer', fontSize: 13, textAlign: 'left', color: '#8080a0', lineHeight: 1.4, transition: 'all 0.15s' },
  msgWrap: { display: 'flex', alignItems: 'flex-start' },
  userBubble: { maxWidth: '78%', background: '#16161f', borderRadius: '16px 16px 4px 16px', padding: '12px 16px', marginLeft: 'auto' },
  userText: { fontSize: 14, lineHeight: 1.6, color: '#d0d0e0' },
  assistantBubble: { maxWidth: '92%', marginRight: 'auto' },
  assistantText: { fontSize: 14, lineHeight: 1.75, color: '#c8c8d8' },
  copyBar: { display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid #16161f' },
  copyBtn: { display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid #202030', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: '#606080', fontSize: 12, fontWeight: 500 },
  loadingBubble: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' },
  loadingDots: { display: 'flex', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#4040a0', animation: 'pulse 1.2s ease infinite' },
  loadingText: { fontSize: 13, color: '#404060' },
  imageBar: { display: 'flex', gap: 8, padding: '8px 20px', borderTop: '1px solid #16161f', overflowX: 'auto' },
  imageThumbWrap: { position: 'relative', flexShrink: 0 },
  imageThumb: { width: 52, height: 52, objectFit: 'cover', borderRadius: 7, border: '1px solid #202030' },
  removeImg: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#dc2626', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  footer: { padding: '12px 20px 16px', borderTop: '1px solid #16161f', background: '#0a0a0f' },
  inputBox: { display: 'flex', gap: 8, alignItems: 'flex-end', background: '#0d0d16', border: '1px solid #202030', borderRadius: 14, padding: '10px 12px', transition: 'border-color 0.2s' },
  textarea: { flex: 1, background: 'none', border: 'none', color: '#d0d0e0', fontSize: 14, fontFamily: "'Manrope', sans-serif", lineHeight: 1.5, resize: 'none', minHeight: 24, maxHeight: 140, outline: 'none' },
  inputActions: { display: 'flex', alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  imageBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#404060', padding: '3px', display: 'flex', position: 'relative' },
  imageBadge: { position: 'absolute', top: -4, right: -4, background: '#6060d0', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  sendBtn: { background: '#4040c0', border: 'none', borderRadius: 9, padding: '7px 10px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', transition: 'background 0.15s, transform 0.1s' },
  footerNote: { textAlign: 'center', fontSize: 11, color: '#282838', marginTop: 8 },
}
