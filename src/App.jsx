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

  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0',
    background: '#fff', color: '#17233C', fontSize: 16, minHeight: 46,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    transition: 'border-color .15s, box-shadow .15s',
  }
  const focusOn  = e => { e.target.style.borderColor = '#1D467A'; e.target.style.boxShadow = '0 0 0 3px rgba(27,181,211,.18)' }
  const focusOff = e => { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none' }
  const labelStyle = { display: 'block', color: '#64748B', fontSize: 12, fontWeight: 600, marginBottom: 7, letterSpacing: '.03em', textTransform: 'uppercase' }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #EEF1F7 0%, #E9EDF4 100%)',
      fontFamily: "'Inter','Poppins', system-ui, sans-serif",
      padding: '20px', boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Logo + slogan */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/typingo-logo.png" alt="Typingo — from Smartflix"
            style={{ width: '100%', maxWidth: 340, height: 'auto', display: 'block', margin: '0 auto', mixBlendMode: 'multiply', filter: 'brightness(1.03) contrast(1.06)' }} />
          <div style={{ color: '#64748B', fontSize: 13, marginTop: 6 }}>Typing & Document Services Platform</div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 20,
          padding: '32px 28px', boxShadow: '0 20px 50px rgba(20,33,61,.08), 0 2px 6px rgba(20,33,61,.04)',
        }}>
          <div style={{ color: '#17233C', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Sign in</div>
          <div style={{ color: '#64748B', fontSize: 13, marginBottom: 24 }}>Enter your credentials to access the system</div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required autoFocus style={inputStyle} onFocus={focusOn} onBlur={focusOff} />
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPass(e.target.value)}
                  placeholder="••••••••" required style={{ ...inputStyle, paddingRight: 48 }} onFocus={focusOn} onBlur={focusOff} />
                <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', width: 40, height: 40,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {showPw
                    ? <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: 10, padding: '10px 14px', color: '#B91C1C', fontSize: 13, marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px', minHeight: 48, borderRadius: 12, border: 'none',
              background: loading ? '#9DB6D6' : 'linear-gradient(135deg, #1D467A, #2A5C9C)',
              color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', letterSpacing: '.01em',
              boxShadow: loading ? 'none' : '0 6px 18px rgba(37,99,235,.3)',
              transition: 'all .15s',
            }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 12 }}>
          <div style={{ color: '#94A3B8', marginBottom: 6 }}>TypinGo v2.0</div>
          <div style={{ color: '#94A3B8' }}>
            Powered by{' '}
            <a href="https://www.smartflix.ae" target="_blank" rel="noopener noreferrer"
              style={{ color: '#1D467A', textDecoration: 'none', fontWeight: 600 }}>Smartflix</a>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Top bar — platform switcher, Super Admin only (staff use the ERP's own header) */}
      {isSuperAdmin && <div style={{
        background: '#fff', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 12px',
        height: 48, flexShrink: 0, zIndex: 200, gap: 0, overflowX: 'auto',
        fontFamily: "'Inter','Poppins',system-ui,sans-serif",
      }}>
        <style>{`@media (max-width: 640px){ .tb-hide-sm{display:none !important} .tb-tab{padding:0 10px !important} }`}</style>
        <img className="tb-hide-sm" src="/typingo-logo.png" alt="Typingo" style={{ height: 28, width: 'auto', marginRight: 12, mixBlendMode: 'multiply', flexShrink: 0 }} />

        {/* Phase tabs — superadmin sees both, company staff see only ERP */}
        {isSuperAdmin && (
          <>
            <PhaseTab id="superadmin" label="Super Admin" sub="Platform" icon="🏢" active={phase} onClick={setPhase} />
            <PhaseTab id="erp"        label="Company ERP" sub="Preview"  icon="⚡" active={phase} onClick={setPhase} />
          </>
        )}

        {/* Right side: DB status + user + logout */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
          <div className="tb-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: dbOk === null ? '#f59e0b' : dbOk ? '#10b981' : '#ef4444' }} />
            <span style={{ color: '#64748B' }}>{dbOk ? 'DB online' : dbOk === false ? 'DB offline' : '…'}</span>
          </div>
          <span className="tb-hide-sm" style={{ color: '#CBD5E1' }}>|</span>
          {/* User pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#F1F5F9', borderRadius: 20, padding: '3px 10px 3px 4px' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1D467A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
              {user.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
            </div>
            <span className="tb-hide-sm" style={{ color: '#17233C', fontSize: 12, fontWeight: 500 }}>{user.name.split(' ')[0]}</span>
          </div>
          {/* Logout */}
          <button onClick={handleLogout} title="Logout" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8',
            display: 'flex', alignItems: 'center', padding: '8px', borderRadius: 8, transition: 'all .15s',
          }}
            onMouseOver={e => { e.currentTarget.style.background='#FEE2E2'; e.currentTarget.style.color='#DC2626' }}
            onMouseOut={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color='#94A3B8' }}
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>}

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
    <button className="tb-tab" onClick={() => onClick(id)} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 14px', height: 48, background: 'transparent', border: 'none',
      borderBottom: `2px solid ${isActive ? '#1D467A' : 'transparent'}`,
      color: isActive ? '#17233C' : '#64748B',
      cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 600 : 400,
      fontFamily: 'inherit', transition: 'all .15s', whiteSpace: 'nowrap',
    }}>
      <span>{icon}</span><span>{label}</span>
      <span className="tb-hide-sm" style={{ fontSize: 10, opacity: .55 }}>{sub}</span>
    </button>
  )
}
