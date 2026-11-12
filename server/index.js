import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import pool from './db.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// ─── AUTH ──────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const [[user]] = await pool.query(
    `SELECT u.id,u.name,u.email,u.password,u.role,u.is_active,u.company_id,
            c.name AS company_name, c.status AS company_status
     FROM users u LEFT JOIN companies c ON u.company_id=c.id
     WHERE u.email=?`, [email])
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })
  if (!user.is_active) return res.status(403).json({ error: 'Account is inactive' })
  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' })
  if (user.company_id && user.company_status === 'suspended')
    return res.status(403).json({ error: 'Company account is suspended — contact support' })
  // Update last_login
  await pool.query('UPDATE users SET last_login=NOW() WHERE id=?', [user.id])
  res.json({
    id:           user.id,
    name:         user.name,
    email:        user.email,
    role:         user.role,
    company_id:   user.company_id,
    company_name: user.company_name,
  })
})

app.post('/api/auth/logout', (req, res) => res.json({ ok: true }))

// ─── Health ────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'alnoor_erp', time: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── SUPER ADMIN DASHBOARD ─────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  const [[companies]]   = await pool.query('SELECT COUNT(*) AS total FROM companies')
  const [[active]]      = await pool.query("SELECT COUNT(*) AS total FROM companies WHERE status='active'")
  const [[trial]]       = await pool.query("SELECT COUNT(*) AS total FROM companies WHERE status='trial'")
  const [[suspended]]   = await pool.query("SELECT COUNT(*) AS total FROM companies WHERE status='suspended'")
  const [[revenue]]     = await pool.query(`
    SELECT COALESCE(SUM(p.price_monthly),0) AS mrr
    FROM companies c JOIN plans p ON c.plan_id=p.id WHERE c.status='active'`)
  res.json({
    totalCompanies: companies.total,
    active: active.total,
    trial: trial.total,
    suspended: suspended.total,
    mrr: parseFloat(revenue.mrr),
  })
})

// ─── COMPANIES ─────────────────────────────────────────────
app.get('/api/companies', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.*, p.name AS plan_name, p.price_monthly
    FROM companies c LEFT JOIN plans p ON c.plan_id=p.id
    ORDER BY c.created_at DESC`)
  res.json(rows)
})

app.post('/api/companies', async (req, res) => {
  const { name, name_ar, trn, cr_number, email, phone, address, emirate, plan_id, status, trial_ends_at } = req.body
  const [r] = await pool.query(
    `INSERT INTO companies (name,name_ar,trn,cr_number,email,phone,address,emirate,plan_id,status,trial_ends_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [name, name_ar||null, trn||null, cr_number||null, email, phone||null, address||null, emirate||'Dubai', plan_id||null, status||'trial', trial_ends_at||null]
  )
  const [[company]] = await pool.query('SELECT * FROM companies WHERE id=?', [r.insertId])
  res.status(201).json(company)
})

