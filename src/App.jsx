import { useState, useRef, useEffect } from 'react'
import { Send, Image, Trash2, Loader2, Copy, Check, Wifi, WifiOff, AlertCircle, ChevronDown, RefreshCw } from 'lucide-react'

const API_BASE = ''

const QUICK_QUESTIONS = [
  'Best bets this weekend across all leagues',
  'Give me a 5-fold accumulator around 10 odds',
  'Premier League predictions this matchday',
  'Champions League predictions this week',
  'Which matches should I avoid this weekend?',
  'Give me the safest banker bets today',
]

// ============================================
// MARKDOWN → HTML
// ============================================
function formatMessage(text) {
  if (!text) return ''
  let html = text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>')
    .replace(/((<li>.*?<\/li>)(<br\/>)?)+/g, (match) => {
      return '<ul>' + match.replace(/<br\/>/g, '') + '</ul>'
    })

  if (html.includes('|')) {
    html = html.replace(
      /(<br\/>)?\|(.+)\|(<br\/>)/g,
      (match, pre, content) => {
        const cells = content.split('|').map((c) => c.trim())
        if (cells.every((c) => /^-+$/.test(c))) return ''
        const row = cells.map((c) => `<td>${c}</td>`).join('')
        return `<tr>${row}</tr>`
      }
    )
    html = html.replace(/((<tr>.*?<\/tr>)\s*)+/g, (match) => `<table>${match}</table>`)
  }
  return html
}

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [dataStatus, setDataStatus] = useState(null)
  const [uploadedImages, setUploadedImages] = useState([])
  const [copiedId, setCopiedId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ============================================
  // MANUAL REFRESH
  // ============================================
  const triggerRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/api/refresh?force=true`)
      const data = await res.json()
      console.log('Refresh result:', data)
      alert(`Refresh complete!\nOdds: ${data.odds?.fixtures || 0} fixtures\nStandings: ${data.standings?.leagues || 0} leagues\nContext: ${data.context?.chars || 0} chars`)
    } catch (e) {
      alert('Refresh failed: ' + e.message)
    }
    setRefreshing(false)
  }

  // ============================================
  // IMAGE UPLOAD
  // ============================================
  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files)
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target.result.split(',')[1]
        setUploadedImages((prev) => [
          ...prev,
          { base64, type: file.type, name: file.name, preview: event.target.result },
        ])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeImage = (idx) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== idx))
  }

  // ============================================
  // COPY
  // ============================================
  const copyMessage = (id, html) => {
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(h[1-6]|p|div|li|ul|ol|tr|td|th|table|thead|tbody)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // ============================================
  // SEND MESSAGE — Two-stage with cache
  // ============================================
  const sendMessage = async (questionOverride) => {
    const question = questionOverride || input.trim()
    if (!question && uploadedImages.length === 0) return

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: question,
      images: uploadedImages.map((img) => img.preview),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setDataStatus(null)

    const currentImages = [...uploadedImages]
    setUploadedImages([])

    const conversationHistory = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))

    try {
      // ========================================
      // STAGE 1 — Read from cache + optional live
      // ========================================
      setLoadingStage('research')

      const researchRes = await fetch(`${API_BASE}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      let researchData = null

      if (researchRes.ok) {
        const researchJson = await researchRes.json()
        researchData = researchJson.data
        setDataStatus(researchJson.status)
        console.log(`Research: ${researchJson.elapsed_ms}ms (cache: ${researchJson.cache_read_ms}ms)`)

        // Auto-trigger background refresh if cache is empty
        if (researchJson.needs_refresh) {
          console.log('Cache needs refresh — triggering background refresh')
          fetch(`${API_BASE}/api/refresh`).catch(() => {})
        }
      }

      // ========================================
      // STAGE 2 — Stream Claude
      // ========================================
      setLoadingStage('predict')

      const predictBody = {
        question,
        messages: conversationHistory,
        researchData: researchData || {},
      }

      if (currentImages.length > 0) {
        predictBody.images = currentImages.map((img) => ({ base64: img.base64, type: img.type }))
      }

      const predictRes = await fetch(`${API_BASE}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictBody),
      })

      if (!predictRes.ok) {
        const errText = await predictRes.text()
        throw new Error(`Predict failed: ${predictRes.status} — ${errText.slice(0, 200)}`)
      }

      // ========================================
      // STREAM
      // ========================================
      setLoadingStage('streaming')

      const assistantMessage = { id: Date.now() + 1, role: 'assistant', content: '' }
      setMessages((prev) => [...prev, assistantMessage])

      const reader = predictRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter((l) => l.trim())

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.text) {
                fullText += parsed.text
                const formatted = formatMessage(fullText)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id ? { ...m, content: formatted, rawContent: fullText } : m
                  )
                )
              }
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.error('Send error:', err)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 2,
          role: 'assistant',
          content: `<p style="color:#e74c3c"><strong>Error:</strong> ${err.message}</p><p>Check console and Vercel logs for details.</p>`,
        },
      ])
    } finally {
      setLoading(false)
      setLoadingStage('')
      inputRef.current?.focus()
    }
  }

  const newChat = () => {
    setMessages([])
    setDataStatus(null)
    setUploadedImages([])
    setInput('')
  }

  // ============================================
  // RENDER
  // ============================================
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>FootballIQ</h1>
          <span style={styles.badge}>AI Analyst</span>
        </div>
        <div style={styles.headerRight}>
          <button
            onClick={triggerRefresh}
            style={{ ...styles.refreshBtn, opacity: refreshing ? 0.5 : 1 }}
            disabled={refreshing}
            title="Refresh data cache"
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          {dataStatus && <DataStatusIndicator status={dataStatus} />}
          <button onClick={newChat} style={styles.newChatBtn}>
            <Trash2 size={16} /> New Chat
          </button>
        </div>
      </header>

      <main style={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div style={styles.welcome}>
            <h2 style={styles.welcomeTitle}>Welcome to FootballIQ</h2>
            <p style={styles.welcomeText}>
              AI-powered football predictions backed by live odds, league standings, and match intelligence.
              Data refreshes automatically — just ask your question.
            </p>
            <div style={styles.quickGrid}>
              {QUICK_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q)} style={styles.quickBtn} disabled={loading}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{ ...styles.messageBubble, ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble) }}
            >
              {msg.role === 'user' && msg.images?.length > 0 && (
                <div style={styles.msgImages}>
                  {msg.images.map((src, i) => (
                    <img key={i} src={src} alt="uploaded" style={styles.msgImage} />
                  ))}
                </div>
              )}
              {msg.role === 'user' ? (
                <p style={styles.userText}>{msg.content}</p>
              ) : (
                <div style={styles.assistantContent}>
                  <div dangerouslySetInnerHTML={{ __html: msg.content }} style={styles.assistantText} />
                  <button onClick={() => copyMessage(msg.id, msg.content)} style={styles.copyBtn} title="Copy">
                    {copiedId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div style={styles.loadingBubble}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={styles.loadingText}>
              {loadingStage === 'research' && '📡 Reading match data...'}
              {loadingStage === 'predict' && '🧠 Claude is analyzing...'}
              {loadingStage === 'streaming' && '✍️ Writing analysis...'}
              {!loadingStage && 'Thinking...'}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {uploadedImages.length > 0 && (
        <div style={styles.imagePreviewBar}>
          {uploadedImages.map((img, i) => (
            <div key={i} style={styles.imagePreviewItem}>
              <img src={img.preview} alt={img.name} style={styles.imagePreviewThumb} />
              <button onClick={() => removeImage(i)} style={styles.imageRemoveBtn}>×</button>
            </div>
          ))}
        </div>
      )}

      <footer style={styles.inputBar}>
        <div style={styles.inputRow}>
          <button onClick={() => fileInputRef.current?.click()} style={styles.imageUploadBtn} disabled={loading} title="Upload images">
            <Image size={20} />
          </button>
          <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple style={{ display: 'none' }} />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Ask about any match, league, or accumulator..."
            style={styles.textInput}
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            style={{ ...styles.sendBtn, opacity: loading || (!input.trim() && uploadedImages.length === 0) ? 0.5 : 1 }}
            disabled={loading || (!input.trim() && uploadedImages.length === 0)}
          >
            <Send size={18} />
          </button>
        </div>
      </footer>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'DM Sans', sans-serif; background: #fff; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
        th, td { border: 1px solid #e0e0e0; padding: 6px 10px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        h1, h2, h3 { margin: 12px 0 6px; }
        ul { padding-left: 20px; margin: 6px 0; }
        li { margin: 3px 0; }
      `}</style>
    </div>
  )
}

