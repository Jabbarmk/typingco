// Business-operations features for typing centres:
//   1. Renewal reminders (expiring visa / Emirates ID / trade licence / labour card) with WhatsApp
//   2. Service catalogue (ready-made list of typical services with default fees)
//   3. Cashier shifts (opening float, expected vs counted cash, difference)
//   4. Reports: profit by service / period, staff sales & commission, money pending from customers
import pool from './db.js'

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const r2  = v => Math.round(v * 100) / 100
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const isGov = category => /govern|govt/i.test(category || '')

// ═══════════════════════════════════════════════════════════
// 1. RENEWAL REMINDERS
// ═══════════════════════════════════════════════════════════
const REMINDER_STAGES = [30, 14, 7, 1, 0]          // days before expiry that an automatic reminder goes out

// UAE mobile numbers → international digits for WhatsApp (wa.me / Cloud API)
export function waPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('971')) return d.length >= 11 ? d : null
  if (d.startsWith('0')) d = '971' + d.slice(1)
  else if (d.length === 9) d = '971' + d
  return d.length >= 10 ? d : null
}

const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export function reminderText({ company, customer, doc, expires_at, days_left }) {
  const when = days_left < 0 ? `expired on ${fmtDate(expires_at)}`
    : days_left === 0 ? `expires today (${fmtDate(expires_at)})`
    : `expires on ${fmtDate(expires_at)} (in ${days_left} day${days_left === 1 ? '' : 's'})`
  return `Hello ${customer}, this is ${company}. Your ${doc} ${when}. ` +
    `Please contact us to renew it in time — we will take care of the paperwork for you.`
}

const waConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)

// WhatsApp Cloud API (Meta). Business-initiated messages must use an approved template with 4 body variables:
//   {{1}} customer name  {{2}} document  {{3}} expiry date  {{4}} company name
async function sendWhatsAppTemplate(phone, vars) {
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: {
        name: process.env.WHATSAPP_TEMPLATE || 'document_expiry_reminder',
        language: { code: process.env.WHATSAPP_LANG || 'en' },
        components: [{ type: 'body', parameters: vars.map(text => ({ type: 'text', text: String(text) })) }],
      },
    }),
  })
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

const RENEWAL_SQL = `
  SELECT d.id, d.name, d.file_path AS file_name, DATE_FORMAT(d.expires_at,'%Y-%m-%d') AS expires_at,
         d.customer_id, c.name AS customer_name, c.phone, d.last_reminded_at, d.reminder_count,
         DATEDIFF(d.expires_at, CURDATE()) AS days_left, co.name AS company_name
  FROM documents d
  LEFT JOIN customers c  ON c.id = d.customer_id
  LEFT JOIN companies co ON co.id = d.company_id`

// Send every reminder that is due and has not been sent yet. Safe to run repeatedly.
export async function runAutoReminders(cid = null) {
  if (!waConfigured()) return { enabled: false, sent: 0, failed: 0 }
  const [docs] = await pool.query(
    `${RENEWAL_SQL} WHERE d.expires_at IS NOT NULL AND DATEDIFF(d.expires_at, CURDATE()) BETWEEN -30 AND ${REMINDER_STAGES[0]}
       ${cid ? 'AND d.company_id = ?' : ''}`, cid ? [cid] : [])
  let sent = 0, failed = 0
  for (const d of docs) {
    const stage = [...REMINDER_STAGES].reverse().find(s => d.days_left <= s)   // smallest stage already reached
    if (stage === undefined) continue
    const [[done]] = await pool.query(
      "SELECT COUNT(*) AS n FROM reminder_log WHERE document_id=? AND stage_days=? AND mode='auto' AND status='sent'", [d.id, stage])
    if (done.n) continue
    const phone = waPhone(d.phone)
    if (!phone) continue
    const message = reminderText({ company: d.company_name, customer: d.customer_name, doc: d.name, expires_at: d.expires_at, days_left: d.days_left })
    try {
      await sendWhatsAppTemplate(phone, [d.customer_name, d.name, fmtDate(d.expires_at), d.company_name])
      await pool.query(
        "INSERT INTO reminder_log (company_id,document_id,customer_id,mode,stage_days,status,phone,message) SELECT company_id,id,customer_id,'auto',?,'sent',?,? FROM documents WHERE id=?",
        [stage, phone, message, d.id])
      await pool.query('UPDATE documents SET last_reminded_at=NOW(), reminder_count=reminder_count+1 WHERE id=?', [d.id])
      sent++
    } catch (e) {
      await pool.query(
        "INSERT INTO reminder_log (company_id,document_id,customer_id,mode,stage_days,status,phone,message,error) SELECT company_id,id,customer_id,'auto',?,'failed',?,?,? FROM documents WHERE id=?",
        [stage, phone, message, String(e.message).slice(0, 300), d.id])
      failed++
    }
  }
  return { enabled: true, sent, failed }
}

