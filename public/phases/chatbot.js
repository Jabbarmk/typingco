// In-app assistant: a floating chat window. chat-nlp.js works out what was asked; this file answers it from the live data,
// explains how to do things, and takes people to the right screen. Everything runs in the browser against the existing API.
(function () {
  'use strict'
  const NLP = window.ChatNLP, D = window.CHAT_DATA
  const $ = id => document.getElementById(id)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const money = n => 'AED ' + fmt(n)
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')
  const dShow = v => v ? new Date(String(v).length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`
  const todayISO = () => localISO()
  const errReply = () => ({ html: md("Sorry, I couldn't load that just now. Check the **Connected** light at the top and try again in a moment.") })

  // ───────── dates ─────────
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7))
  const periodFor = key => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth()
    if (key === 'today') return { from: localISO(now), to: localISO(now), label: 'today' }
    if (key === 'week') return { from: localISO(mondayOf(now)), to: localISO(now), label: 'this week' }
    return { from: localISO(new Date(y, m, 1)), to: localISO(now), label: 'this month' }
  }
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5)
  const inRange = (iso, p) => iso && iso.slice(0, 10) >= p.from && iso.slice(0, 10) <= p.to

  // ───────── building blocks for replies ─────────
  const table = (head, rows, aligns) => `<table class="cb-t"><thead><tr>${head.map((h, i) => `<th${aligns && aligns[i] === 'r' ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${aligns && aligns[i] === 'r' ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  const big = (value, label) => `<div class="cb-big"><b>${value}</b><span>${esc(label)}</span></div>`
  const kv = pairs => `<div class="cb-kv">${pairs.filter(p => p && p[1] !== undefined && p[1] !== '').map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`
  const goPage = (page, label) => ({ page, label: label || 'Open ' + (D.PAGE_LABEL[page] || page), run: () => go(page) })
  const pageBtn = page => document.querySelector(`.nav-item[onclick*="'${page}'"]`)
  const isPhone = () => window.innerWidth < 768
  const stepAside = () => { if (isPhone() && $('cb-panel')) $('cb-panel').classList.remove('open') }
  function go(page) { stepAside(); nav(page, pageBtn(page)) }

  // ───────── conversation state ─────────
  const S = { last: null, pending: null, confirm: null, busy: false }

  function nlpContext() {
    return {
      customers: (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).map(c => ({ id: c.id, name: c.name })),
      services: (typeof SERVICES !== 'undefined' ? SERVICES : []).map(s => ({ id: s.id, name: s.name })),
      staff: (typeof EMPLOYEES !== 'undefined' ? EMPLOYEES : []).map(u => ({ id: u.id, name: u.name })),
    }
  }
  const findCustomer = id => (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).find(c => c.id === id)
  const findService = id => (typeof SERVICES !== 'undefined' ? SERVICES : []).find(s => s.id === id)
  // entities carry lightweight {id,name} items; map back to the full records
  const custOf = e => (e.customers || []).map(c => findCustomer(c.id) || c)
  const svcOf = e => (e.services || []).map(s => findService(s.id) || s)

  // ───────── data helpers ─────────
  const getInvoices = async (p, e) => {
    let inv = (await apiFetch(`/${CID}/invoices?from=${p.from}&to=${p.to}&limit=20000`)).filter(i => i.status === 'posted')
    const staff = (e && e.staff && e.staff[0]) || null
    if (e && e.mine) inv = inv.filter(i => i.created_by === _SESSION.uid)
    else if (staff) inv = inv.filter(i => i.created_by === staff.id)
    const cs = e && custOf(e)
    if (cs && cs.length === 1 && e._forCustomer) inv = inv.filter(i => i.customer_id === cs[0].id || (i.customer_name || '').toLowerCase() === cs[0].name.toLowerCase())
    return inv
  }
  const sum = (arr, f) => arr.reduce((a, x) => a + (parseFloat(f(x)) || 0), 0)
  const scopeNote = e => e.mine ? ' (your sales)' : (e.staff && e.staff[0] ? ` (${esc(e.staff[0].name)})` : '')
  const METHOD = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', customer_credit: 'On credit' }

  // ───────── the answers ─────────
  const H = {}

  H.greet = async () => {
    const h = new Date().getHours(), g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    return { html: md(`${g}, ${_SESSION.name.split(' ')[0]}! 👋 What would you like to know or do?`), chips: D.SUGGESTIONS.slice(0, 5) }
  }
  H.thanks = async () => ({ html: md(['You’re welcome! 😊', 'Happy to help!', 'Anytime!'][Math.floor(Math.random() * 3)] + ' Anything else?') })
  H.bye = async () => ({ html: md('Goodbye! I’m here whenever you need me. 👋') })
  H.compliment = async () => ({ html: md('Thank you! 😊 Ask me anything about your sales, customers, renewals or how to use the system.') })
  H.who_are_you = async () => ({ html: md(`I’m the **${esc(COMPANY.name || 'Typingo')} assistant**. I answer questions from your live data (sales, profit, who owes you, expiring documents…), explain how to do things, and open the right screen for you.`), chips: ['What can you do?', 'Give me a summary'] })
  H.help = async () => ({
    html: md('Here is what I can do. Just ask in your own words:') + `<ul class="cb-ul">
      <li><b>Money</b> — sales, profit, expenses, VAT, government fees, who owes you</li>
      <li><b>Customers</b> — find a customer, phone numbers, balances</li>
      <li><b>Renewals</b> — expiring visas, Emirates IDs, licences; send reminders</li>
      <li><b>Work</b> — applications, quotations, shifts and commission</li>
      <li><b>Prices</b> — “price of visa renewal”, list of services</li>
      <li><b>Do things</b> — “new sale”, “add expense”, “open reports”</li>
      <li><b>How do I…?</b> — step-by-step help for most screens</li></ul>`,
    chips: D.SUGGESTIONS,
  })
  H.affirm = async () => {
    if (S.confirm) { const c = S.confirm; S.confirm = null; return run(c.intent, c.entities) }
    return { html: md('👍 What would you like next?'), chips: D.SUGGESTIONS.slice(0, 4) }
  }
  H.deny = async () => { S.pending = null; S.confirm = null; return { html: md('No problem. Ask me anything else, or try one of these:'), chips: D.SUGGESTIONS.slice(0, 4) } }
  H.trouble = async () => ({
    html: md('Sorry about that. Let’s check the basics:\n1. Look at the **Connected** light at the top: if it isn’t green the server isn’t reachable.\n2. **Refresh** the page (Ctrl+R) and try again.\n3. If a message appeared when saving, it usually says what is missing (for example a required field).\n4. Still stuck? Tell your administrator what you clicked and what you saw.'),
  })

  H.sales_summary = async e => {
    const p = e.period || periodFor('today')
    const inv = await getInvoices(p, e)
    if (!inv.length) return { html: md(`No sales ${p.label}${scopeNote(e)} yet.`), actions: [{ label: 'New sale', run: () => go('pos') }] }
    const by = {}; inv.forEach(i => { by[i.payment_method] = (by[i.payment_method] || 0) + (parseFloat(i.total) || 0) })
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([m, v]) => [METHOD[m] || m, money(v)])
    return {
      html: big(money(sum(inv, i => i.total)), `Sales ${p.label}${e.mine ? ' (yours)' : ''}`) + kv([['Invoices', inv.length], ['Net of VAT', money(sum(inv, i => i.subtotal))], ['VAT', money(sum(inv, i => i.vat_amount))]]) + table(['Paid by', 'Amount'], rows, ['', 'r']),
      actions: [goPage('sales')], chips: ['Top services ' + p.label, 'Who owes us money?'],
    }
  }
  H.sales_by_method = async e => {
    const p = e.period || periodFor('today')
    const inv = await getInvoices(p, e)
    const by = {}; inv.forEach(i => { const k = i.payment_method; by[k] = by[k] || { n: 0, v: 0 }; by[k].n++; by[k].v += parseFloat(i.total) || 0 })
    if (e.method) {
      const b = by[e.method] || { n: 0, v: 0 }
      return { html: big(money(b.v), `${METHOD[e.method]} ${p.label}`) + kv([['Invoices', b.n]]), actions: [goPage('sales')] }
    }
    const tot = sum(inv, i => i.total) || 1
    return { html: big(money(sum(inv, i => i.total)), `Total ${p.label}`) + table(['Method', 'Invoices', 'Amount', 'Share'], Object.entries(by).map(([k, b]) => [METHOD[k] || k, b.n, money(b.v), Math.round(100 * b.v / tot) + '%']), ['', 'r', 'r', 'r']), actions: [goPage('sales')] }
  }
  H.top_services = async e => {
    const p = e.period || periodFor('month')
    const rows = await apiFetch(`/${CID}/reports/sales-by-service?from=${p.from}&to=${p.to}`)
    if (!rows.length) return { html: md(`No sales ${p.label}.`) }
    const n = Math.min(e.count || 5, 15)
    return { html: md(`**Top ${Math.min(n, rows.length)} services ${p.label}** (before VAT)`) + table(['Service', 'Qty', 'Sales'], rows.slice(0, n).map(r => [esc(r.service), r.qty, money(r.total)]), ['', 'r', 'r']), actions: [{ label: 'Open Reports', run: () => { go('reports'); setRptPeriod && setRptPeriod('month') } }] }
  }
  H.profit = async e => {
    const p = e.period || periodFor('month')
    const r = await apiFetch(`/${CID}/reports/profit?from=${p.from}&to=${p.to}&group=month`)
    const t = r.totals
    return {
      html: big(`<span style="color:${t.net_profit < 0 ? 'var(--red)' : 'var(--green)'}">${money(t.net_profit)}</span>`, `Net ${t.net_profit < 0 ? 'loss' : 'profit'} ${p.label}`) +
        kv([['Sales (ex VAT)', money(t.sales)], ['Government fees (passed on)', money(t.gov_collected)], ['Your service income', money(t.service_income)], ['Running expenses', money(t.operating_expenses)]]) +
        (t.gov_balance ? `<div class="cb-note">${money(t.gov_balance)} of government fees collected is still held for the authorities — it is not profit.</div>` : ''),
      actions: [goPage('profit')], chips: ['Expenses ' + p.label, 'How is profit calculated?'],
    }
  }
  H.expenses_total = async e => {
    const p = e.period || periodFor('month')
    let ex = await apiFetch(`/${CID}/expenses?from=${p.from}&to=${p.to}`)
    const cat = e.expcat; if (cat) ex = ex.filter(x => (x.category || '').toLowerCase().includes(cat) || (x.description || '').toLowerCase().includes(cat))
    if (!ex.length) return { html: md(`No ${cat ? cat + ' ' : ''}expenses recorded ${p.label}.`), actions: [{ label: 'Add an expense', run: () => actions.add_expense() }] }
    const by = {}; ex.forEach(x => { const k = x.category || 'Other'; by[k] = (by[k] || 0) + (parseFloat(x.amount) || 0) })
    return {
      html: big(money(sum(ex, x => x.amount)), `${cat ? cat[0].toUpperCase() + cat.slice(1) + ' e' : 'E'}xpenses ${p.label}`) + kv([['Entries', ex.length], ['VAT paid (input)', money(sum(ex, x => x.vat_input))]]) +
        table(['Category', 'Amount'], Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [esc(k), money(v)]), ['', 'r']) + (ex.length >= 200 ? '<div class="cb-note">Showing the latest 200 entries.</div>' : ''),
      actions: [{ label: 'Add an expense', run: () => actions.add_expense() }, goPage('accounting')],
    }
  }
  H.vat_due = async e => {
    const p = e.period || periodFor('month')
    const [inv, ex] = await Promise.all([getInvoices(p, {}), apiFetch(`/${CID}/expenses?from=${p.from}&to=${p.to}`)])
    const out = sum(inv, i => i.vat_amount), inn = sum(ex, x => x.vat_input)
    return { html: big(money(out - inn), `VAT ${out - inn >= 0 ? 'to pay' : 'to reclaim'} ${p.label}`) + kv([['VAT on sales (output)', money(out)], ['VAT on expenses (input)', money(inn)]]) + '<div class="cb-note">A quick estimate from invoices and expenses. Government fees carry no VAT. Confirm figures on the VAT page before filing.</div>', actions: [goPage('vat', 'Open VAT / Tax')] }
  }
  H.gov_fees = async e => {
    const p = e.period || periodFor('month')
    const t = (await apiFetch(`/${CID}/reports/profit?from=${p.from}&to=${p.to}&group=month`)).totals
    return { html: big(money(t.gov_balance), `Government fees still held ${p.label}`) + kv([['Collected from customers', money(t.gov_collected)], ['Paid to the authorities', money(t.gov_paid)]]) + '<div class="cb-note">Held = collected − paid. It belongs to the authorities, so it is not part of your profit. Record payments as an expense with category “Government Fees”.</div>', actions: [goPage('profit')] }
  }
  H.pending_payments = async e => {
    const r = await apiFetch(`/${CID}/reports/pending`)
    const cs = custOf(e)
    let list = r.customers
    if (cs.length) { const names = cs.map(c => c.name.toLowerCase()); list = list.filter(c => names.includes((c.name || '').toLowerCase()) || cs.some(x => x.id === c.customer_id)) }
    if (!list.length) return { html: md(cs.length ? `**${esc(cs[0].name)}** owes nothing right now. ✅` : 'Nobody owes you anything right now. ✅') }
    const rows = list.slice(0, 8).map(c => [esc(c.name), money(c.balance), c.age_days + ' d'])
    return {
      html: big(money(sum(list, c => c.balance)), cs.length ? `Owed by ${esc(cs[0].name)}` : `Owed by ${plural(list.length, 'customer')}`) + table(['Customer', 'Balance', 'Age'], rows, ['', 'r', 'r']) + (list.length > 8 ? `<div class="cb-note">…and ${list.length - 8} more.</div>` : ''),
      actions: [{ label: 'Send payment reminders', run: () => go('notifications') }, goPage('profit', 'Open Profit page')],
    }
  }
  H.cash_drawer = async e => {
    const s = await apiFetch(`/${CID}/shifts/current?user_id=${_SESSION.uid}`)
    if (!s) return { html: md('You don’t have an open shift. Start one to track the cash drawer.'), actions: [{ label: 'Start my shift', run: () => actions.shift() }] }
    return { html: big(money(s.expected_cash), 'Expected cash in your drawer') + kv([['Opening float', money(s.opening_cash)], ['Cash sales', money(s.cash_sales)], ['Card', money(s.card_sales)], ['Bank transfer', money(s.transfer_sales)], ['On credit', money(s.credit_sales)], ['Invoices this shift', s.invoice_count]]), actions: [{ label: 'Close my shift', run: () => actions.shift() }] }
  }
  H.staff_sales = async e => {
    const p = e.period || periodFor('month')
    const r = await apiFetch(`/${CID}/reports/staff?from=${p.from}&to=${p.to}`)
    let rows = r.staff
    const who = e.mine ? { id: _SESSION.uid } : (e.staff && e.staff[0]) || (custOf(e)[0] && (typeof EMPLOYEES !== 'undefined' ? EMPLOYEES : []).find(u => u.name.toLowerCase() === custOf(e)[0].name.toLowerCase()))
    if (who) rows = rows.filter(s => s.user_id === who.id)
    if (!rows.length) return { html: md(`No sales ${p.label}${who ? ' for that person' : ''}.`) }
    if (who) { const s = rows[0]; return { html: big(money(s.sales), `${esc(s.name)} — sales ${p.label}`) + kv([['Invoices', s.invoices], ['Service income', money(s.service_income)], [`Commission (${s.commission_rate}%)`, money(s.commission)], ['Cash difference', s.shifts ? money(s.cash_difference) : '—']]), actions: [goPage('cashstaff')] } }
    return { html: md(`**Sales by staff ${p.label}** — top: **${esc(rows[0].name)}** (${money(rows[0].sales)})`) + table(['Staff', 'Sales', 'Commission'], rows.slice(0, 8).map(s => [esc(s.name), money(s.sales), money(s.commission)]), ['', 'r', 'r']), actions: [goPage('cashstaff')] }
  }
  H.invoice_lookup = async e => {
    const all = (await apiFetch(`/${CID}/invoices?limit=20000`)).filter(i => i.status !== 'void')
    const open = i => ({ label: 'View ' + i.invoice_number, run: () => viewSavedInvoice(i.id) })
    if (e.inv) {
      const i = all.find(x => x.invoice_number === e.inv)
      if (!i) return { html: md(`I couldn't find invoice **${esc(e.inv)}**.`) }
      return { html: big(money(i.total), i.invoice_number) + kv([['Date', dShow(i.issue_date)], ['Customer', esc(i.customer_name || 'Walk-in')], ['Paid by', METHOD[i.payment_method] || i.payment_method], ['Status', esc(i.status)], ['Made by', esc(i.created_by_name || '—')]]), actions: [open(i)] }
    }
    let list = all; const cs = custOf(e)
    if (cs.length) { list = all.filter(i => cs.some(c => i.customer_id === c.id || (i.customer_name || '').toLowerCase() === c.name.toLowerCase())) }
    if (!list.length) return { html: md(cs.length ? `No invoices found for **${esc(cs[0].name)}**.` : 'There are no invoices yet.') }
    const n = Math.min(e.count || 5, 10)
    return { html: md(`**${cs.length ? esc(cs[0].name) + ' — ' : ''}latest ${Math.min(n, list.length)} invoice${list.length > 1 ? 's' : ''}**`) + table(['Invoice', 'Date', 'Total'], list.slice(0, n).map(i => [esc(i.invoice_number), dShow(i.issue_date), money(i.total)]), ['', '', 'r']), actions: list.slice(0, 2).map(open).concat([goPage('sales')]) }
  }
  H.quotations_status = async e => {
    const q = await apiFetch(`/${CID}/quotations`)
    if (e.qt) { const x = q.find(z => z.quote_number === e.qt); return x ? { html: big(money(x.total), x.quote_number) + kv([['Customer / lead', esc(x.lead_name || '—')], ['Status', esc(x.status)], ['Valid until', dShow(x.valid_until)]]), actions: [{ label: 'Open ' + x.quote_number, run: () => { go('quotations'); viewQuotation(x.id) } }] } : { html: md(`I couldn't find quotation **${esc(e.qt)}**.`) } }
    if (!q.length) return { html: md('There are no quotations yet.'), actions: [{ label: 'New quotation', run: () => actions.new_quotation() }] }
    const by = {}; q.forEach(x => { by[x.status] = by[x.status] || { n: 0, v: 0 }; by[x.status].n++; by[x.status].v += parseFloat(x.total) || 0 })
    return { html: md(`**${plural(q.length, 'quotation')}**`) + table(['Status', 'Count', 'Value'], Object.entries(by).map(([k, b]) => [esc(k), b.n, money(b.v)]), ['', 'r', 'r']), actions: [goPage('quotations'), { label: 'New quotation', run: () => actions.new_quotation() }] }
  }
  H.today_overview = async () => {
    const p = periodFor('today')
    const [inv, pend, rn, apps] = await Promise.all([getInvoices(p, {}), apiFetch(`/${CID}/reports/pending`).catch(() => ({ total: 0, customers: [] })), apiFetch(`/${CID}/renewals?days=7`).catch(() => []), apiFetch(`/${CID}/applications`).catch(() => [])])
    const open = apps.filter(a => !['completed', 'rejected'].includes(a.status))
    return {
      html: md(`**Today so far**`) + kv([['Sales', `${money(sum(inv, i => i.total))} (${plural(inv.length, 'invoice')})`], ['Customers owe you', money(pend.total)], ['Documents expiring ≤ 7 days', rn.length], ['Open applications', open.length], ['Waiting for documents', apps.filter(a => a.status === 'doc_pending').length]]),
      actions: [goPage('notifications'), goPage('renewals')], chips: ['Who owes us money?', 'Pending applications'],
    }
  }
  H.daily_closing = async () => {
    const r = await H.sales_summary({ period: periodFor('today') })
    r.actions = [{ label: 'Open Daily Closing report', run: () => { go('reports'); setTimeout(() => { setRptPeriod('today'); runReport('daily-closing') }, 300) } }]
    return r
  }

  H.customer_lookup = async e => {
    const cs = custOf(e)
    const norm = e._norm || ''
    if (!cs.length) {
      if (/\b(list|all|show|customers)\b/.test(norm) && !/\b(find|search|who|phone|mobile|email)\b/.test(norm)) {
        const n = CUSTOMERS.length
        return { html: md(`You have **${plural(n, 'customer')}**. Here are the latest ones:`) + table(['Name', 'Phone'], CUSTOMERS.slice(-6).reverse().map(c => [esc(c.name), esc(c.phone || '—')])), actions: [goPage('customers')] }
      }
      return { html: md('I couldn’t find a customer by that name. Check the spelling, or add them as a new customer.'), actions: [{ label: 'Add a customer', run: () => actions.new_customer() }, goPage('customers')] }
    }
    if (cs.length > 1) return { html: md(`I found **${cs.length} customers** that match. Which one?`), chips: cs.map(c => ({ label: c.name + (c.phone ? ' · ' + c.phone : ''), ask: 'customer ' + c.name })) }
    const c = cs[0]
    const ask = e._norm || ''
    const phoneOnly = /\b(phone|mobile|number|contact|whatsapp|call)\b/.test(ask)
    return {
      html: (phoneOnly ? big(esc(c.phone || 'No number saved'), esc(c.name) + ' — mobile') : md(`**${esc(c.name)}**`)) + kv([['Type', esc(c.customer_type || '')], ['Mobile', esc(c.phone || '—')], ['E-mail', esc(c.email || '')], ['Emirate', esc(c.emirate || '')], ['TRN', esc(c.trn || '')], ['ID number', esc(c.id_number || '')], ['Customer code', 'C-' + String(c.id).padStart(4, '0')]]),
      actions: [{ label: 'Open profile', run: () => { go('customers'); viewCustomerById(c.id) } }, { label: 'Bill ' + c.name.split(' ')[0], run: () => { quickBillCustomer(c.id) } },
        { label: 'WhatsApp', run: async () => { const ph = await ensureMobile({ customerId: c.id, name: c.name, current: c.phone }); if (ph) window.open('https://wa.me/' + ph, '_blank', 'noopener') } }],
    }
  }
  H.customer_count = async e => {
    const all = CUSTOMERS, byType = t => all.filter(c => c.customer_type === t).length
    const p = e.period
    const fresh = p ? all.filter(c => inRange(c.created_at ? localISO(new Date(c.created_at)) : '', p)).length : null
    return { html: big(all.length, 'customers in total') + kv([['Individuals', byType('individual')], ['Companies', byType('company')], ['Freelancers', byType('freelancer')], p ? [`New ${p.label}`, fresh] : null]), actions: [goPage('customers')] }
  }

  H.renewals_due = async e => {
    const now = todayISO()
    let to = e.period ? e.period.to : localISO(addDays(new Date(), 30))
    if (e.period && ['this week', 'this month', 'this quarter', 'this year'].includes(e.period.label)) {
      const d = new Date(), y = d.getFullYear(), m = d.getMonth()
      to = localISO(e.period.label === 'this week' ? addDays(mondayOf(d), 6) : e.period.label === 'this month' ? new Date(y, m + 1, 0) : e.period.label === 'this quarter' ? new Date(y, Math.floor(m / 3) * 3 + 3, 0) : new Date(y, 11, 31))
    }
    const days = Math.min(Math.max(daysBetween(now, to), 1), 365)
    let rows = await apiFetch(`/${CID}/renewals?days=${days}`)
    const wantExpired = /\bexpired\b/.test(e._norm || '')
    if (wantExpired) rows = rows.filter(r => r.days_left < 0)
    else if (!/\b(expired|ago)\b/.test(e._norm || '')) rows = rows.filter(r => r.days_left >= 0 || !e.period)
    if (e.doc) rows = rows.filter(r => (r.name || '').toLowerCase().includes(e.doc.toLowerCase().split(' ')[0]))
    const cs = custOf(e); if (cs.length) rows = rows.filter(r => cs.some(c => c.id === r.customer_id))
    const label = wantExpired ? 'already expired' : `expiring in the next ${plural(days, 'day')}`
    if (!rows.length) return { html: md(`No ${e.doc ? e.doc + 's' : 'documents'} ${label}. ✅`), actions: [goPage('documents', 'Open Documents')] }
    return {
      html: md(`**${plural(rows.length, e.doc || 'document')} ${label}**`) + table(['Customer', 'Document', 'Expires'], rows.slice(0, 8).map(r => [esc(r.customer_name || '—'), esc(r.name), `${dShow(r.expires_at)}<br><small class="${r.days_left < 0 ? 'cb-bad' : r.days_left <= 7 ? 'cb-warn' : ''}">${r.days_left < 0 ? -r.days_left + ' d ago' : r.days_left === 0 ? 'today' : r.days_left + ' d left'}</small>`])) + (rows.length > 8 ? `<div class="cb-note">…and ${rows.length - 8} more.</div>` : ''),
      actions: [{ label: 'Send WhatsApp reminders', run: () => go('notifications') }, goPage('renewals')],
    }
  }
  H.send_reminder = async e => {
    const cs = custOf(e)
    if (cs.length === 1) {
      const rn = (await apiFetch(`/${CID}/renewals?days=60`)).filter(r => r.customer_id === cs[0].id)
      const c = cs[0]
      return {
        html: md(`**${esc(c.name)}** has ${rn.length ? plural(rn.length, 'document') + ' expiring or expired' : 'no documents expiring soon'}. ${rn.length ? 'Open Notifications to send the reminder on WhatsApp — the message is already written.' : 'You can still message them on WhatsApp.'}`),
        actions: [{ label: 'Open Notifications', run: () => go('notifications') }, { label: 'WhatsApp ' + c.name.split(' ')[0], run: async () => { const ph = await ensureMobile({ customerId: c.id, name: c.name, current: c.phone }); if (ph) window.open('https://wa.me/' + ph, '_blank', 'noopener') } }],
      }
    }
    return { html: md('All your customer messages are on the **Notifications** page (🔔): expiring documents, payments due and application updates. Each has a **WhatsApp** button with the message already written; if a customer has no mobile saved, you’ll be asked for it.'), actions: [{ label: 'Open Notifications', run: () => go('notifications') }] }
  }
  H.applications_status = async e => {
    const apps = await apiFetch(`/${CID}/applications`)
    if (e.app) { const a = apps.find(x => (x.app_number || '').toUpperCase() === e.app); return a ? { html: big(esc(a.status.replace(/_/g, ' ')), `${esc(a.app_number)} — ${esc(a.service_type)}`) + kv([['Customer', esc(a.customer_name || a.customer_full_name || '—')], ['Assigned to', esc(a.assigned_to || '—')], ['Govt ref', esc(a.govt_ref || '')]]), actions: [goPage('applications')] } : { html: md(`I couldn't find application **${esc(e.app)}**.`) } }
    let list = apps; const cs = custOf(e)
    if (cs.length) list = list.filter(a => cs.some(c => c.id === a.customer_id))
    if (e.period && !/\b(pending|waiting)\b/.test(e._norm || '')) list = list.filter(a => inRange(a.created_at ? localISO(new Date(a.created_at)) : '', e.period))
    const st = e.status
    if (st === 'pending') list = list.filter(a => !['completed', 'rejected'].includes(a.status))
    else if (st) list = list.filter(a => a.status === st || (st === 'processing' && a.status === 'under_process'))
    const label = st === 'pending' ? 'open' : st ? st.replace(/_/g, ' ') : ''
    if (!list.length) return { html: md(`No ${label} applications${cs.length ? ' for ' + esc(cs[0].name) : ''}.`), actions: [goPage('applications')] }
    const by = {}; list.forEach(a => { by[a.status] = (by[a.status] || 0) + 1 })
    return { html: md(`**${plural(list.length, (label ? label + ' ' : '') + 'application')}**`) + `<div class="cb-chiprow">${Object.entries(by).map(([k, n]) => `<span class="cb-pill">${n} ${esc(k.replace(/_/g, ' '))}</span>`).join('')}</div>` + table(['Ref', 'Customer', 'Service'], list.slice(0, 7).map(a => [esc(a.app_number || a.id), esc(a.customer_name || a.customer_full_name || '—'), esc(a.service_type)])) + (list.length > 7 ? `<div class="cb-note">…and ${list.length - 7} more.</div>` : ''), actions: [goPage('applications')] }
  }
  H.service_price = async e => {
    const svs = svcOf(e)
    if (!svs.length) {
      S.pending = { intent: 'service_price', slot: 'service' }
      return { html: md('Which service? Type its name — for example “Emirates ID renewal”.'), chips: SERVICES.slice(0, 5).map(s => ({ label: s.name, ask: 'price of ' + s.name })) }
    }
    const rows = svs.slice(0, 6)
    if (rows.length === 1) {
      const s = rows[0], gov = parseFloat(s.gov) || 0
      return { html: big(money(s.price), esc(s.name)) + kv([['Government fee', gov ? money(gov) : ''], ['Your service charge', gov ? money(s.price - gov) : ''], ['VAT', gov ? '5% on the service charge only' : '5%']]), actions: [{ label: 'Edit this service', run: () => { go('services'); setTimeout(() => openServiceModal(s.id), 300) } }, goPage('pos', 'Sell it')] }
    }
    return { html: md(`**${plural(svs.length, 'matching service')}**`) + table(['Service', 'Price', 'Govt fee'], rows.map(s => [esc(s.name), money(s.price), s.gov ? money(s.gov) : '—']), ['', 'r', 'r']), actions: [goPage('services')] }
  }
  H.service_list = async e => {
    const q = e._norm || '', cats = [['visa', /\bvisa\b/], ['government', /\bgovern|labou?r|tasheel|tawjeeh/], ['typing', /\btyping\b|\btranslation\b/], ['print', /\bprint|photocopy|scan\b/]]
    const pick = (cats.find(c => c[1].test(q)) || [])[0]
    let list = SERVICES.slice()
    if (pick) list = list.filter(s => (s.cat || '').toLowerCase().includes(pick) || s.name.toLowerCase().includes(pick))
    if (!list.length) return { html: md('No services found. You can import typical services from the catalogue.'), actions: [{ label: 'Import from catalogue', run: () => actions.import_catalogue() }] }
    return { html: md(`**${plural(list.length, 'service')}${pick ? ' · ' + pick : ''}**`) + table(['Service', 'Price'], list.slice(0, 12).map(s => [esc(s.name), money(s.price)]), ['', 'r']) + (list.length > 12 ? `<div class="cb-note">…and ${list.length - 12} more.</div>` : ''), actions: [goPage('services'), { label: 'Import from catalogue', run: () => actions.import_catalogue() }] }
  }

  // ───────── doing things ─────────
  const actions = {
    new_sale: (e) => { go('pos'); const c = e && custOf(e)[0]; if (c) setTimeout(() => selectCustomer(c.name, (c.phone || '') + (c.emirate ? ' · ' + c.emirate : ''), c.id), 250) },
    new_customer: () => { go('customers'); setTimeout(() => openModal('new-customer-modal'), 250) },
    add_expense: () => { go('accounting'); setTimeout(() => { const b = document.querySelector('.tab-btn[onclick*="acc-expenses"]'); if (b) b.click(); openExpenseModal() }, 300) },
    new_quotation: () => { go('quotations'); setTimeout(() => openNewQuotation(), 250) },
    upload_document: () => { go('documents'); setTimeout(() => { resetDocModal(); openModal('upload-doc-modal') }, 250) },
    shift: () => { go('cashstaff') },
    import_catalogue: () => { go('services'); setTimeout(() => openCatalogue(), 300) },
  }
  const DO = (key, msg, extra) => async e => { actions[key](e); return Object.assign({ html: md(msg) }, extra || {}) }
  H.navigate = async e => {
    const page = e.page; if (!page) return { html: md('Which page? For example “open reports” or “go to customers”.'), chips: ['Open reports', 'Open customers', 'Open settings'] }
    go(page); return { html: md(`Opening **${D.PAGE_LABEL[page] || page}**…`) }
  }
  H.act_new_sale = async e => { actions.new_sale(e); const c = custOf(e)[0]; return { html: md(c ? `Opening **POS** with **${esc(c.name)}** selected.` : 'Opening **POS / New Sale**. Tap the services to add them.') } }
  H.act_new_customer = DO('new_customer', 'Opening the **new customer** form.')
  H.act_add_expense = DO('add_expense', 'Opening the **Add Expense** form. Use category *Government Fees* for fees you pay to the authorities.')
  H.act_new_quotation = DO('new_quotation', 'Opening a **new quotation**.')
  H.act_upload_document = DO('upload_document', 'Opening **Upload Document**. Pick the customer, the type and the expiry date.')
  H.act_shift = DO('shift', 'Opening **Cash & Staff**. Start or close your shift there.')
  H.act_import_catalogue = DO('import_catalogue', 'Opening the **service catalogue**. Tick what you offer and check the prices.')

  // ───────── how-to guides ─────────
  D.INTENTS.filter(i => i.type === 'howto').forEach(it => {
    H[it.id] = async () => {
      const acts = []
      if (it.go) acts.push({ label: it.go.label, run: () => it.go.act ? actions[it.go.act]() : go(it.go.page) })
      return { html: md(`**${it.title}**`) + `<ol class="cb-ol">${it.steps.map(s => `<li>${md(s)}</li>`).join('')}</ol>` + (it.note ? `<div class="cb-note">${md(it.note)}</div>` : ''), actions: acts }
    }
  })

  // ───────── routing ─────────
  const LABEL = {
    sales_summary: 'Sales', sales_by_method: 'Sales by payment method', top_services: 'Top services', profit: 'Profit', expenses_total: 'Expenses', vat_due: 'VAT', gov_fees: 'Government fees', pending_payments: 'Who owes us money',
    cash_drawer: 'Cash drawer / shift', staff_sales: 'Staff sales & commission', invoice_lookup: 'Find an invoice', quotations_status: 'Quotations', today_overview: 'Business summary', daily_closing: 'Daily closing report',
    customer_lookup: 'Find a customer', customer_count: 'How many customers', renewals_due: 'Expiring documents', send_reminder: 'Send reminders', applications_status: 'Applications', service_price: 'Price of a service', service_list: 'List of services',
    navigate: 'Open a page', act_new_sale: 'New sale', act_new_customer: 'Add a customer', act_add_expense: 'Add an expense', act_new_quotation: 'New quotation', act_upload_document: 'Upload a document', act_shift: 'Start / close shift', act_import_catalogue: 'Import services',
    greet: 'Say hello', help: 'What can you do?', trouble: 'Something is not working',
  }
  D.INTENTS.filter(i => i.type === 'howto').forEach(i => { LABEL[i.id] = 'How to: ' + i.title.toLowerCase() })

  const RUDE = /\b(fuck|shit|bitch|stupid|idiot|damn|asshole|dumb|useless)\b/i
  // what a person's role must allow before the assistant answers or opens something (any one of the list is enough)
  const NEEDS = {
    sales_summary: ['sales_view'], sales_by_method: ['sales_view'], top_services: ['reports', 'sales_view'], profit: ['profit'], expenses_total: ['expenses', 'accounting'], vat_due: ['vat'], gov_fees: ['profit'],
    pending_payments: ['profit'], cash_drawer: ['cash_own'], staff_sales: ['staff_report'], invoice_lookup: ['sales_view'], quotations_status: ['quotations'], today_overview: ['profit'], daily_closing: ['reports'],
    customer_lookup: ['customers_view'], customer_count: ['customers_view'], renewals_due: ['renewals'], send_reminder: ['renewals'], applications_status: ['applications'],
    act_new_sale: ['pos'], act_new_customer: ['customers_edit'], act_add_expense: ['expenses'], act_new_quotation: ['quotations'], act_upload_document: ['documents_edit'], act_shift: ['cash_own'], act_import_catalogue: ['services_edit'],
  }
  const blocked = (id, e) => {
    if (id === 'navigate') return !!e.page && !canPage(e.page)
    if (!NEEDS[id] || NEEDS[id].some(p => can(p))) return false
    if (e.mine && ['sales_summary', 'sales_by_method', 'staff_sales'].includes(id)) return false       // everyone may ask about their own sales
    return true
  }

  async function run(id, e) {
    if (blocked(id, e)) return { html: md('🔒 Your role doesn’t include that. If you need it, ask your admin to change your role in **Settings → Users & Roles**. I can still help with your own sales, prices and how-to questions.'), chips: ['My sales today', 'Find a customer', 'How do I make a sale?'] }
    const h = H[id]; if (!h) return { html: md('I understood the question but I can’t answer that one yet.') }
    try {
      const r = await h(e)
      if (D.INTENTS.find(i => i.id === id && (i.type === 'data'))) S.last = { intent: id, e }
      return r
    } catch (err) { console.error('assistant:', id, err); return errReply() }
  }

  // a follow-up like "and last month?" or "what about Sara?" re-asks the previous question with the new detail
  function followUp(res) {
    const prev = S.last; if (!prev) return null
    const e = res.entities, hasNew = e.period || e.customers.length || e.services.length || e.staff.length || e.doc || e.status || e.method || e.count
    const short = res.norm.split(' ').length <= 6
    if (!hasNew || !short || res.score >= 0.35) return null
    const merged = Object.assign({}, prev.e, Object.fromEntries(Object.entries(e).filter(([k, v]) => v && (!Array.isArray(v) || v.length) && !['howto', 'navverb'].includes(k))))
    merged._norm = res.norm
    return { intent: prev.intent, e: merged }
  }

  async function answer(text) {
    const res = NLP.parse(text, nlpContext())
    res.entities._norm = res.norm
    if (RUDE.test(text)) return { html: md('Let’s keep it friendly 😊 — how can I help?') }
    if (res.intent === 'empty') return { html: md('Type a question, for example “how much did we sell today?”.'), chips: D.SUGGESTIONS.slice(0, 4) }

    // waiting for one missing detail (e.g. which service)
    if (S.pending) {
      const p = S.pending; S.pending = null
      const e = res.entities
      if (p.slot === 'service' && (e.services.length || res.intent === 'service_price')) { if (e.services.length) return run(p.intent, e) }
      if (res.intent === 'deny') return H.deny()
    }

    const conf = NLP.confidence(res)
    const fu = (conf !== 'ok' || ['affirm', 'deny'].includes(res.intent)) ? followUp(res) : null
    if (fu) return run(fu.intent, fu.e)

    if (conf === 'ok') return run(res.intent, res.entities)

    // not sure: offer the best guesses instead of a wrong answer
    const alts = res.alts.filter(a => a.score >= 0.18 && LABEL[a.id] && !['affirm', 'deny'].includes(a.id)).slice(0, 3)
    if (!alts.length) {
      return { html: md('I’m not sure I understood that. I can answer questions about **sales, profit, expenses, who owes you, customers, expiring documents, applications and prices**, and explain how to use each screen.'), chips: D.SUGGESTIONS.slice(0, 5) }
    }
    S.confirm = { intent: alts[0].id, entities: res.entities }
    return { html: md(alts.length === 1 || conf === 'ambiguous' && alts[0].score - (alts[1] || { score: 0 }).score > 0.1 ? `Did you mean **${LABEL[alts[0].id]}**?` : 'I want to be sure I get this right — did you mean:'), chips: alts.map(a => ({ label: LABEL[a.id], intent: a.id, entities: res.entities })) }
  }

  // several questions in one message ("sales today and who owes me") are answered one after the other
  async function respond(text) {
    const parts = text.split(/\s*(?:;|\band also\b|\band then\b|\bthen\b|\balso\b|\?\s+(?=\S))\s*|\s+and\s+(?=(?:how|what|who|which|show|list|open|total|profit|sales|expenses|pending)\b)/i).map(s => s.trim()).filter(s => s.split(' ').length >= 2)
    if (parts.length > 1 && parts.length <= 3) {
      const ctx = nlpContext(), parsed = parts.map(p => NLP.parse(p, ctx))
      const ok = parsed.every(r => NLP.confidence(r) === 'ok' && !['greet', 'affirm', 'deny', 'thanks'].includes(r.intent))
      if (ok && new Set(parsed.map(r => r.intent)).size === parsed.length) {
        const replies = []
        for (const p of parts) replies.push(await answer(p))
        return { html: replies.map(r => `<div class="cb-part">${r.html}</div>`).join(''), actions: replies.flatMap(r => r.actions || []).slice(0, 4), chips: replies[replies.length - 1].chips }
      }
    }
    return answer(text)
  }

  // ───────── window ─────────
  const CSS = `
#cb-fab{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:var(--accent);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s}
#cb-fab:hover{transform:scale(1.07)} body.on-pos #cb-fab{bottom:96px}
#cb-panel{position:fixed;right:18px;bottom:88px;width:392px;max-width:calc(100vw - 24px);height:min(620px,calc(100vh - 110px));background:var(--surface);color:var(--fg);border:1px solid var(--border);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}
#cb-panel.open{display:flex}
.cb-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--accent);color:#fff}
.cb-head .cb-av{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:17px}
.cb-head b{font-size:14px;display:block}.cb-head small{font-size:11px;opacity:.8}
.cb-head button{margin-left:6px;background:rgba(255,255,255,.16);border:none;color:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px}
.cb-head button:first-of-type{margin-left:auto}
#cb-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
.cb-m{max-width:92%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.cb-m.bot{align-self:flex-start;background:var(--surface);border:1px solid var(--border);border-bottom-left-radius:4px}
.cb-m.me{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px}
.cb-part+.cb-part{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)}
.cb-big{margin:2px 0 8px}.cb-big>b{display:block;font-size:22px;font-weight:800;letter-spacing:-.02em}.cb-big>span{display:block;font-size:11.5px;color:var(--fg3);font-weight:600}
.cb-kv{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:6px 0}.cb-kv div{min-width:0}.cb-kv span{display:block;font-size:10.5px;color:var(--fg3);text-transform:uppercase;letter-spacing:.04em}.cb-kv b{font-size:12.5px;font-weight:700}
.cb-t{width:100%;border-collapse:collapse;margin:8px 0 2px;font-size:12px}.cb-t th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--fg3);padding:4px 6px 4px 0;border-bottom:1px solid var(--border)}.cb-t td{padding:5px 6px 5px 0;border-bottom:1px solid var(--border);vertical-align:top}.cb-t .r{text-align:right;white-space:nowrap}.cb-t tr:last-child td{border-bottom:none}
.cb-note{margin-top:8px;padding:8px 10px;background:var(--surface2);border-left:3px solid var(--accent);border-radius:8px;font-size:11.5px;color:var(--fg2)}
.cb-ul,.cb-ol{margin:6px 0 0;padding-left:18px}.cb-ul li,.cb-ol li{margin:3px 0}
.cb-bad{color:var(--red);font-weight:700}.cb-warn{color:var(--amber);font-weight:700}
.cb-pill{display:inline-block;padding:2px 9px;border-radius:20px;background:var(--accent-light);color:var(--accent);font-size:11px;font-weight:700;margin:6px 5px 0 0}
.cb-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.cb-acts button,.cb-chip{border:1px solid var(--accent);background:var(--surface);color:var(--accent);border-radius:18px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.cb-acts button:hover,.cb-chip:hover{background:var(--accent);color:#fff}
.cb-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 12px 0;background:var(--surface);scrollbar-width:none}.cb-chips:empty{display:none}.cb-chip{white-space:nowrap;border-color:var(--border);color:var(--fg2);font-weight:600}
.cb-typing{align-self:flex-start;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:14px}.cb-typing i{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:var(--fg3);animation:cbb 1s infinite}.cb-typing i:nth-child(2){animation-delay:.15s}.cb-typing i:nth-child(3){animation-delay:.3s}
@keyframes cbb{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}
.cb-form{display:flex;gap:8px;padding:10px 12px 12px;background:var(--surface)}.cb-form input{flex:1;border:1px solid var(--border);border-radius:20px;padding:10px 14px;font-size:13px;background:var(--bg);color:var(--fg);font-family:inherit;min-height:40px}
.cb-form button{width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
`

  let built = false
  function build() {
    if (built) return; built = true
    const st = document.createElement('style'); st.textContent = CSS; document.head.insertBefore(st, document.head.firstChild)
    const fab = document.createElement('button')
    fab.id = 'cb-fab'; fab.type = 'button'; fab.title = 'Ask the assistant'; fab.setAttribute('aria-label', 'Open the assistant')
    fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
    fab.onclick = toggle
    const panel = document.createElement('div')
    panel.id = 'cb-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistant')
    panel.innerHTML = `<div class="cb-head"><div class="cb-av">💬</div><div><b>Assistant</b><small>Ask about sales, customers, renewals… or how to do anything</small></div>
      <button type="button" id="cb-clear" title="Clear chat" aria-label="Clear chat">⟲</button><button type="button" id="cb-close" title="Close" aria-label="Close">✕</button></div>
      <div id="cb-msgs" role="log" aria-live="polite"></div><div class="cb-chips" id="cb-chips"></div>
      <form class="cb-form" id="cb-form" autocomplete="off"><input id="cb-in" placeholder="Ask me anything…" maxlength="300" aria-label="Your question"><button type="submit" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></form>`
    document.body.appendChild(fab); document.body.appendChild(panel)
    $('cb-close').onclick = toggle
    $('cb-clear').onclick = () => { $('cb-msgs').innerHTML = ''; S.last = S.pending = S.confirm = null; welcome() }
    $('cb-form').onsubmit = ev => { ev.preventDefault(); const t = $('cb-in').value.trim(); if (t) { $('cb-in').value = ''; ask(t) } }
    panel.addEventListener('keydown', ev => { if (ev.key === 'Escape') toggle() })
    $('cb-msgs').addEventListener('click', ev => { const b = ev.target.closest('[data-act]'); if (b) { const f = ACTS[+b.dataset.act]; if (f) { stepAside(); f() } } })
    $('cb-chips').addEventListener('click', ev => { const b = ev.target.closest('[data-chip]'); if (b) chipClick(CHIPS[+b.dataset.chip]) })
    $('cb-msgs').addEventListener('click', ev => { const b = ev.target.closest('[data-chip]'); if (b) chipClick(CHIPS[+b.dataset.chip]) })
    welcome()
  }

  let ACTS = [], CHIPS = []
  function bubble(cls, html) { const d = document.createElement('div'); d.className = 'cb-m ' + cls; d.innerHTML = html; $('cb-msgs').appendChild(d); $('cb-msgs').scrollTop = $('cb-msgs').scrollHeight; return d }
  function setChips(list) {
    CHIPS = (list || []).map(c => typeof c === 'string' ? { label: c, ask: c } : c)
    $('cb-chips').innerHTML = CHIPS.map((c, i) => `<button type="button" class="cb-chip" data-chip="${i}">${esc(c.label)}</button>`).join('')
  }
  function addBot(r) {
    const acts = (r.actions || []).filter(a => !a.page || canPage(a.page)).map(a => { ACTS.push(a.run); return `<button type="button" data-act="${ACTS.length - 1}">${esc(a.label)}</button>` }).join('')
    bubble('bot', r.html + (acts ? `<div class="cb-acts">${acts}</div>` : ''))
    setChips(r.chips && r.chips.length ? r.chips : [])
  }
  function welcome() {
    addBot({ html: md(`Hi ${esc(_SESSION.name.split(' ')[0])}! 👋 I’m your assistant. Ask me about **sales, customers, renewals, prices**, or **how to do** something — or tell me where to go.`), chips: D.SUGGESTIONS })
  }
  async function chipClick(c) {
    if (!c) return
    if (c.intent) { addUser(c.label); await withTyping(() => run(c.intent, c.entities || {})); return }
    ask(c.ask || c.label)
  }
  function addUser(t) { bubble('me', esc(t)) }
  async function withTyping(fn) {
    const t = document.createElement('div'); t.className = 'cb-typing'; t.innerHTML = '<i></i><i></i><i></i>'; $('cb-msgs').appendChild(t); $('cb-msgs').scrollTop = 1e6
    S.busy = true
    let r; try { r = await fn() } catch (e) { console.error(e); r = errReply() }
    t.remove(); S.busy = false; addBot(r)
  }
  async function ask(text) { addUser(text); await withTyping(() => respond(text)) }
  function toggle() {
    build()
    const p = $('cb-panel'); p.classList.toggle('open')
    if (p.classList.contains('open')) setTimeout(() => $('cb-in').focus(), 50)
  }

  window.Assistant = { ask, open: () => { build(); $('cb-panel').classList.add('open') }, answer, parse: t => NLP.parse(t, nlpContext()), _H: H }
  const boot = () => { build() }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 800)
})()