app.get('/api/companies/:id', async (req, res) => {
  const [[row]] = await pool.query(
    'SELECT c.*, p.name AS plan_name FROM companies c LEFT JOIN plans p ON c.plan_id=p.id WHERE c.id=?',
    [req.params.id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.patch('/api/companies/:id', async (req, res) => {
  const fields = Object.keys(req.body).map(k => `${k}=?`).join(',')
  const vals   = [...Object.values(req.body), req.params.id]
  await pool.query(`UPDATE companies SET ${fields} WHERE id=?`, vals)
  const [[row]] = await pool.query('SELECT * FROM companies WHERE id=?', [req.params.id])
  res.json(row)
})

// ─── PLANS ─────────────────────────────────────────────────
app.get('/api/plans', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM plans WHERE is_active=1 ORDER BY price_monthly')
  res.json(rows)
})

// ─── SUBSCRIPTIONS ─────────────────────────────────────────
app.get('/api/subscriptions', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT s.*, c.name AS company_name, p.name AS plan_name
    FROM subscriptions s
    JOIN companies c ON s.company_id=c.id
    JOIN plans p ON s.plan_id=p.id
    ORDER BY s.created_at DESC`)
  res.json(rows)
})

app.post('/api/subscriptions', async (req, res) => {
  const { company_id, plan_id, billing_cycle, amount, starts_at, ends_at } = req.body
  const [r] = await pool.query(
    'INSERT INTO subscriptions (company_id,plan_id,billing_cycle,amount,status,starts_at,ends_at) VALUES (?,?,?,?,\'active\',?,?)',
    [company_id, plan_id, billing_cycle||'monthly', amount, starts_at, ends_at||null])
  res.status(201).json({ id: r.insertId })
})

// ─── USERS ─────────────────────────────────────────────────
const USER_SELECT = `SELECT u.id,u.name,u.email,u.role,u.is_active,u.last_login,u.created_at,
  u.company_id,u.phone,u.department,u.job_title,c.name AS company_name
  FROM users u LEFT JOIN companies c ON u.company_id=c.id`

app.get('/api/users', async (req, res) => {
  const { company_id } = req.query
  let sql = USER_SELECT
  const params = []
  if (company_id) { sql += ' WHERE u.company_id=?'; params.push(company_id) }
  sql += ' ORDER BY u.name'
  const [rows] = await pool.query(sql, params)
  res.json(rows)
})

app.get('/api/users/:id', async (req, res) => {
  const [[row]] = await pool.query(USER_SELECT + ' WHERE u.id=?', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.post('/api/users', async (req, res) => {
  const { name, email, password, role, company_id, is_active, phone, department, job_title } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' })
  const hash = await bcrypt.hash(password, 10)
  try {
    const [r] = await pool.query(
      'INSERT INTO users (name,email,password,role,company_id,is_active,phone,department,job_title) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, email, hash, role||'operator', company_id||null, is_active===false ? 0 : 1,
       phone||null, department||null, job_title||null])
    const [[row]] = await pool.query(USER_SELECT + ' WHERE u.id=?', [r.insertId])
    res.status(201).json(row)
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' })
    throw e
  }
})

app.patch('/api/users/:id', async (req, res) => {
  const { name, email, password, role, company_id, is_active, phone, department, job_title } = req.body
  const updates = {}
  if (name !== undefined)       updates.name       = name
  if (email !== undefined)      updates.email      = email
  if (role !== undefined)       updates.role       = role
  if (company_id !== undefined) updates.company_id = company_id || null
  if (is_active !== undefined)  updates.is_active  = is_active ? 1 : 0
  if (phone !== undefined)      updates.phone      = phone || null
  if (department !== undefined) updates.department = department || null
  if (job_title !== undefined)  updates.job_title  = job_title || null
  if (password) updates.password = await bcrypt.hash(password, 10)
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const fields = Object.keys(updates).map(k => `${k}=?`).join(',')
  await pool.query(`UPDATE users SET ${fields} WHERE id=?`, [...Object.values(updates), req.params.id])
  const [[row]] = await pool.query(USER_SELECT + ' WHERE u.id=?', [req.params.id])
  res.json(row)
})

app.delete('/api/users/:id', async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id])
  res.json({ ok: true })
})

// ─── AUDIT LOGS ────────────────────────────────────────────
app.get('/api/audit', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT a.*, u.name AS user_name
    FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id
    ORDER BY a.created_at DESC LIMIT 100`)
  res.json(rows)
})

app.post('/api/audit', async (req, res) => {
  const { user_id, company_id, action, target, ip_address, result, meta } = req.body
  await pool.query(
    'INSERT INTO audit_logs (user_id,company_id,action,target,ip_address,result,meta) VALUES (?,?,?,?,?,?,?)',
    [user_id||null, company_id||null, action, target||null, ip_address||null, result||'success', JSON.stringify(meta||{})])
  res.status(201).json({ ok: true })
})

// ═══════════════════════════════════════════════════════════
// TYPING CENTRE ERP (company-scoped, :cid = company_id)
// ═══════════════════════════════════════════════════════════

// ─── CUSTOMERS ─────────────────────────────────────────────
app.get('/api/:cid/customers', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM customers WHERE company_id=? ORDER BY name', [req.params.cid])
  res.json(rows)
})