// ═══════════════════════════════════════════════════════════
// 2. SERVICE CATALOGUE  — [name, category, total price, government fee included, icon, group]
// Figures are typical starting points only: government fees change, so check each one before importing.
// ═══════════════════════════════════════════════════════════
const CATALOGUE = [
  // Visa (Amer / GDRFA)
  ['Visa Application – Entry Permit (Amer)', 'Visa', 500, 400, '✈️', 'Visa (Amer)'],
  ['Visa Renewal (Amer)',                    'Visa', 400, 300, '🔄', 'Visa (Amer)'],
  ['Visa Cancellation (Amer)',               'Visa', 200, 150, '✈️', 'Visa (Amer)'],
  ['Visa Status Change (Amer)',              'Visa', 450, 350, '✈️', 'Visa (Amer)'],
  ['Visa Medical Fitness Test',              'Visa', 320, 270, '🏥', 'Visa (Amer)'],
  // Emirates ID
  ['Emirates ID – New',                      'Government', 300, 230, '🪪', 'Emirates ID'],
  ['Emirates ID – Renewal',                  'Government', 300, 230, '🪪', 'Emirates ID'],
  ['Emirates ID – Replacement (lost/damaged)', 'Government', 350, 300, '🪪', 'Emirates ID'],
  ['Emirates ID – Update Details',           'Government', 150, 100, '🪪', 'Emirates ID'],
  // Labour (MOHRE / Tasheel / Tawjeeh)
  ['Tasheel – New Work Permit',              'Government', 400, 300, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  ['Tasheel – Work Permit Renewal',          'Government', 350, 250, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  ['Tasheel – Contract Amendment',           'Government', 150, 100, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  ['Tawjeeh – Labour Contract Registration', 'Government', 120,  50, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  ['Labour Card Renewal',                    'Government', 300, 220, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  ['Labour Card Cancellation',               'Government', 150, 100, '👷', 'Labour (MOHRE / Tasheel / Tawjeeh)'],
  // Trade licence / PRO
  ['Trade Licence Renewal (follow-up)',      'Government', 600, 450, '📜', 'Trade licence & PRO'],
  ['Establishment Card Renewal',             'Government', 350, 250, '📜', 'Trade licence & PRO'],
  ['PRO Service (per visit)',                'Government', 200,   0, '🏛️', 'Trade licence & PRO'],
  // Translation
  ['Legal Translation (per page)',           'Typing',      60,   0, '🌐', 'Translation'],
  ['Arabic ⇄ English Translation (per page)', 'Typing',     50,   0, '🌐', 'Translation'],
  ['Certified Translation (per page)',       'Typing',      90,   0, '🌐', 'Translation'],
  // Attestation
  ['Document Attestation – MOFA',            'Government', 250, 180, '🔏', 'Attestation'],
  ['Document Attestation – Embassy',         'Government', 300, 220, '🔏', 'Attestation'],
  ['Degree / Certificate Attestation',       'Government', 450, 350, '🎓', 'Attestation'],
  ['Notary Public Service',                  'Government', 200, 150, '🔏', 'Attestation'],
  // Typing
  ['Typing – English / Arabic (per page)',   'Typing',      10,   0, '⌨️', 'Typing'],
  ['Application / Letter Typing',            'Typing',      25,   0, '⌨️', 'Typing'],
  ['CV / Resume Writing',                    'Typing',      60,   0, '📄', 'Typing'],
  ['NOC Letter',                             'Typing',      30,   0, '📄', 'Typing'],
  ['Passport Photos (6 pcs)',                'Other',       15,   0, '🛂', 'Typing'],
  // Print & copy
  ['Photocopy A4 B&W',                       'Photocopy',  0.5,   0, '🖨️', 'Print & copy'],
  ['Photocopy A4 Colour',                    'Photocopy',    2,   0, '🎨', 'Print & copy'],
  ['Print A4 B&W',                           'Print',        1,   0, '🖨️', 'Print & copy'],
  ['Print A4 Colour',                        'Print',        3,   0, '🎨', 'Print & copy'],
  ['Scan to PDF (per page)',                 'Print',        2,   0, '📠', 'Print & copy'],
  ['Lamination A4',                          'Print',       10,   0, '🗂️', 'Print & copy'],
  ['Binding',                                'Print',       15,   0, '📚', 'Print & copy'],
  ['Courier / Delivery',                     'Other',       50,   0, '📦', 'Print & copy'],
]

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════
export function registerOps(app) {

  // ── Renewals ────────────────────────────────────────────
  app.get('/api/:cid/renewals', async (req, res) => {
    const ahead = Math.min(Math.max(parseInt(req.query.days) || 90, 1), 365)
    const [rows] = await pool.query(
      `${RENEWAL_SQL} WHERE d.company_id=? AND d.expires_at IS NOT NULL
         AND DATEDIFF(d.expires_at, CURDATE()) BETWEEN -90 AND ?
       ORDER BY d.expires_at ASC`, [req.params.cid, ahead])
    res.json(rows.map(d => ({
      ...d,
      wa_phone: waPhone(d.phone),
      message: reminderText({ company: d.company_name, customer: d.customer_name || 'there', doc: d.name, expires_at: d.expires_at, days_left: d.days_left }),
    })))
  })

  // staff opened WhatsApp for this customer → remember it
  app.post('/api/:cid/renewals/:docId/reminded', async (req, res) => {
    const { user_id, message, phone } = req.body || {}
    const [[d]] = await pool.query('SELECT id, customer_id FROM documents WHERE id=? AND company_id=?', [req.params.docId, req.params.cid])
    if (!d) return res.status(404).json({ error: 'Document not found' })
    await pool.query(
      "INSERT INTO reminder_log (company_id,document_id,customer_id,mode,status,phone,message,sent_by) VALUES (?,?,?,'manual','sent',?,?,?)",
      [req.params.cid, d.id, d.customer_id, phone || null, String(message || '').slice(0, 1000), user_id || null])
    await pool.query('UPDATE documents SET last_reminded_at=NOW(), reminder_count=reminder_count+1 WHERE id=?', [d.id])
    res.json({ ok: true })
  })

  app.get('/api/:cid/reminders/status', async (req, res) => {
    res.json({ auto_enabled: waConfigured(), stages: REMINDER_STAGES, template: process.env.WHATSAPP_TEMPLATE || 'document_expiry_reminder' })
  })

  app.post('/api/:cid/reminders/run', async (req, res) => {
    res.json(await runAutoReminders(req.params.cid))
  })

  app.get('/api/:cid/reminders/log', async (req, res) => {
    const [rows] = await pool.query(
      `SELECT l.id, l.mode, l.stage_days, l.status, l.phone, l.error, l.created_at, d.name AS document,
              c.name AS customer_name, u.name AS sent_by_name
       FROM reminder_log l
       LEFT JOIN documents d ON d.id=l.document_id LEFT JOIN customers c ON c.id=l.customer_id LEFT JOIN users u ON u.id=l.sent_by
       WHERE l.company_id=? ORDER BY l.id DESC LIMIT 100`, [req.params.cid])
    res.json(rows)
  })

  // ── Catalogue ───────────────────────────────────────────
  app.get('/api/:cid/catalogue', async (req, res) => {
    const [have] = await pool.query('SELECT LOWER(name) AS n FROM services WHERE company_id=?', [req.params.cid])
    const names = new Set(have.map(r => r.n))
    res.json(CATALOGUE.map(([name, category, price, gov_fee, icon, group]) =>
      ({ name, category, price, gov_fee, icon, group, exists: names.has(name.toLowerCase()) })))
  })

  app.post('/api/:cid/catalogue/import', async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'No services selected' })
    const [have] = await pool.query('SELECT LOWER(name) AS n FROM services WHERE company_id=?', [req.params.cid])
    const names = new Set(have.map(r => r.n))
    const rows = []
    for (const it of items) {
      const name = String(it.name || '').trim(), price = num(it.price), gov = Math.max(num(it.gov_fee), 0)
      if (!name || price < 0 || gov > price) return res.status(400).json({ error: `Check the price and government fee for "${name || 'a service'}"` })
      if (names.has(name.toLowerCase())) continue
      names.add(name.toLowerCase())
      rows.push([req.params.cid, name, it.category || 'Other', price, gov, 'S', 1, it.icon || '📄'])
    }
    if (rows.length) await pool.query('INSERT INTO services (company_id,name,category,unit_price,gov_fee,vat_category,is_active,icon) VALUES ?', [rows])
    res.json({ imported: rows.length, skipped: items.length - rows.length })
  })

  // ── Shifts ──────────────────────────────────────────────
  // Sales made by the shift's cashier while the shift was open, split by payment method
  async function shiftTotals(s) {
    const [rows] = await pool.query(
      `SELECT payment_method AS m, COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM invoices
       WHERE company_id=? AND status='posted' AND created_by=? AND created_at>=? AND created_at<=COALESCE(?, NOW())
       GROUP BY payment_method`, [s.company_id, s.user_id, s.opened_at, s.closed_at])
    const by = {}; let count = 0
    rows.forEach(r => { by[r.m] = r2(num(r.t)); count += r.n })
    return { cash_sales: by.cash || 0, card_sales: by.card || 0, transfer_sales: by.bank_transfer || 0, credit_sales: by.customer_credit || 0, invoice_count: count }
  }
  const withLive = async s => {
    if (s.status !== 'open') return s
    const t = await shiftTotals(s)
    return { ...s, ...t, expected_cash: r2(num(s.opening_cash) + t.cash_sales) }
  }

  app.get('/api/:cid/shifts/current', async (req, res) => {
    const [[s]] = await pool.query("SELECT * FROM shifts WHERE company_id=? AND user_id=? AND status='open' ORDER BY id DESC LIMIT 1", [req.params.cid, req.query.user_id || 0])
    res.json(s ? await withLive(s) : null)
  })

  app.get('/api/:cid/shifts', async (req, res) => {
    const { from, to, user_id } = req.query
    let sql = 'SELECT * FROM shifts WHERE company_id=?'; const p = [req.params.cid]
    if (isDate(from)) { sql += ' AND DATE(opened_at)>=?'; p.push(from) }
    if (isDate(to))   { sql += ' AND DATE(opened_at)<=?'; p.push(to) }
    if (user_id)      { sql += ' AND user_id=?'; p.push(user_id) }
    const [rows] = await pool.query(sql + ' ORDER BY opened_at DESC LIMIT 300', p)
    res.json(await Promise.all(rows.map(withLive)))
  })

  app.post('/api/:cid/shifts/open', async (req, res) => {
    const { user_id, user_name } = req.body || {}
    const opening = num(req.body?.opening_cash)
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    if (opening < 0) return res.status(400).json({ error: 'Opening cash cannot be negative' })
    const [[open]] = await pool.query("SELECT id FROM shifts WHERE company_id=? AND user_id=? AND status='open'", [req.params.cid, user_id])
    if (open) return res.status(409).json({ error: 'You already have an open shift' })
    const [r] = await pool.query('INSERT INTO shifts (company_id,user_id,user_name,opening_cash) VALUES (?,?,?,?)', [req.params.cid, user_id, user_name || null, opening])
    const [[s]] = await pool.query('SELECT * FROM shifts WHERE id=?', [r.insertId])
    res.status(201).json(await withLive(s))
  })

  app.post('/api/:cid/shifts/:id/close', async (req, res) => {
    const counted = parseFloat(req.body?.counted_cash)
    if (!Number.isFinite(counted) || counted < 0) return res.status(400).json({ error: 'Enter the cash you counted' })
    const [[s]] = await pool.query("SELECT * FROM shifts WHERE id=? AND company_id=? AND status='open'", [req.params.id, req.params.cid])
    if (!s) return res.status(404).json({ error: 'Open shift not found' })
    const t = await shiftTotals(s)
    const expected = r2(num(s.opening_cash) + t.cash_sales)
    await pool.query(
      `UPDATE shifts SET status='closed', closed_at=NOW(), cash_sales=?, card_sales=?, transfer_sales=?, credit_sales=?, invoice_count=?,
         expected_cash=?, counted_cash=?, difference=?, notes=? WHERE id=?`,
      [t.cash_sales, t.card_sales, t.transfer_sales, t.credit_sales, t.invoice_count, expected, r2(counted), r2(counted - expected),
       String(req.body?.notes || '').slice(0, 300) || null, s.id])
    const [[row]] = await pool.query('SELECT * FROM shifts WHERE id=?', [s.id])
    res.json(row)
  })

  // ── Reports ─────────────────────────────────────────────
  const range = req => {
    const today = new Date().toISOString().slice(0, 10)
    const to = isDate(req.query.to) ? req.query.to : today
    const from = isDate(req.query.from) ? req.query.from : to.slice(0, 8) + '01'
    return { from, to }
  }
  const weekStart = ds => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
  const periodKey = (ds, group) => group === 'month' ? ds.slice(0, 7) : group === 'week' ? weekStart(ds) : ds

  // Profit by service and by day / week / month.
  //   service income = what the shop earns (sales ex-VAT after discount, minus the government fees passed through)
  app.get('/api/:cid/reports/profit', async (req, res) => {
    const { from, to } = range(req)
    const group = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day'
    const [lines] = await pool.query(
      `SELECT DATE_FORMAT(i.issue_date,'%Y-%m-%d') AS d, i.id AS inv, i.discount_amt, l.service_id, l.description,
              l.vat_category, l.quantity, l.line_amount, f.svc_total
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
       JOIN (SELECT invoice_id, SUM(CASE WHEN vat_category<>'O' THEN line_amount ELSE 0 END) AS svc_total FROM invoice_lines GROUP BY invoice_id) f ON f.invoice_id=i.id
       WHERE i.company_id=? AND i.status='posted' AND i.issue_date BETWEEN ? AND ?`, [req.params.cid, from, to])

    const svc = new Map(), per = new Map()
    const bucket = (map, key, init) => { if (!map.has(key)) map.set(key, init()); return map.get(key) }
    const newPer = () => ({ sales: 0, gov: 0, income: 0, invoices: new Set(), opex: 0, gov_paid: 0 })
    for (const l of lines) {
      const amt = num(l.line_amount), isGovLine = l.vat_category === 'O'
      const factor = !isGovLine && num(l.svc_total) > 0 ? 1 - num(l.discount_amt) / num(l.svc_total) : 1
      const net = amt * factor
      const name = String(l.description || '').replace(/\s+—\s+Government fee$/i, '')
      const s = bucket(svc, l.service_id ? 's' + l.service_id : 'n' + name, () => ({ service: name, qty: 0, sales: 0, gov: 0, income: 0 }))
      const p = bucket(per, periodKey(l.d, group), newPer)
      if (isGovLine) { s.gov += amt; s.sales += amt; p.gov += amt; p.sales += amt }
      else { s.qty += num(l.quantity); s.sales += net; s.income += net; p.sales += net; p.income += net }
      p.invoices.add(l.inv)
    }
    // expenses in the period: government-fee payments (what was paid out for customers) vs everyday running costs
    const [exps] = await pool.query(
      "SELECT DATE_FORMAT(expense_date,'%Y-%m-%d') AS d, category, amount FROM expenses WHERE company_id=? AND expense_date BETWEEN ? AND ?", [req.params.cid, from, to])
    let opex = 0, govPaid = 0
    for (const e of exps) {
      const p = bucket(per, periodKey(e.d, group), newPer)
      if (isGov(e.category)) { p.gov_paid += num(e.amount); govPaid += num(e.amount) }
      else { p.opex += num(e.amount); opex += num(e.amount) }
    }
    const by_service = [...svc.values()].map(s => ({ ...s, qty: r2(s.qty), sales: r2(s.sales), gov: r2(s.gov), income: r2(s.income) }))
      .sort((a, b) => b.income - a.income)
    const by_period = [...per.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).map(([period, p]) => ({
      period, invoices: p.invoices.size, sales: r2(p.sales), gov: r2(p.gov), income: r2(p.income),
      gov_paid: r2(p.gov_paid), opex: r2(p.opex), net_profit: r2(p.income - p.opex),
    }))
    const sum = k => r2(by_period.reduce((a, p) => a + p[k], 0))
    res.json({
      from, to, group,
      totals: {
        invoices: new Set(lines.map(l => l.inv)).size, sales: sum('sales'), gov_collected: sum('gov'), service_income: sum('income'),
        operating_expenses: r2(opex), gov_paid: r2(govPaid), gov_balance: r2(sum('gov') - govPaid), net_profit: r2(sum('income') - opex),
      },
      by_service, by_period,
    })
  })

  // Sales, service income and commission per staff member, plus cash differences from their closed shifts
  app.get('/api/:cid/reports/staff', async (req, res) => {
    const { from, to } = range(req)
    const [rows] = await pool.query(
      `SELECT i.created_by AS user_id, MAX(COALESCE(u.name, i.created_by_name, 'Unassigned')) AS name, MAX(COALESCE(u.commission_rate,0)) AS rate,
              COUNT(*) AS invoices, COALESCE(SUM(i.subtotal),0) AS sales, COALESCE(SUM(g.gov),0) AS gov
       FROM invoices i LEFT JOIN users u ON u.id=i.created_by
       LEFT JOIN (SELECT invoice_id, SUM(line_amount) AS gov FROM invoice_lines WHERE vat_category='O' GROUP BY invoice_id) g ON g.invoice_id=i.id
       WHERE i.company_id=? AND i.status='posted' AND i.issue_date BETWEEN ? AND ?
       GROUP BY i.created_by ORDER BY sales DESC`, [req.params.cid, from, to])
    const [sh] = await pool.query(
      `SELECT user_id, COUNT(*) AS shifts, COALESCE(SUM(difference),0) AS diff FROM shifts
       WHERE company_id=? AND status='closed' AND DATE(closed_at) BETWEEN ? AND ? GROUP BY user_id`, [req.params.cid, from, to])
    const diffBy = new Map(sh.map(r => [r.user_id, r]))
    const staff = rows.map(r => {
      const income = r2(num(r.sales) - num(r.gov)), rate = num(r.rate)
      const d = diffBy.get(r.user_id)
      return { user_id: r.user_id, name: r.name, invoices: r.invoices, sales: r2(num(r.sales)), gov: r2(num(r.gov)), service_income: income,
        commission_rate: rate, commission: r2(income * rate / 100), shifts: d ? d.shifts : 0, cash_difference: d ? r2(num(d.diff)) : 0 }
    })
    res.json({ from, to, staff, totals: {
      sales: r2(staff.reduce((a, s) => a + s.sales, 0)), service_income: r2(staff.reduce((a, s) => a + s.service_income, 0)),
      commission: r2(staff.reduce((a, s) => a + s.commission, 0)), cash_difference: r2(staff.reduce((a, s) => a + s.cash_difference, 0)),
    } })
  })

  // What customers still owe: credit sales not yet covered by receipts booked to Accounts Receivable
  app.get('/api/:cid/reports/pending', async (req, res) => {
    const cid = req.params.cid
    const [inv] = await pool.query(
      `SELECT COALESCE(i.customer_id,0) AS customer_id, COALESCE(MAX(i.customer_name),'Walk-in') AS name, SUM(i.total) AS billed,
              MIN(DATE_FORMAT(i.issue_date,'%Y-%m-%d')) AS oldest, MAX(DATEDIFF(CURDATE(), i.issue_date)) AS age_days, COUNT(*) AS invoices,
              MAX(c.phone) AS phone
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
       WHERE i.company_id=? AND i.status='posted' AND i.payment_method='customer_credit'
       GROUP BY COALESCE(i.customer_id,0), LOWER(COALESCE(i.customer_name,''))`, [cid])
    const [rec] = await pool.query(
      `SELECT LOWER(TRIM(v.party)) AS party, SUM(v.amount) AS paid FROM cash_vouchers v
       JOIN chart_of_accounts a ON a.id=v.account_id
       WHERE v.company_id=? AND v.type='bank_receipt' AND a.code='1200' GROUP BY LOWER(TRIM(v.party))`, [cid])
    const paid = new Map(rec.map(r => [r.party, num(r.paid)]))
    let unmatched = rec.reduce((a, r) => a + num(r.paid), 0)
    const customers = inv.map(r => {
      const key = String(r.name || '').toLowerCase().trim()
      const p = paid.get(key) || 0
      if (paid.has(key)) unmatched -= p
      return { customer_id: r.customer_id, name: r.name, invoices: r.invoices, billed: r2(num(r.billed)), paid: r2(p),
        balance: r2(num(r.billed) - p), oldest: r.oldest, age_days: r.age_days, phone: r.phone || null, wa_phone: waPhone(r.phone) }
    }).filter(c => c.balance > 0.004).sort((a, b) => b.balance - a.balance)
    const bucket = (lo, hi) => r2(customers.filter(c => c.age_days >= lo && c.age_days <= hi).reduce((a, c) => a + c.balance, 0))
    res.json({
      customers, total: r2(customers.reduce((a, c) => a + c.balance, 0)),
      ageing: { d0_30: bucket(0, 30), d31_60: bucket(31, 60), d61_plus: bucket(61, 99999) },
      unallocated_receipts: r2(Math.max(unmatched, 0)),
    })
  })

  // automatic WhatsApp reminders: check on start and every 6 hours (only runs when WHATSAPP_* is configured)
  if (waConfigured()) {
    const tick = () => runAutoReminders().then(r => { if (r.sent || r.failed) console.log(`reminders: ${r.sent} sent, ${r.failed} failed`) }).catch(e => console.error('reminders:', e.message))
    setTimeout(tick, 30_000)
    setInterval(tick, 6 * 60 * 60 * 1000)
    console.log('✅ Automatic WhatsApp renewal reminders enabled')
  } else {
    console.log('ℹ️  WhatsApp auto-reminders off (set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to enable); manual one-click reminders work')
  }
}
