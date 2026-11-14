import React, { useState, useEffect, useRef } from 'react'

const API = '/api'
const SESSION_KEY = 'alnoor_session'

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}
function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user))
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ─── Login Page ───────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Login failed'); return }
      saveSession(data)
      onLogin(data)
    } catch {
      setError('Cannot reach server — make sure the API is running')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #060d1f 0%, #0f1e3d 60%, #0a1628 100%)',
      fontFamily: "'Poppins', system-ui, sans-serif",
      padding: '20px',
    }}>
      {/* Background pattern */}
      <div style={{ position: 'fixed', inset: 0, opacity: .04, backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 900, color: '#fff',
            boxShadow: '0 8px 32px rgba(37,99,235,.4)',
            marginBottom: 16,
          }}>T</div>
          <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' }}>TypinGo</div>
          <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginTop: 4 }}>Typing & Document Services Platform</div>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,.04)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 20,
          padding: '36px 32px',
          boxShadow: '0 24px 64px rgba(0,0,0,.4)',
        }}>
          <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Sign in</div>
          <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginBottom: 28 }}>Enter your credentials to access the system</div>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,.6)', fontSize: 12, fontWeight: 600, marginBottom: 7, letterSpacing: '.03em', textTransform: 'uppercase' }}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required autoFocus
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,.12)',
                  background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 14,
                  outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color .15s',
                }}
                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,.6)', fontSize: 12, fontWeight: 600, marginBottom: 7, letterSpacing: '.03em', textTransform: 'uppercase' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'} value={password} onChange={e => setPass(e.target.value)}
                  placeholder="••••••••" required
                  style={{
                    width: '100%', padding: '11px 44px 11px 14px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,.12)',
                    background: 'rgba(255,255,255,.07)', color: '#fff', fontSize: 14,
                    outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color .15s',
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.4)', padding: 2,
                }}>
                  {showPw
                    ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)',
                borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px', borderRadius: 10, border: 'none',
              background: loading ? 'rgba(37,99,235,.5)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', letterSpacing: '.01em',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(37,99,235,.4)',
              transition: 'all .15s',
            }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12 }}>
          <div style={{ color: 'rgba(255,255,255,.2)', marginBottom: 6 }}>TypinGo v2.0 · Sharjah, UAE</div>
          <div style={{ color: 'rgba(255,255,255,.18)' }}>
            Powered by{' '}
            <a href="https://www.smartflix.ae" target="_blank" rel="noopener noreferrer"
              style={{ color: 'rgba(255,255,255,.4)', textDecoration: 'none', fontWeight: 600, transition: 'color .15s' }}
              onMouseOver={e => e.target.style.color='rgba(255,255,255,.8)'}
              onMouseOut={e => e.target.style.color='rgba(255,255,255,.4)'}
            >Smartflix</a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser]   = useState(() => getSession())
  const [dbOk, setDbOk]   = useState(null)
  // For superadmin: which sub-view; for company staff: always 'erp'
  const [phase, setPhase] = useState(() => {
    const s = getSession()
    return s?.role === 'superadmin' ? 'superadmin' : 'erp'
  })

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json()).then(() => setDbOk(true))
      .catch(() => setDbOk(false))
  }, [])

  function handleLogin(userData) {
    setUser(userData)
    setPhase(userData.role === 'superadmin' ? 'superadmin' : 'erp')
  }

  function handleLogout() {
    clearSession()
    setUser(null)
    setPhase('erp')
  }

  if (!user) return <LoginPage onLogin={handleLogin} />

  const isSuperAdmin = user.role === 'superadmin'
  const companyId    = user.company_id || 1

  // Build iframe src with user context
  const erpSrc   = `/phases/erp.html?cid=${companyId}&uid=${user.id}&uname=${encodeURIComponent(user.name)}&role=${user.role}&coname=${encodeURIComponent(user.company_name||'')}`
  const adminSrc = `/phases/superadmin.html?uid=${user.id}&uname=${encodeURIComponent(user.name)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <div style={{
        background: '#060d1f', borderBottom: '1px solid rgba(255,255,255,.08)',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        height: 44, flexShrink: 0, zIndex: 200, gap: 0,
        fontFamily: "'Poppins',system-ui,sans-serif",
      }}>
        <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, fontWeight: 700,
          letterSpacing: '.1em', textTransform: 'uppercase', marginRight: 16, whiteSpace: 'nowrap' }}>
          TypinGo
        </div>

        {/* Phase tabs — superadmin sees both, company staff see only ERP */}
        {isSuperAdmin && (
          <>
            <PhaseTab id="superadmin" label="Super Admin" sub="Platform" icon="🏢" active={phase} onClick={setPhase} />
            <PhaseTab id="erp"        label="Company ERP" sub="Preview"  icon="⚡" active={phase} onClick={setPhase} />
          </>
        )}
        {!isSuperAdmin && (
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚡</span>
            <span>{user.company_name || 'TypinGo'}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)', padding: '2px 7px', borderRadius: 10, textTransform: 'capitalize' }}>{user.role}</span>
          </div>
        )}

        {/* Right side: DB status + user + logout */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: dbOk === null ? '#f59e0b' : dbOk ? '#10b981' : '#ef4444' }} />
            <span style={{ color: 'rgba(255,255,255,.35)' }}>{dbOk ? 'DB online' : dbOk === false ? 'DB offline' : '…'}</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,.15)' }}>|</span>
          {/* User pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.07)', borderRadius: 20, padding: '3px 10px 3px 4px' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
              {user.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
            </div>
            <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, fontWeight: 500 }}>{user.name.split(' ')[0]}</span>
          </div>
          {/* Logout */}
          <button onClick={handleLogout} title="Logout" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.35)',
            display: 'flex', alignItems: 'center', padding: '4px 6px', borderRadius: 6, transition: 'all .15s',
          }}
            onMouseOver={e => { e.currentTarget.style.background='rgba(239,68,68,.2)'; e.currentTarget.style.color='#fca5a5' }}
            onMouseOut={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color='rgba(255,255,255,.35)' }}
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {dbOk === false && (
        <div style={{ background: '#7f1d1d', color: '#fecaca', fontSize: 12, padding: '6px 16px', textAlign: 'center', flexShrink: 0 }}>
          ⚠ API server not reachable — start: <code style={{ background: 'rgba(0,0,0,.3)', padding: '1px 6px', borderRadius: 4 }}>cd server &amp;&amp; node index.js</code>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {phase === 'superadmin' && isSuperAdmin && (
          <iframe key={adminSrc} src={adminSrc} title="Super Admin" style={{ width:'100%', height:'100%', border:'none', display:'block' }} />
        )}
        {(phase === 'erp' || !isSuperAdmin) && (
          <iframe key={erpSrc} src={erpSrc} title="Typing ERP" style={{ width:'100%', height:'100%', border:'none', display:'block' }} />
        )}
      </div>
    </div>
  )
}

function PhaseTab({ id, label, sub, icon, active, onClick }) {
  const isActive = active === id
  return (
    <button onClick={() => onClick(id)} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 14px', height: 44, background: 'transparent', border: 'none',
      borderBottom: `2px solid ${isActive ? '#2563eb' : 'transparent'}`,
      color: isActive ? '#fff' : 'rgba(255,255,255,.5)',
      cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 600 : 400,
      fontFamily: 'inherit', transition: 'all .15s', whiteSpace: 'nowrap',
    }}>
      <span>{icon}</span><span>{label}</span>
      <span style={{ fontSize: 10, opacity: .55 }}>{sub}</span>
    </button>
  )
}
