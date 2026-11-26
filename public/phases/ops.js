// Renewal reminders · Cash & staff control · Profit · Service catalogue
// Loaded by erp.html after its main script, so it shares CID, apiFetch, fmt, showToast, openModal, closeModal, _SESSION…
(function () {
  const $ = id => document.getElementById(id)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const money = n => 'AED ' + fmt(n)
  const isMgr = () => can('staff_report')        // may see every staff member, not only themselves
  const errMsg = e => { let m = e && e.message || 'Something went wrong'; try { m = JSON.parse(m).error || m } catch (_) {} return m }
  const dt = v => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  const dOnly = v => v ? new Date(String(v).length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const kpi = (label, value, tone, color) => `<div class="rpt-kpi ${tone || 'k-slate'}"${color ? ` style="--k:${color};"` : ''}><b>${value}</b><span>${label}</span></div>`
  const empty = (cols, msg) => `<tr><td colspan="${cols}" style="text-align:center;color:var(--fg3);padding:26px;">${msg}</td></tr>`

  // ───────── period presets shared by the date filters ─────────
  const periodRange = p => {
    const now = new Date(), iso = localISO
    if (p === 'today') return [iso(now), iso(now)]
    if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), iso(now)] }
    if (p === 'year') return [iso(new Date(now.getFullYear(), 0, 1)), iso(now)]
    return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)]
  }
  const LOADERS = { csh: () => loadShiftHistory(), css: () => loadStaffReport(), pf: () => loadProfit() }
  window.setCsPeriod = (prefix, p) => { const [a, b] = periodRange(p); $(prefix + '-from').value = a; $(prefix + '-to').value = b; LOADERS[prefix]() }
  const ensureDates = prefix => { if (!$(prefix + '-from').value) { const [a, b] = periodRange('month'); $(prefix + '-from').value = a; $(prefix + '-to').value = b } }

  // ═════════════ RENEWAL REMINDERS ═════════════
  let RENEWALS = [], RN_STATUS = null, RN_FILTER = 'all'

  async function fetchRenewals() {
    ;[RENEWALS, RN_STATUS] = await Promise.all([apiFetch(`/${CID}/renewals?days=90`), apiFetch(`/${CID}/reminders/status`)])
    const due = RENEWALS.filter(r => r.days_left <= 30).length
    const b = $('renewals-badge'); if (b) { b.textContent = due; b.style.display = due ? '' : 'none' }
  }

  window.loadRenewals = async function () {
    try { await fetchRenewals() } catch (e) { $('rn-tbody').innerHTML = empty(7, 'Could not load renewals'); return }
    renderRenewals()
  }

  window.setRnFilter = (f, btn) => {
    RN_FILTER = f
    document.querySelectorAll('#rn-chips .ops-chip').forEach(b => b.classList.toggle('active', b === btn))
    renderRenewals()
  }

  const rnStatus = d => d < 0 ? [`Expired ${-d} day${d === -1 ? '' : 's'} ago`, 'b-red']
    : d === 0 ? ['Expires today', 'b-red'] : d <= 7 ? [`${d} day${d === 1 ? '' : 's'} left`, 'b-red']
    : d <= 30 ? [`${d} days left`, 'b-amber'] : [`${d} days left`, 'b-green']

  window.renderRenewals = function () {
    const all = RENEWALS
    $('rn-kpis').innerHTML =
      kpi('Expired', all.filter(r => r.days_left < 0).length, '', '#E11D48') +
      kpi('Within 7 days', all.filter(r => r.days_left >= 0 && r.days_left <= 7).length, '', '#F97316') +
      kpi('Within 30 days', all.filter(r => r.days_left >= 0 && r.days_left <= 30).length, 'k-amber') +
      kpi('Within 90 days', all.filter(r => r.days_left >= 0).length, 'k-accent')
    const auto = RN_STATUS && RN_STATUS.auto_enabled
    $('rn-auto').className = 'ops-note ' + (auto ? 'ok' : 'warn')
    $('rn-auto').innerHTML = auto
      ? '<b>Automatic WhatsApp reminders are ON.</b> Each customer is messaged 30, 14, 7 and 1 days before the expiry and on the day. You can also send one yourself below.'
      : '<b>Reminders are one click away.</b> Press <b>WhatsApp</b> on a row and the message opens ready to send. To send them <b>automatically</b>, connect a WhatsApp Business account: set <code>WHATSAPP_TOKEN</code> and <code>WHATSAPP_PHONE_ID</code> for the server and create an approved message template named <code>document_expiry_reminder</code> (4 variables: customer, document, expiry date, company).'

    const q = ($('rn-search').value || '').toLowerCase()
    const rows = all.filter(r => {
      if (RN_FILTER === 'expired' && r.days_left >= 0) return false
      if (['7', '30', '90'].includes(RN_FILTER) && !(r.days_left >= 0 && r.days_left <= +RN_FILTER)) return false
      return !q || (r.customer_name || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)
    })
    $('rn-tbody').innerHTML = rows.length ? rows.map(r => {
      const [lbl, cls] = rnStatus(r.days_left)
      return `<tr>
        <td><strong>${esc(r.customer_name || '—')}</strong></td>
        <td>${esc(r.name)}</td>
        <td>${dOnly(r.expires_at)}</td>
        <td><span class="badge ${cls}">${lbl}</span></td>
        <td style="font-size:12px;">${r.phone ? esc(r.phone) : '<span style="color:var(--red);">No number</span>'}</td>
        <td style="font-size:12px;color:var(--fg3);">${r.last_reminded_at ? dOnly(r.last_reminded_at) + ` · ${r.reminder_count}×` : 'Not yet'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-success btn-xs" onclick="sendRenewalWhatsApp(${r.id})">WhatsApp</button>
          <button class="btn btn-secondary btn-xs" onclick="copyRenewalMessage(${r.id})">Copy</button>
        </td></tr>`
    }).join('') : empty(7, all.length ? 'Nothing matches this filter' : 'No documents are expiring in the next 90 days')
  }

  window.sendRenewalWhatsApp = async id => {
    const r = RENEWALS.find(x => x.id === id); if (!r) return
    if (!r.wa_phone) {   // no mobile saved: ask for it (and offer to save it to the customer)
      r.wa_phone = await ensureMobile({ customerId: r.customer_id, name: r.customer_name, current: r.phone })
      if (!r.wa_phone) return
      r.phone = r.wa_phone
    }
    window.open(`https://wa.me/${r.wa_phone}?text=${encodeURIComponent(r.message)}`, '_blank', 'noopener')
    try {
      await apiFetch(`/${CID}/renewals/${id}/reminded`, { method: 'POST', body: JSON.stringify({ user_id: _SESSION.uid, message: r.message, phone: r.wa_phone }) })
      r.last_reminded_at = new Date().toISOString(); r.reminder_count = (r.reminder_count || 0) + 1
      renderRenewals()
    } catch (e) { showToast('Opened WhatsApp, but could not record the reminder', 'error') }
  }

  window.copyRenewalMessage = async id => {
    const r = RENEWALS.find(x => x.id === id); if (!r) return
    try { await navigator.clipboard.writeText(r.message); showToast('Message copied') } catch (_) { showToast(r.message) }
  }

  window.openReminderLog = async () => {
    const tb = $('rl-tbody'); tb.innerHTML = empty(5, 'Loading…'); openModal('reminder-log-modal')
    try {
      const rows = await apiFetch(`/${CID}/reminders/log`)
      tb.innerHTML = rows.length ? rows.map(r => `<tr>
        <td style="white-space:nowrap;font-size:12px;">${dt(r.created_at)}</td>
        <td>${esc(r.customer_name || '—')}</td><td>${esc(r.document || '—')}</td>
        <td style="font-size:12px;">${r.mode === 'auto' ? 'Automatic' + (r.stage_days != null ? ` (${r.stage_days}d)` : '') : 'By ' + esc(r.sent_by_name || 'staff')}</td>
        <td><span class="badge ${r.status === 'sent' ? 'b-green' : 'b-red'}" title="${esc(r.error || '')}">${r.status}</span></td></tr>`).join('')
        : empty(5, 'No reminders sent yet')
    } catch (e) { tb.innerHTML = empty(5, 'Could not load the history') }
  }

  // ═════════════ CASH & STAFF ═════════════
  let SHIFT = null

  window.loadCashStaff = () => {
    $('cs-staff-tab').style.display = isMgr() ? '' : 'none'
    const mine = document.querySelector('.tab-btn[onclick*="cs-shift"]')
    mine.style.display = can('cash_own') ? '' : 'none'
    if (!can('cash_own')) { document.querySelector('.tab-btn[onclick*="cs-history"]').click(); return }
    loadShiftTab()
  }

  window.loadShiftTab = async function () {
    const body = $('cs-shift-body'); body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--fg3);">Loading…</div>'
    try { SHIFT = await apiFetch(`/${CID}/shifts/current?user_id=${_SESSION.uid}`) } catch (e) { body.innerHTML = '<div class="ops-note warn">Could not load your shift.</div>'; return }
    if (!SHIFT) {
      body.innerHTML = `<div class="card shift-card">
        <div style="font-size:18px;font-weight:800;">Start your shift</div>
        <p style="color:var(--fg2);font-size:13px;margin:6px 0 16px;">Count the cash already in the drawer and enter it as the opening float. Every sale you make from now on is tracked against this shift, so the drawer can be checked when you close it.</p>
        <div class="form-group"><label>Opening cash in drawer (AED)</label><input id="sh-open-cash" type="number" min="0" step="0.01" value="0" style="font-size:18px;font-weight:700;"></div>
        <button class="btn btn-primary" style="margin-top:12px;" onclick="startShift()">Start shift</button></div>`
      return
    }
    body.innerHTML = `<div class="card shift-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div><div style="font-size:18px;font-weight:800;">Shift in progress</div><div style="font-size:12px;color:var(--fg3);margin-top:2px;">Started ${dt(SHIFT.opened_at)} · ${esc(SHIFT.user_name || _SESSION.name)}</div></div>
        <span class="badge b-green">Open</span>
      </div>
      <div class="shift-grid">
        ${kpi('Opening float', money(SHIFT.opening_cash))}
        ${kpi('Cash sales', money(SHIFT.cash_sales), 'k-green')}
        ${kpi('Expected in drawer', money(SHIFT.expected_cash), 'k-accent')}
        ${kpi('Card', money(SHIFT.card_sales))}
        ${kpi('Bank transfer', money(SHIFT.transfer_sales))}
        ${kpi('On credit', money(SHIFT.credit_sales), 'k-amber')}
      </div>
      <div style="font-size:12px;color:var(--fg3);margin-bottom:14px;">${SHIFT.invoice_count} invoice${SHIFT.invoice_count === 1 ? '' : 's'} this shift. Expected cash = opening float + cash sales.</div>
      <div style="display:flex;gap:8px;"><button class="btn btn-primary" onclick="openCloseShift()">Close shift &amp; count cash</button><button class="btn btn-secondary" onclick="loadShiftTab()">Refresh</button></div></div>`
  }

  window.startShift = async () => {
    const opening = parseFloat($('sh-open-cash').value)
    if (!Number.isFinite(opening) || opening < 0) { showToast('Enter the opening cash', 'error'); return }
    try {
      await apiFetch(`/${CID}/shifts/open`, { method: 'POST', body: JSON.stringify({ user_id: _SESSION.uid, user_name: _SESSION.name, opening_cash: opening }) })
      showToast('Shift started'); loadShiftTab()
    } catch (e) { showToast(errMsg(e), 'error') }
  }

  window.openCloseShift = async () => {
    try { SHIFT = await apiFetch(`/${CID}/shifts/current?user_id=${_SESSION.uid}`) } catch (e) {}   // fresh totals
    if (!SHIFT) { loadShiftTab(); return }
    $('sc-summary').innerHTML = `<span>Opening float</span><b>${money(SHIFT.opening_cash)}</b><span>Cash sales (${SHIFT.invoice_count} invoices in total)</span><b>${money(SHIFT.cash_sales)}</b>
      <span style="font-weight:700;">Expected in drawer</span><b style="color:var(--accent);">${money(SHIFT.expected_cash)}</b>`
    $('sc-counted').value = ''; $('sc-notes').value = ''; updateShiftDiff(); openModal('shift-close-modal'); $('sc-counted').focus()
  }

  window.updateShiftDiff = () => {
    const el = $('sc-diff'), v = $('sc-counted').value
    if (v === '' || !SHIFT) { el.style.cssText = 'padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;margin-bottom:12px;background:var(--surface2);color:var(--fg3);'; el.textContent = 'Enter the counted cash to see the difference'; return }
    const diff = Math.round((parseFloat(v) - parseFloat(SHIFT.expected_cash)) * 100) / 100
    const [bg, fg, txt] = diff === 0 ? ['var(--green-light)', 'var(--green)', 'Cash balances exactly']
      : diff > 0 ? ['var(--amber-light)', 'var(--amber)', `Over by ${money(diff)}`] : ['var(--red-light)', 'var(--red)', `Short by ${money(-diff)}`]
    el.style.cssText = `padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;margin-bottom:12px;background:${bg};color:${fg};`
    el.textContent = txt
  }

  window.confirmCloseShift = async () => {
    const counted = parseFloat($('sc-counted').value)
    if (!Number.isFinite(counted) || counted < 0) { showToast('Enter the cash you counted', 'error'); return }
    const btn = $('sc-btn'); btn.disabled = true
    try {
      const s = await apiFetch(`/${CID}/shifts/${SHIFT.id}/close`, { method: 'POST', body: JSON.stringify({ counted_cash: counted, notes: $('sc-notes').value.trim() }) })
      closeModal('shift-close-modal')
      const d = parseFloat(s.difference)
      showToast(d === 0 ? 'Shift closed — cash balances' : `Shift closed — ${d > 0 ? 'over' : 'short'} by ${money(Math.abs(d))}`)
      loadShiftTab()
    } catch (e) { showToast(errMsg(e), 'error') } finally { btn.disabled = false }
  }

  window.loadShiftHistory = async function () {
    ensureDates('csh')
    const uid = isMgr() ? '' : `&user_id=${_SESSION.uid}`
    const tb = $('csh-tbody'); tb.innerHTML = empty(8, 'Loading…')
    try {
      const rows = await apiFetch(`/${CID}/shifts?from=${$('csh-from').value}&to=${$('csh-to').value}${uid}`)
      tb.innerHTML = rows.length ? rows.map(s => {
        const open = s.status === 'open', d = parseFloat(s.difference)
        const diff = open ? '<span class="badge b-green">Open</span>' : `<span class="${d === 0 ? 'ops-pos' : d < 0 ? 'ops-neg' : ''}" style="${d > 0 ? 'color:var(--amber);font-weight:700;' : ''}">${d > 0 ? '+' : ''}${fmt(d)}</span>`
        return `<tr><td><strong>${esc(s.user_name || '—')}</strong>${s.notes ? `<div style="font-size:10.5px;color:var(--fg3);">${esc(s.notes)}</div>` : ''}</td>
          <td style="font-size:12px;">${dt(s.opened_at)}</td><td style="font-size:12px;">${open ? '—' : dt(s.closed_at)}</td>
          <td class="ops-num">${fmt(s.opening_cash)}</td><td class="ops-num">${fmt(s.cash_sales)}</td>
          <td class="ops-num">${fmt(s.expected_cash)}</td><td class="ops-num">${open ? '—' : fmt(s.counted_cash)}</td><td class="ops-num">${diff}</td></tr>`
      }).join('') : empty(8, 'No shifts in this period')
    } catch (e) { tb.innerHTML = empty(8, 'Could not load shifts') }
  }

  window.loadStaffReport = async function () {
    ensureDates('css')
    const tb = $('css-tbody'); tb.innerHTML = empty(8, 'Loading…')
    try {
      const r = await apiFetch(`/${CID}/reports/staff?from=${$('css-from').value}&to=${$('css-to').value}`)
      $('css-kpis').innerHTML = kpi('Sales (ex VAT)', money(r.totals.sales)) + kpi('Service income', money(r.totals.service_income), 'k-green') +
        kpi('Commission due', money(r.totals.commission), 'k-accent') + kpi('Cash difference', (r.totals.cash_difference > 0 ? '+' : '') + fmt(r.totals.cash_difference), '', r.totals.cash_difference < 0 ? '#E11D48' : '#16A34A')
      tb.innerHTML = r.staff.length ? r.staff.map(s => {
        const d = s.cash_difference
        return `<tr><td><strong${s.user_id ? '' : ' style="font-style:italic;color:var(--fg3);"'}>${esc(s.name)}</strong>${s.shifts ? `<div style="font-size:10.5px;color:var(--fg3);">${s.shifts} shift${s.shifts === 1 ? '' : 's'} closed</div>` : ''}</td>
          <td class="ops-num">${s.invoices}</td><td class="ops-num">${fmt(s.sales)}</td><td class="ops-num">${fmt(s.gov)}</td><td class="ops-num">${fmt(s.service_income)}</td>
          <td class="ops-num">${s.commission_rate}%</td><td class="ops-num"><b>${fmt(s.commission)}</b></td>
          <td class="ops-num"><span class="${d < 0 ? 'ops-neg' : d > 0 ? '' : ''}" style="${d > 0 ? 'color:var(--amber);font-weight:700;' : ''}">${s.shifts ? (d > 0 ? '+' : '') + fmt(d) : '—'}</span></td></tr>`
      }).join('') : empty(8, 'No sales in this period')
    } catch (e) { tb.innerHTML = empty(8, 'Could not load the staff report') }
  }

  // ═════════════ PROFIT ═════════════
  const periodLabel = (p, group) => group === 'month' ? new Date(p + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : group === 'week' ? 'Week of ' + dOnly(p) : dOnly(p)
  const signed = n => `<span class="${n < 0 ? 'ops-neg' : ''}">${fmt(n)}</span>`

  window.loadProfitPage = () => { ensureDates('pf'); loadProfit(); loadPending() }

  window.loadProfit = async function () {
    ensureDates('pf')
    const group = $('pf-group').value
    try {
      const r = await apiFetch(`/${CID}/reports/profit?from=${$('pf-from').value}&to=${$('pf-to').value}&group=${group}`)
      const t = r.totals
      $('pf-kpis').innerHTML = kpi('Sales (ex VAT)', money(t.sales)) + kpi('Govt fees collected', money(t.gov_collected), 'k-amber') +
        kpi('Service income', money(t.service_income), 'k-green') + kpi('Running expenses', money(t.operating_expenses), '', '#E11D48') +
        kpi('Net profit', money(t.net_profit), 'k-accent', t.net_profit < 0 ? '#E11D48' : '#16A34A') +
        kpi('Govt fees paid out', money(t.gov_paid)) + kpi('Govt fees held', money(t.gov_balance), '', t.gov_balance < 0 ? '#E11D48' : '#D97706')
      $('pf-period').innerHTML = r.by_period.length ? r.by_period.map(p => `<tr><td><strong>${periodLabel(p.period, group)}</strong><div style="font-size:10.5px;color:var(--fg3);">${p.invoices} invoice${p.invoices === 1 ? '' : 's'}</div></td>
        <td class="ops-num">${fmt(p.sales)}</td><td class="ops-num">${fmt(p.gov)}</td><td class="ops-num">${fmt(p.income)}</td><td class="ops-num">${fmt(p.opex)}</td><td class="ops-num"><b>${signed(p.net_profit)}</b></td></tr>`).join('')
        : empty(6, 'No sales in this period')
      $('pf-service').innerHTML = r.by_service.length ? r.by_service.map(s => `<tr><td><strong>${esc(s.service)}</strong></td><td class="ops-num">${s.qty}</td>
        <td class="ops-num">${fmt(s.sales)}</td><td class="ops-num">${fmt(s.gov)}</td><td class="ops-num"><b>${fmt(s.income)}</b></td></tr>`).join('')
        : empty(5, 'No sales in this period')
    } catch (e) { $('pf-period').innerHTML = empty(6, 'Could not load profit'); $('pf-service').innerHTML = empty(5, '') }
  }

  async function loadPending() {
    try {
      const r = await apiFetch(`/${CID}/reports/pending`)
      $('pf-pending-total').textContent = r.total > 0 ? money(r.total) + ' owed' : ''
      $('pf-ageing').innerHTML = kpi('0 – 30 days', money(r.ageing.d0_30), 'k-green') + kpi('31 – 60 days', money(r.ageing.d31_60), 'k-amber') + kpi('Over 60 days', money(r.ageing.d61_plus), '', '#E11D48') +
        (r.unallocated_receipts > 0 ? kpi('Receipts not matched to a customer', money(r.unallocated_receipts)) : '')
      $('pf-pending').innerHTML = r.customers.length ? r.customers.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td class="ops-num">${c.invoices}</td>
        <td class="ops-num">${fmt(c.billed)}</td><td class="ops-num">${fmt(c.paid)}</td><td class="ops-num"><b class="ops-neg">${fmt(c.balance)}</b></td>
        <td>${dOnly(c.oldest)}</td><td><span class="badge ${c.age_days > 60 ? 'b-red' : c.age_days > 30 ? 'b-amber' : 'b-green'}">${c.age_days} days</span></td></tr>`).join('')
        : empty(7, 'Nobody owes you anything right now')
    } catch (e) { $('pf-pending').innerHTML = empty(7, 'Could not load what customers owe') }
  }

  // ═════════════ SERVICE CATALOGUE ═════════════
  let CAT = []

  window.openCatalogue = async () => {
    $('cat-body').innerHTML = '<div style="padding:30px;text-align:center;color:var(--fg3);">Loading…</div>'; openModal('catalogue-modal')
    try { CAT = await apiFetch(`/${CID}/catalogue`) } catch (e) { $('cat-body').innerHTML = '<div class="ops-note warn">Could not load the catalogue.</div>'; return }
    const groups = [...new Set(CAT.map(c => c.group))]
    $('cat-body').innerHTML = groups.map(g => `<div class="cat-group"><h4>${esc(g)} <button class="btn btn-ghost btn-xs" onclick="catToggleGroup('${esc(g).replace(/'/g, '&#39;')}')">select all</button></h4>
      ${CAT.map((c, i) => c.group !== g ? '' : `<div class="cat-row${c.exists ? ' have' : ''}">
        <input type="checkbox" data-i="${i}" ${c.exists ? 'disabled' : ''} onchange="catCount()">
        <span>${esc(c.name)}${c.exists ? ' <span class="badge b-gray" style="margin-left:6px;">already added</span>' : ''}</span>
        <input type="number" id="cat-p-${i}" value="${c.price}" min="0" step="0.01" ${c.exists ? 'disabled' : ''} title="Total price (AED)" aria-label="Total price">
        <input type="number" id="cat-g-${i}" value="${c.gov_fee}" min="0" step="0.01" ${c.exists ? 'disabled' : ''} title="Government fee included (AED)" aria-label="Government fee"></div>`).join('')}</div>`).join('')
    $('cat-body').insertAdjacentHTML('afterbegin', '<div class="cat-row" style="font-size:11px;font-weight:700;color:var(--fg3);border-bottom:2px solid var(--border);"><span></span><span>SERVICE</span><span style="text-align:right;">TOTAL PRICE</span><span style="text-align:right;">GOVT FEE</span></div>')
    catCount()
  }

  window.catToggleGroup = g => {
    const boxes = CAT.map((c, i) => c.group === g && !c.exists ? document.querySelector(`#cat-body input[data-i="${i}"]`) : null).filter(Boolean)
    const on = boxes.some(b => !b.checked); boxes.forEach(b => { b.checked = on }); catCount()
  }
  window.catCount = () => {
    const n = document.querySelectorAll('#cat-body input[type=checkbox]:checked').length
    $('cat-count').textContent = n ? `${n} selected` : 'Nothing selected'
    $('cat-import-btn').disabled = !n
  }

  window.importCatalogue = async () => {
    const items = []
    for (const b of document.querySelectorAll('#cat-body input[type=checkbox]:checked')) {
      const i = +b.dataset.i, c = CAT[i], price = parseFloat($('cat-p-' + i).value) || 0, gov = parseFloat($('cat-g-' + i).value) || 0
      if (gov > price) { showToast(`Government fee is more than the price for “${c.name}”`, 'error'); return }
      items.push({ name: c.name, category: c.category, icon: c.icon, price, gov_fee: gov })
    }
    const btn = $('cat-import-btn'); btn.disabled = true
    try {
      const r = await apiFetch(`/${CID}/catalogue/import`, { method: 'POST', body: JSON.stringify({ items }) })
      closeModal('catalogue-modal')
      showToast(`${r.imported} service${r.imported === 1 ? '' : 's'} added`)
      _svcAll = []; loadServicesPage(); loadSettingsServices(); refreshPOSServices()
    } catch (e) { showToast(errMsg(e), 'error') } finally { btn.disabled = false }
  }

  // ═════════════ NOTIFICATIONS (bell) — everything that needs a message to a customer, with direct WhatsApp ═════════════
  const waDigits = raw => {            // UAE numbers → international digits for wa.me
    let d = String(raw || '').replace(/\D/g, '')
    if (!d) return null
    if (d.startsWith('00')) d = d.slice(2)
    if (d.startsWith('971')) return d.length >= 11 ? d : null
    if (d.startsWith('0')) d = '971' + d.slice(1); else if (d.length === 9) d = '971' + d
    return d.length >= 10 ? d : null
  }
  // ── "No mobile saved? ask for it": resolves to WhatsApp-ready digits, or null if the user cancels ──
  let MOBILE_ASK = null
  window.ensureMobile = ({ customerId, name, current }) => new Promise(resolve => {
    const have = waDigits(current)
    if (have) return resolve(have)
    MOBILE_ASK = { resolve, customerId: customerId || null }
    $('mb-name').textContent = name || 'this customer'
    $('mb-input').value = ''; $('mb-err').textContent = ''
    $('mb-save').checked = true; $('mb-save-row').style.display = customerId ? 'flex' : 'none'
    openModal('mobile-modal'); setTimeout(() => $('mb-input').focus(), 50)
  })
  window.cancelMobile = () => {
    closeModal('mobile-modal')
    if (MOBILE_ASK) { const r = MOBILE_ASK.resolve; MOBILE_ASK = null; r(null) }
  }
  window.confirmMobile = async () => {
    if (!MOBILE_ASK) return
    const raw = $('mb-input').value.trim(), digits = waDigits(raw)
    if (!digits) { $('mb-err').textContent = 'Enter a valid mobile number, e.g. 050 123 4567'; $('mb-input').focus(); return }
    const { resolve, customerId } = MOBILE_ASK
    if (customerId && $('mb-save').checked) {
      try {
        await apiFetch(`/${CID}/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify({ phone: raw }) })
        const c = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).find(x => x.id == customerId)
        if (c) { c.phone = raw; renderCustomersPage(CUSTOMERS); renderCustDropdown(CUSTOMERS) }
        showToast('Mobile number saved')
      } catch (e) { showToast('Could not save the number to the customer, but WhatsApp will still open', 'error') }
    }
    MOBILE_ASK = null; closeModal('mobile-modal'); resolve(digits)
  }

  const SENT_KEY = 'tp_notif_sent', WEEK = 7 * 864e5
  const sentStore = () => { try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}') } catch (_) { return {} } }
  const markSent = key => { try { const s = sentStore(); s[key] = Date.now(); localStorage.setItem(SENT_KEY, JSON.stringify(s)) } catch (_) {} }
  const isSent = n => { const t = sentStore()[n.key]; return !!(t && (n.ttl === 0 || Date.now() - t < n.ttl)) || !!n.serverSent }
  const NT_TYPES = {
    renewal:  { tone: '#E11D48', svg: '<path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="3"/>' },
    payment:  { tone: '#D97706', svg: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>' },
    app_done: { tone: '#16A34A', svg: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
    app_docs: { tone: '#2563EB', svg: '<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="12" y1="13" x2="12" y2="18"/><line x1="12" y1="18" x2="10" y2="16"/><line x1="12" y1="18" x2="14" y2="16"/>' },
  }
  let NOTES = [], NT_FILTER = 'all'
  const co = () => (typeof COMPANY !== 'undefined' && COMPANY.name) || 'our office'

  async function gatherNotifications() {
    const safe = (p, d) => p.catch(() => d)
    const [rn, pend, apps] = await Promise.all([
      safe(apiFetch(`/${CID}/renewals?days=30`), []), safe(apiFetch(`/${CID}/reports/pending`), { customers: [] }), safe(apiFetch(`/${CID}/applications`), [])])
    const out = []
    rn.forEach(r => out.push({
      type: 'renewal', key: `r:${r.id}:${r.expires_at}`, ttl: WEEK, urgency: r.days_left < 0 ? 0 : r.days_left <= 7 ? 1 : 3,
      title: r.customer_name || 'Customer', detail: `${r.name} — ${r.days_left < 0 ? `expired ${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago` : r.days_left === 0 ? 'expires today' : `expires in ${r.days_left} day${r.days_left === 1 ? '' : 's'}`}`,
      meta: `Expiry ${dOnly(r.expires_at)}`, phone: r.wa_phone, rawPhone: r.phone, message: r.message, docId: r.id, customerId: r.customer_id,
      serverSent: !!(r.last_reminded_at && Date.now() - new Date(r.last_reminded_at).getTime() < WEEK) }))
    ;(pend.customers || []).forEach(c => out.push({
      type: 'payment', key: `p:${c.customer_id || c.name}`, ttl: WEEK, urgency: c.age_days > 60 ? 1 : 2,
      title: c.name, detail: `Owes ${money(c.balance)} — oldest invoice ${dOnly(c.oldest)} (${c.age_days} days)`, meta: `${c.invoices} unpaid invoice${c.invoices === 1 ? '' : 's'}`,
      phone: c.wa_phone, rawPhone: c.phone, customerId: c.customer_id || null,
      message: `Hello ${c.name}, this is ${co()}. A balance of ${money(c.balance)} is pending on your account (oldest invoice dated ${dOnly(c.oldest)}). Please settle it at your earliest convenience. Thank you.` }))
    const cutoff = Date.now() - 14 * 864e5
    ;(apps || []).forEach(a => {
      const cust = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).find(x => x.id === a.customer_id)
      const name = a.customer_name || a.customer_full_name || (cust && cust.name) || 'Customer'
      const phone = cust ? waDigits(cust.phone) : null
      if (a.status === 'completed' && new Date(a.updated_at || a.completed_at || 0).getTime() >= cutoff) out.push({
        type: 'app_done', key: `a:${a.id}:completed`, ttl: 0, urgency: 4, title: name, detail: `${a.service_type} is completed — ready for collection`,
        meta: `Ref ${a.app_number || a.id}`, phone, rawPhone: cust && cust.phone, customerId: a.customer_id || null,
        message: `Hello ${name}, good news from ${co()}: your ${a.service_type} (ref ${a.app_number || a.id}) is completed. Please visit us to collect it. Thank you.` })
      if (a.status === 'doc_pending') out.push({
        type: 'app_docs', key: `a:${a.id}:doc_pending`, ttl: 0, urgency: 5, title: name, detail: `${a.service_type} is waiting for documents`,
        meta: `Ref ${a.app_number || a.id}`, phone, rawPhone: cust && cust.phone, customerId: a.customer_id || null,
        message: `Hello ${name}, this is ${co()}. To continue your ${a.service_type} (ref ${a.app_number || a.id}) we still need some documents from you. Please send or bring them at your earliest convenience. Thank you.` })
    })
    return out.sort((a, b) => a.urgency - b.urgency || a.title.localeCompare(b.title))
  }

  function updateNtBadge() {
    const n = NOTES.filter(x => !isSent(x)).length, el = $('nt-dot')
    if (el) { el.textContent = n > 99 ? '99+' : n; el.style.display = n ? '' : 'none' }
  }

  window.setNtFilter = (f, btn) => {
    NT_FILTER = f
    document.querySelectorAll('#nt-chips .ops-chip').forEach(b => b.classList.toggle('active', b === btn))
    renderNotifications()
  }

  window.loadNotifications = async function () {
    $('nt-list').innerHTML = '<div style="padding:30px;text-align:center;color:var(--fg3);">Loading…</div>'
    try { NOTES = await gatherNotifications() } catch (e) { $('nt-list').innerHTML = '<div class="ops-note warn">Could not load notifications.</div>'; return }
    renderNotifications()
  }

  window.renderNotifications = function () {
    updateNtBadge()
    const pending = NOTES.filter(n => !isSent(n))
    const cnt = t => pending.filter(n => (t === 'app' ? n.type.startsWith('app') : n.type === t)).length
    $('nt-kpis').innerHTML = kpi('To send', pending.length, 'k-accent') + kpi('Renewals', cnt('renewal'), '', '#E11D48') + kpi('Payments due', cnt('payment'), 'k-amber') + kpi('Applications', cnt('app'), 'k-green')
    const showSent = $('nt-showsent').checked
    const rows = NOTES.map((n, i) => ({ n, i })).filter(({ n }) =>
      (NT_FILTER === 'all' || (NT_FILTER === 'app' ? n.type.startsWith('app') : n.type === NT_FILTER)) && (showSent || !isSent(n)))
    $('nt-list').innerHTML = rows.length ? rows.map(({ n, i }) => {
      const t = NT_TYPES[n.type], sent = isSent(n), hot = n.urgency <= 1
      return `<div class="nt-item${sent ? ' sent' : ''}">
        <div class="nt-ico" style="--t:${t.tone};"><svg width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${t.svg}</svg></div>
        <div class="nt-body"><div class="nt-title">${esc(n.title)}</div><div class="nt-detail">${esc(n.detail)}</div>
          <div class="nt-meta"><span>${esc(n.meta)}</span>${n.rawPhone ? `<span>· ${esc(n.rawPhone)}</span>` : '<span style="color:var(--amber);">· no mobile saved — you will be asked for it</span>'}${hot && !sent ? '<span class="badge b-red">Urgent</span>' : ''}${sent ? '<span class="badge b-green">Sent</span>' : ''}</div></div>
        <div class="nt-actions">
          <button class="btn btn-wa btn-xs" onclick="ntSend(${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9s-.5-.1-.7.1-.8.9-1 1.1-.4.2-.6.1c-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.1c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 1.8.8 2.5.8 3.4.7.6-.1 1.7-.7 2-1.4s.2-1.3.2-1.4c-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2z"/></svg>WhatsApp</button>
          <button class="btn btn-secondary btn-xs" onclick="ntCopy(${i})">Copy</button>
        </div></div>`
    }).join('') : `<div class="ops-note ok" style="text-align:center;padding:28px;">${NOTES.length ? 'All caught up — nothing left to send.' : 'Nothing needs a message right now.'}</div>`
  }

  window.ntSend = async i => {
    const n = NOTES[i]; if (!n) return
    // no mobile saved: ask for it (and offer to save it to the customer) before opening the chat
    if (!n.phone) {
      n.phone = await ensureMobile({ customerId: n.customerId, name: n.title, current: n.rawPhone })
      if (!n.phone) return
      n.rawPhone = n.phone
    }
    window.open(`https://wa.me/${n.phone}?text=${encodeURIComponent(n.message)}`, '_blank', 'noopener')
    markSent(n.key); renderNotifications()
    if (n.type === 'renewal' && n.phone) {
      apiFetch(`/${CID}/renewals/${n.docId}/reminded`, { method: 'POST', body: JSON.stringify({ user_id: _SESSION.uid, message: n.message, phone: n.phone }) }).catch(() => {})
    }
  }
  window.ntCopy = async i => {
    const n = NOTES[i]; if (!n) return
    try { await navigator.clipboard.writeText(n.message); showToast('Message copied') } catch (_) { showToast(n.message) }
  }

  // ═════════════ SEND QUOTATION (WhatsApp + PDF, e-mail + PDF) ═════════════
  let MAIL = { smtp_enabled: false }
  const curQt = () => document.getElementById('page-qt-view')._qtData
  const qtPdfUrl = (id, dl) => `/api/${CID}/quotations/${id}/pdf${dl ? '?download=1' : ''}`
  const qtFileName = q => `Quotation-${q.quote_number}.pdf`
  const saveBlobAs = (blob, name) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  const fetchQtPdf = async q => {
    const r = await fetch(qtPdfUrl(q.id)); if (!r.ok) throw new Error('Could not create the PDF')
    return r.blob()
  }
  // record the send (audit trail) and let the server flip a draft to "sent"
  const markQtSent = async (q, channel) => {
    try {
      await apiFetch(`/${CID}/quotations/${q.id}/sent`, { method: 'POST', body: JSON.stringify({ channel, user_id: _SESSION.uid }) })
      await loadQuotations(); viewQuotation(q.id)
    } catch (_) {}
  }

  window.openSendQt = async () => {
    const q = curQt(); if (!q) return
    $('sq-title').textContent = 'Send ' + q.quote_number
    $('sq-summary').innerHTML = `<b>${esc(q.lead_name || 'Customer')}</b> · ${money(q.total)} · valid until ${dOnly(q.valid_until)}`
    $('sq-phone').value = q.lead_phone || ''
    $('sq-email').value = q.lead_email || ''
    $('sq-msg').value = `Hello ${q.lead_name || ''}, please find our quotation ${q.quote_number} for ${money(q.total)} (incl. VAT). It is valid until ${dOnly(q.valid_until)}. To accept, just reply to this message.\n\n${co()}`
    $('sq-hint').className = 'ops-note'; $('sq-hint').textContent = 'Checking…'
    openModal('send-qt-modal')
    try { MAIL = await apiFetch(`/${CID}/mail/status`) } catch (_) { MAIL = { smtp_enabled: false } }
    $('sq-hint').className = 'ops-note ' + (MAIL.smtp_enabled ? 'ok' : 'warn')
    $('sq-hint').innerHTML = MAIL.smtp_enabled
      ? '<b>E-mail is connected.</b> “E-mail + PDF” sends the quotation straight from the system with the PDF attached. “WhatsApp + PDF” opens your phone’s share sheet with the PDF attached (on a computer without file sharing, the PDF downloads and WhatsApp opens so you can attach it).'
      : '<b>E-mail sending is not set up on the server yet.</b> “E-mail + PDF” will download the PDF and open your mail app with the message ready — attach the PDF and send. To send directly from the system, set <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> for the server.'
  }

  // the customer record behind a quotation's lead (matched by name), so a number typed in can be saved to it
  const qtCustomerId = q => { const n = String(q.lead_name || '').trim().toLowerCase(); const c = n && (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).find(x => String(x.name).trim().toLowerCase() === n); return c ? c.id : null }
  const qtPhone = async q => {
    const phone = await ensureMobile({ customerId: qtCustomerId(q), name: q.lead_name, current: $('sq-phone').value })
    if (phone) $('sq-phone').value = phone
    return phone
  }

  window.sendQtWhatsAppText = async () => {
    const q = curQt(); if (!q) return
    const phone = await qtPhone(q); if (!phone) return          // no mobile: ask for it
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent($('sq-msg').value)}`, '_blank', 'noopener')
    markQtSent(q, 'whatsapp'); closeModal('send-qt-modal')
  }

  window.sendQtWhatsAppPdf = async () => {
    const q = curQt(); if (!q) return
    const text = $('sq-msg').value
    let blob
    try { blob = await fetchQtPdf(q) } catch (e) { showToast(errMsg(e), 'error'); return }
    const file = new File([blob], qtFileName(q), { type: 'application/pdf' })
    // phones (and some desktops): the share sheet attaches the PDF itself and lists WhatsApp
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: q.quote_number, text })
        markQtSent(q, 'whatsapp_pdf'); closeModal('send-qt-modal'); return
      } catch (e) { if (e && e.name === 'AbortError') return }          // user closed the share sheet: nothing was sent
    }
    // fallback: WhatsApp cannot take a file from a link, so download it and open the customer's chat for the user to attach it
    const phone = await qtPhone(q); if (!phone) return          // no mobile: ask for it
    saveBlobAs(blob, qtFileName(q))
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    showToast('PDF downloaded — attach it in the WhatsApp chat (📎 → Document)')
    markQtSent(q, 'whatsapp_pdf'); closeModal('send-qt-modal')
  }

  window.sendQtEmail = async () => {
    const q = curQt(); if (!q) return
    const to = $('sq-email').value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { showToast('Enter a valid e-mail address', 'error'); $('sq-email').focus(); return }
    const btn = $('sq-email-btn'); btn.disabled = true
    try {
      if (MAIL.smtp_enabled) {
        await apiFetch(`/${CID}/quotations/${q.id}/email`, { method: 'POST', body: JSON.stringify({ to, message: $('sq-msg').value, user_id: _SESSION.uid }) })
        if (to !== (q.lead_email || '')) apiFetch(`/${CID}/quotations/${q.id}`, { method: 'PATCH', body: JSON.stringify({ lead_email: to }) }).catch(() => {})
        showToast('E-mail sent to ' + to)
        await loadQuotations(); viewQuotation(q.id)
      } else {
        saveBlobAs(await fetchQtPdf(q), qtFileName(q))
        const a = document.createElement('a')
        a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Quotation ' + q.quote_number)}&body=${encodeURIComponent($('sq-msg').value)}`
        a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove()
        showToast('PDF downloaded — attach it to the e-mail and send')
        markQtSent(q, 'email_client')
      }
      closeModal('send-qt-modal')
    } catch (e) { showToast(errMsg(e), 'error') } finally { btn.disabled = false }
  }

  window.downloadQtPdf = () => {
    const q = curQt(); if (!q) return
    const a = document.createElement('a'); a.href = qtPdfUrl(q.id, true); a.download = qtFileName(q)
    document.body.appendChild(a); a.click(); a.remove()
  }

  // ═════════════ CUSTOMER PICTURE ═════════════
  // NC_PHOTO: undefined = unchanged, null = remove it, string = a new picture (data URL)
  let NC_PHOTO, NC_CUST = null
  const initialsOf = n => String(n || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()

  function paintCustPhoto() {
    const c = NC_CUST, el = $('nc-photo-prev')
    const showing = NC_PHOTO ? NC_PHOTO : (NC_PHOTO === undefined && c && c.has_photo ? custPhotoUrl(c) : '')
    el.innerHTML = showing ? `<img src="${showing}" alt="">` : esc(initialsOf(c && c.name) || '👤')
    $('nc-photo-remove').style.display = showing ? '' : 'none'
  }

  // centre-crop to a square and shrink to 320 px JPEG (~15–30 KB), however big the original is
  async function squarePhoto(file, size = 320) {
    let img
    try { img = await createImageBitmap(file) } catch (_) {
      img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file) })
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, s = Math.min(w, h)
    const cv = document.createElement('canvas'); cv.width = cv.height = size
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size)
    g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size)
    return cv.toDataURL('image/jpeg', 0.85)
  }

  window.initCustPhoto = c => {
    NC_PHOTO = undefined; NC_CUST = c || null
    ;['nc-photo-file', 'nc-photo-cam'].forEach(id => { $(id).value = '' })
    paintCustPhoto()
  }
  window.pickCustPhoto = async input => {
    const file = input.files && input.files[0]; if (!file) return
    try { NC_PHOTO = await squarePhoto(file); paintCustPhoto() } catch (_) { showToast('Could not read that picture', 'error') }
    input.value = ''
  }
  window.removeCustPhoto = () => { NC_PHOTO = null; paintCustPhoto() }

  // called after the customer itself is saved
  window.applyCustPhoto = async id => {
    if (NC_PHOTO === undefined) return
    try {
      const row = NC_PHOTO
        ? await apiFetch(`/${CID}/customers/${id}/photo`, { method: 'PUT', body: JSON.stringify({ photo: NC_PHOTO }) })
        : await apiFetch(`/${CID}/customers/${id}/photo`, { method: 'DELETE' })
      const i = CUSTOMERS.findIndex(x => x.id === id)
      if (i >= 0) CUSTOMERS[i] = { ...CUSTOMERS[i], has_photo: row.has_photo, photo_version: row.photo_version }
    } catch (e) { showToast('Customer saved, but the picture could not be saved: ' + errMsg(e), 'error') }
    NC_PHOTO = undefined
  }

  // sidebar + bell badges
  const refreshBadges = () => {
    fetchRenewals().catch(() => {})
    // don't swap the list under the user's cursor while they are on the Notifications page
    if ($('page-notifications').classList.contains('active')) return
    gatherNotifications().then(l => { NOTES = l; updateNtBadge() }).catch(() => {})
  }
  setTimeout(refreshBadges, 1800)
  setInterval(refreshBadges, 5 * 60 * 1000)
})()
