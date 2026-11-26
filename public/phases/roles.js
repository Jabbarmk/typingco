// Users & roles: what the logged-in person may see and do, and the screens to manage roles.
//   can('profit')      – may this person do that?
//   canPage('reports') – may this person open that page?
// Any element with class "needs-<permission>" is hidden from people without it.
// NOTE: this controls what the screens offer. The API itself does not check it (there is no login token yet).
(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const errMsg = e => { let m = (e && e.message) || 'Something went wrong'; try { m = JSON.parse(m).error || m } catch (_) {} return m }

  const ALL = ['pos', 'quotations', 'sales_view', 'sales_edit', 'customers_view', 'customers_edit', 'customers_delete', 'applications', 'documents_view', 'documents_edit',
    'documents_delete', 'renewals', 'services_edit', 'expenses', 'accounting', 'vat', 'reports', 'profit', 'cash_own', 'staff_report', 'settings', 'users_manage', 'einvoice']
  // used only until the real list arrives from the server (or if it cannot be reached)
  const OPERATOR = ['pos', 'quotations', 'sales_view', 'customers_view', 'customers_edit', 'applications', 'documents_view', 'documents_edit', 'renewals', 'cash_own']
  const PAGE_PERM = {
    pos: ['pos'], quotations: ['quotations'], sales: ['sales_view'], customers: ['customers_view'], services: ['services_edit'], applications: ['applications'],
    documents: ['documents_view'], renewals: ['renewals'], notifications: ['renewals'], accounting: ['accounting'], vat: ['vat'], reports: ['reports'],
    profit: ['profit'], cashstaff: ['cash_own', 'staff_report'], einvoice: ['einvoice'], settings: ['settings', 'users_manage'],
  }

  window.PERMS = { set: null, role_name: '' }
  window.can = p => {
    if (!p) return true
    if (PERMS.set) return PERMS.set.has(p)
    if (['superadmin', 'admin'].includes(_SESSION.role)) return true
    if (_SESSION.role === 'manager') return p !== 'users_manage'
    return OPERATOR.includes(p)
  }
  window.canPage = id => { const need = PAGE_PERM[id]; return !need || need.some(p => can(p)) }

  // ───────── hide what is not allowed ─────────
  const style = document.createElement('style')
  style.textContent = ALL.map(p => `body.no-${p} .needs-${p}{display:none!important}`).join('\n') + `
.perm-hidden{display:none!important}
.role-card{display:flex;flex-direction:column;gap:10px;padding:18px}
.role-card h4{margin:0;font-size:15px;font-weight:800}
.role-tags{display:flex;gap:5px;flex-wrap:wrap}
.role-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--accent-light);color:var(--accent)}
.perm-group{border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.perm-group h5{margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg3);display:flex;justify-content:space-between;align-items:center}
.perm-group h5 button{border:none;background:none;color:var(--accent);font-size:11px;font-weight:700;cursor:pointer;text-transform:none;letter-spacing:0}
.perm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 14px}
.perm-grid label{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.perm-grid label.off{opacity:.5;cursor:not-allowed}`
  document.head.appendChild(style)

  window.applyPermissions = function () {
    ALL.forEach(p => document.body.classList.toggle('no-' + p, !can(p)))
    document.querySelectorAll('.sidebar .nav-item').forEach(b => {
      const m = /nav\('(\w+)'/.exec(b.getAttribute('onclick') || '')
      if (m) b.classList.toggle('perm-hidden', !canPage(m[1]))
    })
    // a group with nothing left in it is hidden too
    document.querySelectorAll('.sidebar .nav-group').forEach(g => g.classList.toggle('perm-hidden', !g.querySelector('.nav-item:not(.perm-hidden)')))
    // Settings tabs: "Users & Roles" needs users_manage, the rest need settings
    document.querySelectorAll('#page-settings .tabs .tab-btn').forEach(b => {
      const isUsers = /s-users/.test(b.getAttribute('onclick') || '')
      b.classList.toggle('perm-hidden', !can(isUsers ? 'users_manage' : 'settings'))
    })
    document.querySelectorAll('.icon-btn[title="Notifications"]').forEach(b => b.classList.toggle('perm-hidden', !canPage('notifications')))
    document.querySelectorAll('.tb-newsale, #sale-bar').forEach(b => b.classList.toggle('perm-hidden', !can('pos')))
    if (PERMS.role_name && $('sb-role')) $('sb-role').textContent = PERMS.role_name + (_SESSION.coname ? ' · ' + _SESSION.coname : '')
    // sitting on a page that is not allowed: go to the dashboard
    const active = document.querySelector('.page.active')
    if (active && !canPage(active.id.replace('page-', '')) && typeof nav === 'function') nav('dashboard', null)
  }

  window.loadPermissions = async function () {
    try {
      const r = await fetch(`/api/${CID}/me/permissions?user_id=${_SESSION.uid}`)
      if (r.ok) { const p = await r.json(); PERMS.set = new Set(p.permissions); PERMS.role_name = p.role_name }
    } catch (_) { /* keep the fallback for this person's type */ }
    applyPermissions()
  }
  // open Settings on the first tab this person may use
  window.settingsFirstTab = function () {
    const cur = document.querySelector('#page-settings .tabs .tab-btn.active')
    if (cur && !cur.classList.contains('perm-hidden')) return
    const first = [...document.querySelectorAll('#page-settings .tabs .tab-btn')].find(b => !b.classList.contains('perm-hidden'))
    if (first) first.click()
  }

  // ───────── Users & Roles screen ─────────
  window.ROLES = []
  let CATALOGUE = [], editing = null

  window.urTab = which => {
    $('ur-users').style.display = which === 'users' ? '' : 'none'
    $('ur-roles').style.display = which === 'roles' ? '' : 'none'
    $('ur-tab-users').classList.toggle('active', which === 'users')
    $('ur-tab-roles').classList.toggle('active', which === 'roles')
    if (which === 'roles') loadRoles()
  }

  window.loadRoles = async function () {
    try {
      const r = await apiFetch(`/${CID}/roles`)
      ROLES = window.ROLES = r.roles; CATALOGUE = r.permissions
      renderRoles()
    } catch (e) { if ($('role-cards')) $('role-cards').innerHTML = '<div style="color:var(--red);padding:20px;">Could not load the roles</div>' }
  }

  function renderRoles() {
    const el = $('role-cards'); if (!el) return
    el.innerHTML = window.ROLES.map(r => {
      const groups = [...new Set(CATALOGUE.filter(p => r.permissions.includes(p.id)).map(p => p.group))]
      const locked = r.is_system && r.name === 'Admin'
      return `<div class="card role-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;"><h4>${esc(r.name)}</h4><span class="badge ${r.is_system ? 'b-gray' : 'b-purple'}">${r.is_system ? 'Built-in' : 'Custom'}</span></div>
        <div style="font-size:12.5px;color:var(--fg2);min-height:34px;">${esc(r.description || '')}</div>
        <div style="font-size:12px;color:var(--fg3);"><b style="color:var(--fg);">${r.permissions.length}</b> of ${CATALOGUE.length} permissions · <b style="color:var(--fg);">${r.users}</b> user${r.users === 1 ? '' : 's'}</div>
        <div class="role-tags">${groups.map(g => `<span class="role-tag">${esc(g)}</span>`).join('')}</div>
        <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:10px;margin-top:auto;">
          <button class="btn btn-secondary btn-sm" style="flex:1;justify-content:center;" onclick="openRoleModal(${r.id})">${locked ? 'View' : 'Edit permissions'}</button>
          ${r.is_system ? '' : `<button class="btn btn-sm" style="background:var(--red-light);color:var(--red);" onclick="deleteRole(${r.id})">Delete</button>`}
        </div></div>`
    }).join('')
  }

  window.openRoleModal = async id => {
    if (!CATALOGUE.length) await loadRoles()
    editing = id ? window.ROLES.find(r => r.id === id) : null
    const locked = !!(editing && editing.is_system && editing.name === 'Admin')
    $('role-modal-title').textContent = editing ? (locked ? 'Admin role' : 'Edit role: ' + editing.name) : 'New role'
    $('role-name').value = editing ? editing.name : ''
    $('role-name').disabled = !!(editing && editing.is_system)
    $('role-desc').value = editing ? editing.description || '' : ''
    const has = new Set(editing ? editing.permissions : ['pos', 'customers_view'])
    const groups = [...new Set(CATALOGUE.map(p => p.group))]
    $('role-perms').innerHTML = (locked ? '<div class="ops-note" style="margin-bottom:10px;">Admin always has every permission, so the company can never be locked out.</div>' : '') +
      groups.map(g => `<div class="perm-group"><h5><span>${esc(g)}</span>${locked ? '' : `<button type="button" data-group="${esc(g)}">select all</button>`}</h5><div class="perm-grid">` +
        CATALOGUE.filter(p => p.group === g).map(p => {
          const adminOnly = p.id === 'users_manage' && !locked       // only Admin can manage users and roles
          return `<label class="${locked || adminOnly ? 'off' : ''}"><input type="checkbox" value="${p.id}" ${has.has(p.id) && !adminOnly ? 'checked' : ''} ${locked || adminOnly ? 'disabled' : ''}> ${esc(p.label)}${adminOnly ? ' <small>(Admin only)</small>' : ''}</label>`
        }).join('') + '</div></div>').join('')
    $('role-perms').querySelectorAll('[data-group]').forEach(b => { b.onclick = () => { const boxes = [...b.closest('.perm-group').querySelectorAll('input:not(:disabled)')]; const on = boxes.some(x => !x.checked); boxes.forEach(x => { x.checked = on }) } })
    $('role-save').style.display = locked ? 'none' : ''
    openModal('role-modal')
  }

  window.saveRole = async () => {
    const body = { name: $('role-name').value.trim(), description: $('role-desc').value.trim(), permissions: [...$('role-perms').querySelectorAll('input:checked')].map(i => i.value) }
    if (!body.name) { showToast('Give the role a name', 'error'); return }
    const btn = $('role-save'); btn.disabled = true
    try {
      if (editing) await apiFetch(`/${CID}/roles/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await apiFetch(`/${CID}/roles`, { method: 'POST', body: JSON.stringify(body) })
      closeModal('role-modal'); showToast(editing ? 'Role updated' : 'Role created')
      await loadRoles(); loadPermissions()
    } catch (e) { showToast(errMsg(e), 'error') } finally { btn.disabled = false }
  }

  window.deleteRole = async id => {
    const r = window.ROLES.find(x => x.id === id); if (!r) return
    if (!confirm(`Delete the role "${r.name}"?`)) return
    try { await apiFetch(`/${CID}/roles/${id}`, { method: 'DELETE' }); showToast('Role deleted'); loadRoles() } catch (e) { showToast(errMsg(e), 'error') }
  }

  // ───────── the role picker on the employee form ─────────
  const BASE_NAME = { admin: 'Admin', manager: 'Manager', operator: 'Operator' }
  window.fillEmpRole = async emp => {
    if (!window.ROLES.length) await loadRoles()
    const sel = $('emp-role')
    if (!window.ROLES.length) return                      // keep the plain list if the roles could not be loaded
    sel.innerHTML = window.ROLES.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')
    const want = emp ? (emp.role_id || (window.ROLES.find(r => r.name === BASE_NAME[emp.role]) || {}).id) : (window.ROLES.find(r => r.name === 'Operator') || {}).id
    if (want) sel.value = String(want)
  }
  window.empRolePayload = () => { const v = $('emp-role').value; return /^\d+$/.test(v) ? { role_id: parseInt(v) } : { role: v } }

  applyPermissionsSoon()
  function applyPermissionsSoon() {
    const start = () => { applyPermissions(); loadPermissions() }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start()
  }
})()