app.post('/api/:cid/customers', async (req, res) => {
  const { name, phone, email, nationality, id_type, id_number, emirate, customer_type, trn, notes } = req.body
  const [r] = await pool.query(
    'INSERT INTO customers (company_id,name,phone,email,nationality,id_type,id_number,emirate,customer_type,trn,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [req.params.cid, name, phone||null, email||null, nationality||null, id_type||'emirates_id', id_number||null, emirate||'Dubai', customer_type||'individual', trn||null, notes||null])
  const [[row]] = await pool.query('SELECT * FROM customers WHERE id=?', [r.insertId])
  res.status(201).json(row)
})

// ─── SERVICES ──────────────────────────────────────────────
app.get('/api/:cid/services', async (req, res) => {
  const all = req.query.all === '1'
  const [rows] = await pool.query(
    all
      ? 'SELECT * FROM services WHERE company_id=? ORDER BY category,name'
      : 'SELECT * FROM services WHERE company_id=? AND is_active=1 ORDER BY category,name',
    [req.params.cid])
  res.json(rows)
})

app.post('/api/:cid/services', async (req, res) => {
  const { name, category, unit_price, vat_category, is_active, icon } = req.body
  if (!name || unit_price === undefined) return res.status(400).json({ error: 'name and unit_price required' })
  const [r] = await pool.query(
    'INSERT INTO services (company_id,name,category,unit_price,vat_category,is_active,icon) VALUES (?,?,?,?,?,?,?)',
    [req.params.cid, name, category||'Other', unit_price, vat_category||'S', is_active===false?0:1, icon||'📄'])
  const [[row]] = await pool.query('SELECT * FROM services WHERE id=?', [r.insertId])
  res.status(201).json(row)
})

app.patch('/api/:cid/services/:id', async (req, res) => {
  const allowed = ['name','category','unit_price','vat_category','is_active','icon']
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const fields = Object.keys(updates).map(k => `${k}=?`).join(',')
  await pool.query(`UPDATE services SET ${fields} WHERE id=? AND company_id=?`, [...Object.values(updates), req.params.id, req.params.cid])
  const [[row]] = await pool.query('SELECT * FROM services WHERE id=?', [req.params.id])
  res.json(row)
})

app.delete('/api/:cid/services/:id', async (req, res) => {
  const hard = req.query.hard === '1'
  if (hard) {
    await pool.query('DELETE FROM services WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  } else {
    await pool.query('UPDATE services SET is_active=0 WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  }
  res.json({ ok: true })
})

// ─── CUSTOMERS PATCH/DELETE ────────────────────────────────
app.patch('/api/:cid/customers/:id', async (req, res) => {
  const allowed = ['name','phone','email','nationality','id_type','id_number','emirate','customer_type','trn','notes']
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const fields = Object.keys(updates).map(k => `${k}=?`).join(',')
  await pool.query(`UPDATE customers SET ${fields} WHERE id=? AND company_id=?`, [...Object.values(updates), req.params.id, req.params.cid])
  const [[row]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id])
  res.json(row)
})

app.delete('/api/:cid/customers/:id', async (req, res) => {
  await pool.query('DELETE FROM customers WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  res.json({ ok: true })
})

// ─── INVOICES ──────────────────────────────────────────────
app.get('/api/:cid/invoices', async (req, res) => {
  const { status, from, to, limit = 50 } = req.query
  let sql  = 'SELECT i.*, c.name AS customer_full_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id WHERE i.company_id=?'
  const params = [req.params.cid]
  if (status) { sql += ' AND i.status=?'; params.push(status) }
  if (from)   { sql += ' AND i.issue_date>=?'; params.push(from) }
  if (to)     { sql += ' AND i.issue_date<=?'; params.push(to) }
  sql += ' ORDER BY i.created_at DESC LIMIT ?'
  params.push(parseInt(limit))
  const [rows] = await pool.query(sql, params)
  res.json(rows)
})

app.get('/api/:cid/invoices/:id', async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM invoices WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  if (!inv) return res.status(404).json({ error: 'Not found' })
  const [lines] = await pool.query('SELECT * FROM invoice_lines WHERE invoice_id=?', [inv.id])
  res.json({ ...inv, lines })
})

app.post('/api/:cid/invoices', async (req, res) => {
  const { invoice_number, type, customer_id, customer_name, customer_trn,
          issue_date, supply_date, subtotal, discount_amt, vat_amount, total,
          payment_method, notes, lines } = req.body
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [r] = await conn.query(
      `INSERT INTO invoices (company_id,invoice_number,type,customer_id,customer_name,customer_trn,
        issue_date,supply_date,subtotal,discount_amt,vat_amount,total,payment_method,notes,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted')`,
      [req.params.cid, invoice_number, type||'tax_invoice', customer_id||null, customer_name||null,
       customer_trn||null, issue_date, supply_date||issue_date,
       subtotal, discount_amt||0, vat_amount, total, payment_method||'cash', notes||null])
    if (lines?.length) {
      const lineVals = lines.map(l => [r.insertId, l.service_id||null, l.description, l.quantity||1,
        l.unit_price, l.vat_category||'S', l.vat_rate||0.05, l.line_amount, l.vat_amount||0])
      await conn.query(
        'INSERT INTO invoice_lines (invoice_id,service_id,description,quantity,unit_price,vat_category,vat_rate,line_amount,vat_amount) VALUES ?',
        [lineVals])
    }
    await conn.commit()
    const [[inv]] = await conn.query('SELECT * FROM invoices WHERE id=?', [r.insertId])
    res.status(201).json(inv)
  } catch (e) {
    await conn.rollback()
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
})

// Invoice stats for ERP dashboard
app.get('/api/:cid/invoices/stats/summary', async (req, res) => {
  const cid = req.params.cid
  const [[today]]   = await pool.query(`SELECT COALESCE(SUM(total),0) AS amount, COUNT(*) AS count FROM invoices WHERE company_id=? AND issue_date=CURDATE() AND status='posted'`, [cid])
  const [[month]]   = await pool.query(`SELECT COALESCE(SUM(total),0) AS amount FROM invoices WHERE company_id=? AND MONTH(issue_date)=MONTH(NOW()) AND YEAR(issue_date)=YEAR(NOW()) AND status='posted'`, [cid])
  const [[vatMonth]]= await pool.query(`SELECT COALESCE(SUM(vat_amount),0) AS amount FROM invoices WHERE company_id=? AND MONTH(issue_date)=MONTH(NOW()) AND YEAR(issue_date)=YEAR(NOW()) AND status='posted'`, [cid])
  const [[custCount]]= await pool.query(`SELECT COUNT(*) AS count FROM customers WHERE company_id=?`, [cid])
  res.json({
    todayAmount:   parseFloat(today.amount),
    todayCount:    today.count,
    monthAmount:   parseFloat(month.amount),
    vatMonth:      parseFloat(vatMonth.amount),
    customerCount: custCount.count,
  })
})

// ─── APPLICATIONS ──────────────────────────────────────────
app.get('/api/:cid/applications', async (req, res) => {
  const { status } = req.query
  let sql = `SELECT a.*, c.name AS customer_full_name FROM applications a
             LEFT JOIN customers c ON a.customer_id=c.id WHERE a.company_id=?`
  const params = [req.params.cid]
  if (status) { sql += ' AND a.status=?'; params.push(status) }
  sql += ' ORDER BY a.created_at DESC'
  const [rows] = await pool.query(sql, params)
  res.json(rows)
})

app.post('/api/:cid/applications', async (req, res) => {
  const { app_number, customer_id, customer_name, service_type, priority, govt_fee, service_fee, notes, assigned_to, expected_date } = req.body
  // Auto-generate app_number if not provided
  let ref = app_number
  if (!ref) {
    const [[{ maxId }]] = await pool.query('SELECT COALESCE(MAX(id),0) AS maxId FROM applications WHERE company_id=?', [req.params.cid])
    ref = 'APP-' + String(maxId + 1).padStart(4, '0')
  }
  const [r] = await pool.query(
    `INSERT INTO applications (company_id,app_number,customer_id,customer_name,service_type,priority,govt_fee,service_fee,notes,assigned_to,expected_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [req.params.cid, ref, customer_id||null, customer_name||null, service_type, priority||'normal', govt_fee||0, service_fee||0, notes||null, assigned_to||null, expected_date||null])
  const [[row]] = await pool.query('SELECT * FROM applications WHERE id=?', [r.insertId])
  res.status(201).json(row)
})

app.patch('/api/:cid/applications/:id', async (req, res) => {
  const { status, note, changed_by, govt_ref, assigned_to, expected_date } = req.body
  const [[old]] = await pool.query('SELECT status FROM applications WHERE id=?', [req.params.id])
  await pool.query(
    `UPDATE applications SET status=?,
      govt_ref=COALESCE(?,govt_ref),
      assigned_to=COALESCE(?,assigned_to),
      expected_date=COALESCE(?,expected_date),
      updated_at=NOW()
     WHERE id=? AND company_id=?`,
    [status, govt_ref||null, assigned_to||null, expected_date||null, req.params.id, req.params.cid])
  if (old) {
    await pool.query(
      'INSERT INTO application_history (application_id,from_status,to_status,note,changed_by) VALUES (?,?,?,?,?)',
      [req.params.id, old.status, status, note||null, changed_by||null])
  }
  const [[row]] = await pool.query('SELECT * FROM applications WHERE id=?', [req.params.id])
  res.json(row)
})

// ─── ACCOUNTING ────────────────────────────────────────────
app.get('/api/:cid/accounts', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM chart_of_accounts WHERE company_id=? AND is_active=1 ORDER BY code', [req.params.cid])
  res.json(rows)
})

app.post('/api/:cid/accounts', async (req, res) => {
  const { code, name, type } = req.body
  if (!code || !name || !type) return res.status(400).json({ error: 'code, name, type required' })
  try {
    const [r] = await pool.query(
      'INSERT INTO chart_of_accounts (company_id,code,name,type) VALUES (?,?,?,?)',
      [req.params.cid, code, name, type])
    const [[row]] = await pool.query('SELECT * FROM chart_of_accounts WHERE id=?', [r.insertId])
    res.status(201).json(row)
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Account code already exists' })
    throw e
  }
})

// Journal — with full lines
app.get('/api/:cid/journal', async (req, res) => {
  const [entries] = await pool.query(
    'SELECT * FROM journal_entries WHERE company_id=? ORDER BY entry_date DESC, id DESC LIMIT 100',
    [req.params.cid])
  if (!entries.length) return res.json([])
  const ids = entries.map(e => e.id)
  const [lines] = await pool.query(
    `SELECT jl.*, ca.code, ca.name AS account_name FROM journal_lines jl
     JOIN chart_of_accounts ca ON jl.account_id=ca.id
     WHERE jl.je_id IN (?)`, [ids])
  const lineMap = {}
  lines.forEach(l => { if (!lineMap[l.je_id]) lineMap[l.je_id] = []; lineMap[l.je_id].push(l) })
  res.json(entries.map(e => ({ ...e, lines: lineMap[e.id] || [] })))
})

app.post('/api/:cid/journal', async (req, res) => {
  const { description, entry_date, reference, lines } = req.body
  if (!lines?.length) return res.status(400).json({ error: 'lines required' })
  const totalDebit  = lines.reduce((s, l) => s + parseFloat(l.debit  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) return res.status(400).json({ error: 'Debits must equal credits' })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[{jeNum}]] = await conn.query(
      "SELECT CONCAT('JE-', LPAD(COALESCE(MAX(id),0)+1,4,'0')) AS jeNum FROM journal_entries WHERE company_id=?",
      [req.params.cid])
    const [r] = await conn.query(
      'INSERT INTO journal_entries (company_id,je_number,description,entry_date,reference,status) VALUES (?,?,?,?,?,\'posted\')',
      [req.params.cid, jeNum, description, entry_date, reference||null])
    const lineVals = lines.map(l => [r.insertId, l.account_id, l.description||null, parseFloat(l.debit||0), parseFloat(l.credit||0)])
    await conn.query('INSERT INTO journal_lines (je_id,account_id,description,debit,credit) VALUES ?', [lineVals])
    await conn.commit()
    const [[je]] = await conn.query('SELECT * FROM journal_entries WHERE id=?', [r.insertId])
    const [jlines] = await conn.query(
      'SELECT jl.*,ca.code,ca.name AS account_name FROM journal_lines jl JOIN chart_of_accounts ca ON jl.account_id=ca.id WHERE jl.je_id=?',
      [r.insertId])
    res.status(201).json({ ...je, lines: jlines })
  } catch(e) {
    await conn.rollback()
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
})

// ─── EXPENSES ──────────────────────────────────────────────
app.get('/api/:cid/expenses', async (req, res) => {
  const { from, to } = req.query
  let sql = 'SELECT * FROM expenses WHERE company_id=?'
  const params = [req.params.cid]
  if (from) { sql += ' AND expense_date>=?'; params.push(from) }
  if (to)   { sql += ' AND expense_date<=?'; params.push(to) }
  sql += ' ORDER BY expense_date DESC, id DESC LIMIT 200'
  const [rows] = await pool.query(sql, params)
  res.json(rows)
})

app.post('/api/:cid/expenses', async (req, res) => {
  const { expense_date, category, description, amount, vat_input, supplier, reference, account_id } = req.body
  if (!description || !amount) return res.status(400).json({ error: 'description and amount required' })
  const [r] = await pool.query(
    'INSERT INTO expenses (company_id,expense_date,category,description,amount,vat_input,supplier,reference,account_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [req.params.cid, expense_date||new Date().toISOString().slice(0,10), category||'General',
     description, amount, vat_input||0, supplier||null, reference||null, account_id||null])
  const [[row]] = await pool.query('SELECT * FROM expenses WHERE id=?', [r.insertId])
  res.status(201).json(row)
})

app.patch('/api/:cid/expenses/:id', async (req, res) => {
  const allowed = ['expense_date','category','description','amount','vat_input','supplier','reference','account_id']
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const fields = Object.keys(updates).map(k => `${k}=?`).join(',')
  await pool.query(`UPDATE expenses SET ${fields} WHERE id=? AND company_id=?`, [...Object.values(updates), req.params.id, req.params.cid])
  const [[row]] = await pool.query('SELECT * FROM expenses WHERE id=?', [req.params.id])
  res.json(row)
})

app.delete('/api/:cid/expenses/:id', async (req, res) => {
  await pool.query('DELETE FROM expenses WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  res.json({ ok: true })
})

// Accounting summary (AR, cash totals)
app.get('/api/:cid/accounting/summary', async (req, res) => {
  const cid = req.params.cid
  const [[ar]] = await pool.query(
    "SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE company_id=? AND status='posted'", [cid])
  const [[paid]] = await pool.query(
    "SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE company_id=? AND status='posted' AND payment_method IN ('cash','card','bank_transfer')", [cid])
  const [[expTotal]] = await pool.query(
    'SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(vat_input),0) AS vat FROM expenses WHERE company_id=?', [cid])
  const [[vatOut]] = await pool.query(
    "SELECT COALESCE(SUM(vat_amount),0) AS vat FROM invoices WHERE company_id=? AND status='posted'", [cid])
  res.json({
    arTotal:    parseFloat(ar.total),
    paidTotal:  parseFloat(paid.total),
    expTotal:   parseFloat(expTotal.total),
    inputVat:   parseFloat(expTotal.vat),
    outputVat:  parseFloat(vatOut.vat),
  })
})

// ─── LEADS ─────────────────────────────────────────────────
app.get('/api/:cid/leads', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM leads WHERE company_id=? ORDER BY created_at DESC', [req.params.cid])
  res.json(rows)
})

app.post('/api/:cid/leads', async (req, res) => {
  const { name, phone, email, company_name, source, notes } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  const [r] = await pool.query(
    'INSERT INTO leads (company_id,name,phone,email,company_name,source,notes) VALUES (?,?,?,?,?,?,?)',
    [req.params.cid, name, phone||null, email||null, company_name||null, source||'walk_in', notes||null])
  res.status(201).json({ id: r.insertId })
})

app.patch('/api/:cid/leads/:id', async (req, res) => {
  const { name, phone, email, company_name, source, notes } = req.body
  await pool.query(
    'UPDATE leads SET name=?,phone=?,email=?,company_name=?,source=?,notes=? WHERE id=? AND company_id=?',
    [name, phone||null, email||null, company_name||null, source||'walk_in', notes||null, req.params.id, req.params.cid])
  res.json({ ok: true })
})

app.delete('/api/:cid/leads/:id', async (req, res) => {
  await pool.query('DELETE FROM leads WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  res.json({ ok: true })
})

// ─── QUOTATIONS ─────────────────────────────────────────────
app.get('/api/:cid/quotations', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM quotations WHERE company_id=? ORDER BY created_at DESC', [req.params.cid])
  res.json(rows)
})

app.get('/api/:cid/quotations/:id', async (req, res) => {
  const [[q]] = await pool.query('SELECT * FROM quotations WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  if (!q) return res.status(404).json({ error: 'Not found' })
  const [lines] = await pool.query('SELECT * FROM quotation_lines WHERE quotation_id=?', [q.id])
  res.json({ ...q, lines })
})

app.post('/api/:cid/quotations', async (req, res) => {
  const cid = req.params.cid
  const { lead_id, lead_name, lead_phone, lead_email, lead_company,
          issue_date, valid_until, notes, lines = [], discount_amt = 0, created_by } = req.body

  // Auto-generate quote number
  const [[{ n }]] = await pool.query('SELECT COUNT(*)+1 AS n FROM quotations WHERE company_id=?', [cid])
  const quote_number = `QT-${new Date().getFullYear()}-${String(n).padStart(4,'0')}`

  let subtotal = 0, vat_amount = 0
  for (const l of lines) {
    const la = parseFloat(l.quantity) * parseFloat(l.unit_price)
    const va = l.vat_category === 'S' ? la * 0.05 : 0
    subtotal += la; vat_amount += va
  }
  const total = subtotal - parseFloat(discount_amt) + vat_amount

  const [r] = await pool.query(
    `INSERT INTO quotations (company_id,quote_number,lead_id,lead_name,lead_phone,lead_email,lead_company,
      issue_date,valid_until,subtotal,discount_amt,vat_amount,total,notes,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [cid, quote_number, lead_id||null, lead_name||null, lead_phone||null, lead_email||null, lead_company||null,
     issue_date, valid_until||null, subtotal, discount_amt, vat_amount, total, notes||null, created_by||null])

  const qid = r.insertId
  for (const l of lines) {
    const la = parseFloat(l.quantity) * parseFloat(l.unit_price)
    const va = l.vat_category === 'S' ? la * 0.05 : 0
    await pool.query(
      `INSERT INTO quotation_lines (quotation_id,service_id,description,quantity,unit_price,vat_category,vat_rate,line_amount,vat_amount)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [qid, l.service_id||null, l.description, l.quantity, l.unit_price, l.vat_category||'S',
       l.vat_category==='S'?0.05:0, la, va])
  }
  res.status(201).json({ id: qid, quote_number })
})

app.patch('/api/:cid/quotations/:id', async (req, res) => {
  const { status, invoice_id, lead_name, lead_phone, lead_email, lead_company,
          valid_until, notes, discount_amt, lines } = req.body
  const fields = [], vals = []
  if (status       !== undefined) { fields.push('status=?');       vals.push(status) }
  if (invoice_id   !== undefined) { fields.push('invoice_id=?');   vals.push(invoice_id) }
  if (lead_name    !== undefined) { fields.push('lead_name=?');    vals.push(lead_name) }
  if (lead_phone   !== undefined) { fields.push('lead_phone=?');   vals.push(lead_phone) }
  if (lead_email   !== undefined) { fields.push('lead_email=?');   vals.push(lead_email) }
  if (lead_company !== undefined) { fields.push('lead_company=?'); vals.push(lead_company) }
  if (valid_until  !== undefined) { fields.push('valid_until=?');  vals.push(valid_until) }
  if (notes        !== undefined) { fields.push('notes=?');        vals.push(notes) }

  if (lines !== undefined) {
    let subtotal = 0, vat_amount = 0
    await pool.query('DELETE FROM quotation_lines WHERE quotation_id=?', [req.params.id])
    for (const l of lines) {
      const la = parseFloat(l.quantity) * parseFloat(l.unit_price)
      const va = l.vat_category === 'S' ? la * 0.05 : 0
      subtotal += la; vat_amount += va
      await pool.query(
        `INSERT INTO quotation_lines (quotation_id,service_id,description,quantity,unit_price,vat_category,vat_rate,line_amount,vat_amount)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.params.id, l.service_id||null, l.description, l.quantity, l.unit_price,
         l.vat_category||'S', l.vat_category==='S'?0.05:0, la, va])
    }
    const disc = parseFloat(discount_amt||0)
    fields.push('subtotal=?','vat_amount=?','total=?','discount_amt=?')
    vals.push(subtotal, vat_amount, subtotal - disc + vat_amount, disc)
  }

  if (fields.length) {
    vals.push(req.params.id, req.params.cid)
    await pool.query(`UPDATE quotations SET ${fields.join(',')} WHERE id=? AND company_id=?`, vals)
  }
  res.json({ ok: true })
})

app.delete('/api/:cid/quotations/:id', async (req, res) => {
  await pool.query('DELETE FROM quotation_lines WHERE quotation_id=?', [req.params.id])
  await pool.query('DELETE FROM quotations WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
  res.json({ ok: true })
})

// ─── VAT / E-INVOICE ───────────────────────────────────────
app.get('/api/:cid/einvoice/queue', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT q.*, i.invoice_number, i.total, i.customer_name
    FROM einvoice_queue q JOIN invoices i ON q.invoice_id=i.id
    WHERE q.company_id=? ORDER BY q.created_at DESC`, [req.params.cid])
  res.json(rows)
})

app.get('/api/:cid/einvoice/logs', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM einvoice_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 100',
    [req.params.cid])
  res.json(rows)
})

app.post('/api/:cid/einvoice/queue', async (req, res) => {
  const { invoice_id } = req.body
  const [r] = await pool.query(
    'INSERT INTO einvoice_queue (company_id,invoice_id,status,attempts) VALUES (?,?,\'pending\',0)',
    [req.params.cid, invoice_id])
  await pool.query(
    "UPDATE invoices SET einvoice_status='queued' WHERE id=?", [invoice_id])
  res.status(201).json({ id: r.insertId })
})

// Mock submit (sandbox)
app.post('/api/:cid/einvoice/submit/:qid', async (req, res) => {
  const qid = req.params.qid
  const uuid = 'ZTC-' + Math.random().toString(36).slice(2, 10).toUpperCase()
  await pool.query(
    "UPDATE einvoice_queue SET status='cleared', asp_uuid=?, last_attempt=NOW(), attempts=attempts+1 WHERE id=?",
    [uuid, qid])
  const [[q]] = await pool.query('SELECT * FROM einvoice_queue WHERE id=?', [qid])
  await pool.query(
    "UPDATE invoices SET einvoice_status='cleared', einvoice_uuid=? WHERE id=?",
    [uuid, q.invoice_id])
  await pool.query(
    "INSERT INTO einvoice_logs (company_id,invoice_id,level,message) VALUES (?,?,'INFO',?)",
    [req.params.cid, q.invoice_id, `CLEARED — UUID: ${uuid} (sandbox mock)`])
  res.json({ uuid, status: 'cleared' })
})

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`✅ ALNOOR API running on http://localhost:${PORT}`))