// ============================================
// DATA STATUS INDICATOR
// ============================================
function DataStatusIndicator({ status }) {
  const [expanded, setExpanded] = useState(false)
  if (!status) return null

  const coreSources = [
    { key: 'odds', label: 'Live Odds', icon: '📊' },
    { key: 'standings', label: 'Standings', icon: '📋' },
    { key: 'context', label: 'Match Intel', icon: '🧠' },
  ]

  const coreSuccess = coreSources.filter((s) => status[s.key]?.success).length
  const hasLive = status.geminiLive?.success

  return (
    <div style={styles.statusContainer}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          ...styles.statusToggle,
          color: coreSuccess === 3 ? '#27ae60' : coreSuccess > 0 ? '#f39c12' : '#e74c3c',
        }}
      >
        {coreSuccess === 3 ? <Wifi size={14} /> : coreSuccess > 0 ? <AlertCircle size={14} /> : <WifiOff size={14} />}
        <span>{coreSuccess}/3{hasLive ? ' +news' : ''}</span>
        <ChevronDown size={12} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </button>
      {expanded && (
        <div style={styles.statusDropdown}>
          {coreSources.map((s) => {
            const info = status[s.key]
            return (
              <div key={s.key} style={styles.statusRow}>
                <span>{s.icon}</span>
                <span style={{ flex: 1 }}>{s.label}</span>
                {info?.success ? (
                  <span style={{ color: '#27ae60', fontSize: 12 }}>
                    ✓ {info.fixtures ? `${info.fixtures} fixtures` : ''}
                    {info.leagues ? `${info.leagues} leagues` : ''}
                    {info.chars ? `${info.chars} chars` : ''}
                    {info.age ? ` · ${info.age}` : ''}
                  </span>
                ) : (
                  <span style={{ color: '#e74c3c', fontSize: 12 }}>
                    ✗ {info?.error?.slice(0, 40) || 'Failed'}
                  </span>
                )}
              </div>
            )
          })}
          <div style={{ ...styles.statusRow, borderTop: '1px solid #eee', paddingTop: 6, marginTop: 4 }}>
            <span>🔍</span>
            <span style={{ flex: 1 }}>Live Search <span style={{ fontSize: 10, color: '#999' }}>per query</span></span>
            {status.geminiLive?.success ? (
              <span style={{ color: '#27ae60', fontSize: 12 }}>✓ {status.geminiLive.chars} chars</span>
            ) : (
              <span style={{ color: '#999', fontSize: 12 }}>— {status.geminiLive?.error?.slice(0, 35) || 'N/A'}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// STYLES
// ============================================
const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100dvh', maxWidth: 800, margin: '0 auto', background: '#fff' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 10 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { fontFamily: "'DM Serif Display', serif", fontSize: 22, margin: 0, fontWeight: 400 },
  badge: { fontSize: 11, background: '#000', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 500 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  refreshBtn: { background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: '#666', display: 'flex', alignItems: 'center' },
  newChatBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555' },
  messagesContainer: { flex: 1, overflowY: 'auto', padding: '20px' },
  welcome: { textAlign: 'center', padding: '60px 20px' },
  welcomeTitle: { fontFamily: "'DM Serif Display', serif", fontSize: 28, fontWeight: 400, marginBottom: 12 },
  welcomeText: { color: '#777', maxWidth: 500, margin: '0 auto 30px', lineHeight: 1.6, fontSize: 15 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, maxWidth: 600, margin: '0 auto' },
  quickBtn: { padding: '12px 16px', border: '1px solid #e0e0e0', borderRadius: 10, background: '#fafafa', cursor: 'pointer', fontSize: 13, textAlign: 'left', color: '#333', lineHeight: 1.4 },
  messageBubble: { marginBottom: 16, maxWidth: '85%' },
  userBubble: { marginLeft: 'auto', background: '#f0f0f0', borderRadius: '16px 16px 4px 16px', padding: '10px 16px' },
  assistantBubble: { marginRight: 'auto' },
  userText: { margin: 0, fontSize: 14, lineHeight: 1.5, color: '#222' },
  assistantContent: { position: 'relative' },
  assistantText: { fontSize: 14, lineHeight: 1.65, color: '#222' },
  copyBtn: { position: 'absolute', top: 0, right: -8, background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4 },
  loadingBubble: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', color: '#888', fontSize: 14 },
  loadingText: { fontSize: 13 },
  msgImages: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  msgImage: { width: 80, height: 80, objectFit: 'cover', borderRadius: 8 },
  imagePreviewBar: { display: 'flex', gap: 8, padding: '8px 20px', borderTop: '1px solid #eee', overflowX: 'auto' },
  imagePreviewItem: { position: 'relative', flexShrink: 0 },
  imagePreviewThumb: { width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e0e0e0' },
  imageRemoveBtn: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: '#e74c3c', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  inputBar: { padding: '12px 20px', borderTop: '1px solid #eee', background: '#fff' },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  imageUploadBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 6, borderRadius: 8, display: 'flex' },
  textInput: { flex: 1, padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 14, outline: 'none', fontFamily: "'DM Sans', sans-serif" },
  sendBtn: { background: '#000', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  statusContainer: { position: 'relative' },
  statusToggle: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid #e0e0e0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  statusDropdown: { position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: 8, minWidth: 280, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20 },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 },
}
