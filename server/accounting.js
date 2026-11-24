// Accounting engine: auto-posting of sales/expenses/vouchers to the journal,
// general ledger, trial balance, P&L, balance sheet, cash/bank/petty cash, dashboard data.
import pool from './db.js'

// ─── Standard chart of accounts (seeded per company, idempotent) ───────────
export const STD_ACCOUNTS = [
  ['1100', 'Cash',                       'asset'],
  ['1110', 'Bank Account',               'asset'],
  ['1120', 'Petty Cash',                 'asset'],
  ['1200', 'Accounts Receivable',        'asset'],
  ['1300', 'VAT Input (Recoverable)',    'asset'],
  ['2100', 'Accounts Payable',           'liability'],
  ['2200', 'VAT Payable',                'liability'],
  ['3100', 'Owner Equity',               'equity'],
  ['4100', 'Service Revenue',            'revenue'],
  ['4200', 'Govt Fee Pass-through',      'revenue'],
  ['5100', 'Rent Expense',               'expense'],
  ['5200', 'Salaries Expense',           'expense'],
  ['5300', 'Utilities Expense',          'expense'],
  ['5400', 'Office & Admin Expense',     'expense'],
  ['5500', 'Government Fees Expense',    'expense'],
  ['5900', 'General Expenses',           'expense'],
]

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const r2  = v => Math.round(v * 100) / 100
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '')

// Older databases were created from an earlier schema.sql. Add whatever columns the app writes to customers
// (e.g. "Unknown column 'emirate'" made every customer insert fail with HTTP 500).
export async function ensureCustomerColumns(db = pool) {
  const cols = [
    ['phone', 'VARCHAR(30) NULL'], ['email', 'VARCHAR(150) NULL'], ['nationality', 'VARCHAR(60) NULL'],
    ["id_type", "ENUM('emirates_id','passport','visa','other') DEFAULT 'emirates_id'"], ['id_number', 'VARCHAR(50) NULL'],
    ['emirate', "VARCHAR(50) DEFAULT 'Dubai'"], ['customer_type', "ENUM('individual','company','freelancer') DEFAULT 'individual'"],
    ['trn', 'VARCHAR(15) NULL'], ['notes', 'TEXT NULL'],
  ]
  const [have] = await db.query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers'")
  const names = new Set(have.map(r => r.c.toLowerCase()))
  const added = []
  for (const [c, ddl] of cols) {
    if (!names.has(c)) { await db.query(`ALTER TABLE customers ADD COLUMN ${c} ${ddl}`); added.push(c) }
  }
  if (added.length) console.log('customers: added missing columns →', added.join(', '))
  return added
}

// Older production DBs lack some `applications` columns the API writes to.
export async function ensureApplicationColumns(db = pool) {
  const cols = [
    ['customer_name', 'VARCHAR(150) NULL'], ['priority', "ENUM('normal','urgent') DEFAULT 'normal'"],
    ['govt_ref', 'VARCHAR(100) NULL'], ['govt_ref_number', 'VARCHAR(100) NULL'],
    ['govt_fee', 'DECIMAL(10,2) DEFAULT 0'], ['service_fee', 'DECIMAL(10,2) DEFAULT 0'],
    ['assigned_to', 'VARCHAR(100) NULL'], ['expected_date', 'DATE NULL'], ['notes', 'TEXT NULL'],
    ['submitted_at', 'TIMESTAMP NULL'], ['completed_at', 'TIMESTAMP NULL'],
  ]
  const [have] = await db.query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='applications'")
  if (!have.length) return []
  const names = new Set(have.map(r => r.c.toLowerCase()))
  const added = []
  for (const [c, ddl] of cols) {
    if (!names.has(c)) { await db.query(`ALTER TABLE applications ADD COLUMN ${c} ${ddl}`); added.push(c) }
  }
  if (added.length) console.log('applications: added missing columns →', added.join(', '))
  return added
}

export async function ensureAccountingSchema() {
  try { await ensureCustomerColumns() } catch (e) { console.error('ensureCustomerColumns failed:', e.message) }
  try { await ensureApplicationColumns() } catch (e) { console.error('ensureApplicationColumns failed:', e.message) }
  await pool.query(`CREATE TABLE IF NOT EXISTS cash_vouchers (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    company_id   INT NOT NULL,
    voucher_no   VARCHAR(30) NOT NULL,
    type         ENUM('bank_receipt','bank_payment','petty_in','petty_out') NOT NULL,
    voucher_date DATE NOT NULL,
    account_id   INT NOT NULL,
    amount       DECIMAL(12,2) NOT NULL,
    party        VARCHAR(150),
    description  VARCHAR(255),
    reference    VARCHAR(100),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cv (company_id, type),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
  )`)
  const addCol = async (table, col, ddl) => {
    const [[r]] = await pool.query(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, col])
    if (!r.n) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
  }
  await addCol('journal_entries', 'source_type', 'VARCHAR(30) NULL')
  await addCol('journal_entries', 'source_id', 'INT NULL')
  const [[idx]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_entries' AND INDEX_NAME='idx_je_source'")
  if (!idx.n) await pool.query('CREATE INDEX idx_je_source ON journal_entries (company_id, source_type, source_id)')
  // invoices.payment_method must allow 'customer_credit' (the POS offers it). Without it MySQL stores '' and the sale loses its receivable.
  try {
    const [[pm]] = await pool.query(
      "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND COLUMN_NAME='payment_method'")
    if (pm && !/customer_credit/.test(pm.t))
      await pool.query("ALTER TABLE invoices MODIFY payment_method ENUM('cash','card','bank_transfer','customer_credit') DEFAULT 'cash'")
    // blank values can only have come from the rejected 'customer_credit' value
    await pool.query("UPDATE invoices SET payment_method='customer_credit' WHERE payment_method=''")
  } catch (e) { console.error('payment_method enum check failed:', e.message) }
  // customers.customer_type must allow 'freelancer' (the UI offers it)
  try {
    const [[c]] = await pool.query(
      "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='customer_type'")
    if (c && !/freelancer/.test(c.t))
      await pool.query("ALTER TABLE customers MODIFY customer_type ENUM('individual','company','freelancer') DEFAULT 'individual'")
  } catch (e) { console.error('customer_type enum check failed:', e.message) }
}

export async function ensureCoA(cid, db = pool) {
  await db.query('INSERT IGNORE INTO chart_of_accounts (company_id,code,name,type) VALUES ?',
    [STD_ACCOUNTS.map(a => [cid, ...a])])
}

async function acctMap(cid, db = pool) {
  await ensureCoA(cid, db)
  const [rows] = await db.query('SELECT id, code, name, type FROM chart_of_accounts WHERE company_id=?', [cid])
  const byCode = {}, byId = {}
  rows.forEach(r => { byCode[r.code] = r; byId[r.id] = r })
  return { byCode, byId }
}

async function postJournal(db, cid, { date, description, reference, source_type, source_id, lines }) {
  const clean = lines.filter(l => num(l.debit) > 0 || num(l.credit) > 0)
  const dr = r2(clean.reduce((s, l) => s + num(l.debit), 0)), cr = r2(clean.reduce((s, l) => s + num(l.credit), 0))
  if (!clean.length || Math.abs(dr - cr) > 0.01) throw new Error(`Journal not balanced (Dr ${dr} / Cr ${cr})`)
  const [[{ jeNum }]] = await db.query(
    "SELECT CONCAT('JE-', LPAD(COALESCE(MAX(id),0)+1,4,'0')) AS jeNum FROM journal_entries WHERE company_id=?", [cid])
  const [r] = await db.query(
    "INSERT INTO journal_entries (company_id,je_number,description,entry_date,reference,status,source_type,source_id) VALUES (?,?,?,?,?,'posted',?,?)",
    [cid, jeNum, description || null, date, reference || null, source_type || null, source_id || null])
  await db.query('INSERT INTO journal_lines (je_id,account_id,description,debit,credit) VALUES ?',
    [clean.map(l => [r.insertId, l.account_id, l.description || null, r2(num(l.debit)), r2(num(l.credit))])])
  return r.insertId
}

async function removeSource(db, cid, type, id) {
  await db.query('DELETE FROM journal_entries WHERE company_id=? AND source_type=? AND source_id=?', [cid, type, id])
}

// ─── Auto-posting: sales ────────────────────────────────────────────────────
// Dr Cash/Bank/AR (by payment method)   Cr Service Revenue (+ Govt pass-through)   Cr VAT Payable
export async function syncInvoiceJournal(cid, invoiceId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await removeSource(conn, cid, 'invoice', invoiceId)
    const [[inv]] = await conn.query('SELECT * FROM invoices WHERE id=? AND company_id=?', [invoiceId, cid])
    if (inv && inv.status === 'posted' && num(inv.total) > 0) {
      const { byCode } = await acctMap(cid, conn)
      const method = String(inv.payment_method || 'cash').toLowerCase()
      const debitCode = method === 'cash' ? '1100' : (method === 'card' || method === 'bank_transfer') ? '1110' : '1200'
      const total = r2(num(inv.total)), vat = Math.min(r2(num(inv.vat_amount)), total)
      const [[g]] = await conn.query("SELECT COALESCE(SUM(line_amount),0) AS amt FROM invoice_lines WHERE invoice_id=? AND vat_category='O'", [invoiceId])
      const govt = Math.min(r2(num(g.amt)), r2(total - vat))
      const revenue = r2(total - vat - govt)
      const d = await conn.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') AS d", [inv.issue_date]).then(x => x[0][0].d)
      await postJournal(conn, cid, {
        date: d, reference: inv.invoice_number, source_type: 'invoice', source_id: invoiceId,
        description: `Sale ${inv.invoice_number}${inv.customer_name ? ' — ' + inv.customer_name : ''} (${method.replace('_', ' ')})`,
        lines: [
          { account_id: byCode[debitCode].id, debit: total },
          { account_id: byCode['4100'].id, credit: revenue },
          { account_id: byCode['4200'].id, credit: govt },
          { account_id: byCode['2200'].id, credit: vat },
        ],
      })
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); console.error('syncInvoiceJournal:', e.message) }
  finally { conn.release() }
}

// ─── Auto-posting: expenses ─────────────────────────────────────────────────
// Dr Expense (+ VAT Input)   Cr Cash
const EXP_CODE = { rent: '5100', salar: '5200', salary: '5200', utilit: '5300', office: '5400', stationery: '5400', govern: '5500', govt: '5500' }
export async function syncExpenseJournal(cid, expenseId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await removeSource(conn, cid, 'expense', expenseId)
    const [[e]] = await conn.query('SELECT * FROM expenses WHERE id=? AND company_id=?', [expenseId, cid])
    if (e && num(e.amount) > 0) {
      const { byCode, byId } = await acctMap(cid, conn)
      let acc = e.account_id && byId[e.account_id] && byId[e.account_id].type === 'expense' ? byId[e.account_id] : null
      if (!acc) {
        const cat = String(e.category || '').toLowerCase()
        const key = Object.keys(EXP_CODE).find(k => cat.includes(k))
        acc = byCode[key ? EXP_CODE[key] : '5900']
      }
      const amount = r2(num(e.amount)), vat = r2(num(e.vat_input))
      const d = await conn.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') AS d", [e.expense_date]).then(x => x[0][0].d)
      await postJournal(conn, cid, {
        date: d, reference: e.reference, source_type: 'expense', source_id: expenseId,
        description: `Expense: ${e.description}${e.supplier ? ' — ' + e.supplier : ''}`,
        lines: [
          { account_id: acc.id, debit: amount },
          { account_id: byCode['1300'].id, debit: vat },
          { account_id: byCode['1100'].id, credit: r2(amount + vat) },
        ],
      })
    }
    await conn.commit()
  } catch (err) { await conn.rollback(); console.error('syncExpenseJournal:', err.message) }
  finally { conn.release() }
}
export async function removeExpenseJournal(cid, expenseId) { await removeSource(pool, cid, 'expense', expenseId) }

// ─── Balances ───────────────────────────────────────────────────────────────
const DEBIT_NORMAL = t => t === 'asset' || t === 'expense'
async function balancesUpTo(cid, to, from) {
  const sql = `SELECT ca.id, ca.code, ca.name, ca.type,
           COALESCE(SUM(CASE WHEN je.id IS NOT NULL ${to ? 'AND je.entry_date<=?' : ''} ${from ? 'AND je.entry_date>=?' : ''} THEN jl.debit END),0) AS dr,
           COALESCE(SUM(CASE WHEN je.id IS NOT NULL ${to ? 'AND je.entry_date<=?' : ''} ${from ? 'AND je.entry_date>=?' : ''} THEN jl.credit END),0) AS cr
         FROM chart_of_accounts ca
         LEFT JOIN journal_lines jl ON jl.account_id=ca.id
         LEFT JOIN journal_entries je ON je.id=jl.je_id AND je.status='posted'
         WHERE ca.company_id=? AND ca.is_active=1 GROUP BY ca.id, ca.code, ca.name, ca.type ORDER BY ca.code`
  const params = []
  if (to) params.push(to); if (from) params.push(from)
  if (to) params.push(to); if (from) params.push(from)
  params.push(cid)
  const [rows] = await pool.query(sql, params)
  return rows.map(r => {
    const dr = r2(num(r.dr)), cr = r2(num(r.cr))
    return { id: r.id, code: r.code, name: r.name, type: r.type, debit: dr, credit: cr, balance: r2(DEBIT_NORMAL(r.type) ? dr - cr : cr - dr) }
  })
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function registerAccounting(app) {
  // Seed the chart of accounts for the company (idempotent) and return it
  app.get('/api/:cid/accounts', async (req, res) => {
    await ensureCoA(req.params.cid)
    const [rows] = await pool.query('SELECT * FROM chart_of_accounts WHERE company_id=? AND is_active=1 ORDER BY code', [req.params.cid])
    res.json(rows)
  })

  // Back-fill ledger for existing sales/expenses that have no journal entry yet (safe to call repeatedly)
  app.post('/api/:cid/accounting/sync', async (req, res) => {
    const cid = req.params.cid
    await ensureCoA(cid)
    const [inv] = await pool.query(
      `SELECT i.id FROM invoices i WHERE i.company_id=? AND i.status='posted'
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.company_id=i.company_id AND je.source_type='invoice' AND je.source_id=i.id)`, [cid])
    for (const r of inv) await syncInvoiceJournal(cid, r.id)
    const [exp] = await pool.query(
      `SELECT e.id FROM expenses e WHERE e.company_id=?
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.company_id=e.company_id AND je.source_type='expense' AND je.source_id=e.id)`, [cid])
    for (const r of exp) await syncExpenseJournal(cid, r.id)
    res.json({ invoices: inv.length, expenses: exp.length })
  })

  // General ledger for one account with running balance
  app.get('/api/:cid/accounting/ledger', async (req, res) => {
    const cid = req.params.cid
    const accountId = parseInt(req.query.account_id)
    const from = isDate(req.query.from) ? req.query.from : null
    const to   = isDate(req.query.to) ? req.query.to : null
    const [[acc]] = await pool.query('SELECT * FROM chart_of_accounts WHERE id=? AND company_id=?', [accountId, cid])
    if (!acc) return res.status(404).json({ error: 'Account not found' })
    const sign = DEBIT_NORMAL(acc.type) ? 1 : -1
    let opening = 0
    if (from) {
      const [[o]] = await pool.query(
        `SELECT COALESCE(SUM(jl.debit),0) AS dr, COALESCE(SUM(jl.credit),0) AS cr FROM journal_lines jl
         JOIN journal_entries je ON je.id=jl.je_id WHERE jl.account_id=? AND je.company_id=? AND je.status='posted' AND je.entry_date<?`, [accountId, cid, from])
      opening = r2(sign * (num(o.dr) - num(o.cr)))
    }
    let sql = `SELECT DATE_FORMAT(je.entry_date,'%Y-%m-%d') AS date, je.je_number, je.reference, COALESCE(jl.description, je.description) AS description,
                 jl.debit, jl.credit, je.id AS je_id
               FROM journal_lines jl JOIN journal_entries je ON je.id=jl.je_id
               WHERE jl.account_id=? AND je.company_id=? AND je.status='posted'`
    const p = [accountId, cid]
    if (from) { sql += ' AND je.entry_date>=?'; p.push(from) }
    if (to)   { sql += ' AND je.entry_date<=?'; p.push(to) }
    sql += ' ORDER BY je.entry_date, je.id, jl.id'
    const [rows] = await pool.query(sql, p)
    let run = opening, td = 0, tc = 0
    const out = rows.map(r => {
      const dr = num(r.debit), cr = num(r.credit); td += dr; tc += cr
      run = r2(run + sign * (dr - cr))
      return { ...r, debit: dr, credit: cr, balance: run }
    })
    res.json({ account: acc, from, to, opening, rows: out, total_debit: r2(td), total_credit: r2(tc), closing: run })
  })

  app.get('/api/:cid/accounting/trial-balance', async (req, res) => {
    await ensureCoA(req.params.cid)
    const to = isDate(req.query.to) ? req.query.to : today()
    const rows = (await balancesUpTo(req.params.cid, to)).filter(r => r.debit || r.credit)
    // trial balance shows net debit / net credit per account
    const tb = rows.map(r => { const net = r2(r.debit - r.credit); return { ...r, tb_debit: net > 0 ? net : 0, tb_credit: net < 0 ? -net : 0 } })
    // Entries whose debits and credits differ (e.g. legacy/imported data) — they make the books unbalanced
    const [bad] = await pool.query(
      `SELECT je.id, je.je_number, DATE_FORMAT(je.entry_date,'%Y-%m-%d') AS date, LEFT(COALESCE(je.description,''),80) AS description,
              COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
       FROM journal_entries je LEFT JOIN journal_lines jl ON jl.je_id=je.id
       WHERE je.company_id=? AND je.status='posted' AND je.entry_date<=?
       GROUP BY je.id HAVING ABS(COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0)) > 0.01`, [req.params.cid, to])
    res.json({ as_of: to, rows: tb, total_debit: r2(tb.reduce((s, r) => s + r.tb_debit, 0)), total_credit: r2(tb.reduce((s, r) => s + r.tb_credit, 0)),
      unbalanced_entries: bad.map(x => ({ ...x, debit: num(x.debit), credit: num(x.credit) })) })
  })

  app.get('/api/:cid/accounting/pnl', async (req, res) => {
    await ensureCoA(req.params.cid)
    const t = today()
    const from = isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01'
    const to   = isDate(req.query.to) ? req.query.to : t
    const all = await balancesUpTo(req.params.cid, to, from)
    const revenue = all.filter(a => a.type === 'revenue' && (a.debit || a.credit))
    const expenses = all.filter(a => a.type === 'expense' && (a.debit || a.credit))
    const totalRevenue = r2(revenue.reduce((s, a) => s + a.balance, 0))
    const totalExpenses = r2(expenses.reduce((s, a) => s + a.balance, 0))
    res.json({ from, to, revenue, expenses, total_revenue: totalRevenue, total_expenses: totalExpenses, net_profit: r2(totalRevenue - totalExpenses) })
  })

  app.get('/api/:cid/accounting/balance-sheet', async (req, res) => {
    await ensureCoA(req.params.cid)
    const asOf = isDate(req.query.as_of) ? req.query.as_of : today()
    const all = await balancesUpTo(req.params.cid, asOf)
    const pick = t => all.filter(a => a.type === t && (a.debit || a.credit))
    const assets = pick('asset'), liabilities = pick('liability'), equity = pick('equity')
    const earnings = r2(all.filter(a => a.type === 'revenue').reduce((s, a) => s + a.balance, 0) - all.filter(a => a.type === 'expense').reduce((s, a) => s + a.balance, 0))
    const tA = r2(assets.reduce((s, a) => s + a.balance, 0)), tL = r2(liabilities.reduce((s, a) => s + a.balance, 0))
    const tE = r2(equity.reduce((s, a) => s + a.balance, 0) + earnings)
    res.json({ as_of: asOf, assets, liabilities, equity, current_earnings: earnings,
      total_assets: tA, total_liabilities: tL, total_equity: tE, balanced: Math.abs(tA - (tL + tE)) < 0.01 })
  })

  // Cash / bank / petty cash balances
  app.get('/api/:cid/accounting/cash-summary', async (req, res) => {
    await ensureCoA(req.params.cid)
    const all = await balancesUpTo(req.params.cid, null)
    const g = c => (all.find(a => a.code === c) || { balance: 0 }).balance
    res.json({ cash: g('1100'), bank: g('1110'), petty: g('1120') })
  })

  // ─── Vouchers: bank receipts / bank payments / petty cash ────────────────
  const PREFIX = { bank_receipt: 'BR', bank_payment: 'BP', petty_in: 'PCI', petty_out: 'PCO' }

  app.get('/api/:cid/vouchers', async (req, res) => {
    const { type } = req.query
    let sql = `SELECT v.*, DATE_FORMAT(v.voucher_date,'%Y-%m-%d') AS date, ca.code AS account_code, ca.name AS account_name
               FROM cash_vouchers v JOIN chart_of_accounts ca ON ca.id=v.account_id WHERE v.company_id=?`
    const p = [req.params.cid]
    if (type) { sql += ' AND v.type IN (?)'; p.push(String(type).split(',')) }
    sql += ' ORDER BY v.voucher_date DESC, v.id DESC LIMIT 300'
    const [rows] = await pool.query(sql, p)
    res.json(rows)
  })

  app.post('/api/:cid/vouchers', async (req, res) => {
    const cid = req.params.cid
    const { type, voucher_date, account_id, amount, party, description, reference } = req.body || {}
    if (!PREFIX[type]) return res.status(400).json({ error: 'Invalid voucher type' })
    const amt = r2(num(amount))
    if (!(amt > 0)) return res.status(400).json({ error: 'Amount must be greater than zero' })
    const date = isDate(voucher_date) ? voucher_date : today()
    const { byCode, byId } = await acctMap(cid)
    const counter = byId[parseInt(account_id)]
    if (!counter) return res.status(400).json({ error: 'Select an account' })
    const main = (type === 'bank_receipt' || type === 'bank_payment') ? byCode['1110'] : byCode['1120']
    if (counter.id === main.id) return res.status(400).json({ error: `Account cannot be the same as ${main.name}` })
    if (type === 'petty_out') {
      const bal = (await balancesUpTo(cid, null)).find(a => a.code === '1120').balance
      if (amt > bal + 0.001) return res.status(400).json({ error: `Insufficient petty cash — balance is AED ${bal.toFixed(2)}` })
    }
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[n]] = await conn.query(
        "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(voucher_no,'-',-1) AS UNSIGNED)),0)+1 AS n FROM cash_vouchers WHERE company_id=? AND type=?", [cid, type])
      const voucherNo = `${PREFIX[type]}-${String(n.n).padStart(4, '0')}`
      const [r] = await conn.query(
        'INSERT INTO cash_vouchers (company_id,voucher_no,type,voucher_date,account_id,amount,party,description,reference) VALUES (?,?,?,?,?,?,?,?,?)',
        [cid, voucherNo, type, date, counter.id, amt, party || null, description || null, reference || null])
      const label = { bank_receipt: 'Bank receipt', bank_payment: 'Bank payment', petty_in: 'Petty cash top-up', petty_out: 'Petty cash expense' }[type]
      const lines = (type === 'bank_receipt' || type === 'petty_in')
        ? [{ account_id: main.id, debit: amt }, { account_id: counter.id, credit: amt }]
        : [{ account_id: counter.id, debit: amt }, { account_id: main.id, credit: amt }]
      await postJournal(conn, cid, {
        date, reference: voucherNo, source_type: 'voucher', source_id: r.insertId,
        description: `${label} ${voucherNo}${party ? ' — ' + party : ''}${description ? ': ' + description : ''}`, lines,
      })
      await conn.commit()
      const [[row]] = await pool.query("SELECT *, DATE_FORMAT(voucher_date,'%Y-%m-%d') AS date FROM cash_vouchers WHERE id=?", [r.insertId])
      res.status(201).json(row)
    } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }) }
    finally { conn.release() }
  })

  app.delete('/api/:cid/vouchers/:id', async (req, res) => {
    const cid = req.params.cid
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await removeSource(conn, cid, 'voucher', req.params.id)
      await conn.query('DELETE FROM cash_vouchers WHERE id=? AND company_id=?', [req.params.id, cid])
      await conn.commit(); res.json({ ok: true })
    } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }) }
    finally { conn.release() }
  })

  // ─── Dashboard (real data) ───────────────────────────────────────────────
  app.get('/api/:cid/dashboard', async (req, res) => {
    const cid = req.params.cid
    const [week] = await pool.query(
      `SELECT DATE_FORMAT(issue_date,'%Y-%m-%d') AS d, COALESCE(SUM(total),0) AS amount, COUNT(*) AS cnt FROM invoices
       WHERE company_id=? AND status='posted' AND issue_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND issue_date <= CURDATE() GROUP BY d`, [cid])
    const wk = {}; week.forEach(w => { wk[w.d] = { amount: num(w.amount), count: w.cnt } })
    const days = []
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i)
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      days.push({ date: key, label: dt.toLocaleDateString('en-GB', { weekday: 'short' }), amount: (wk[key] || {}).amount || 0, count: (wk[key] || {}).count || 0 })
    }
    const [payments] = await pool.query(
      `SELECT payment_method AS method, COALESCE(SUM(total),0) AS amount, COUNT(*) AS cnt FROM invoices
       WHERE company_id=? AND status='posted' AND MONTH(issue_date)=MONTH(CURDATE()) AND YEAR(issue_date)=YEAR(CURDATE())
       GROUP BY payment_method ORDER BY amount DESC`, [cid])
    const [top] = await pool.query(
      `SELECT il.description AS name, SUM(il.quantity) AS qty, SUM(il.line_amount) AS amount FROM invoice_lines il
       JOIN invoices i ON i.id=il.invoice_id WHERE i.company_id=? AND i.status='posted'
       AND MONTH(i.issue_date)=MONTH(CURDATE()) AND YEAR(i.issue_date)=YEAR(CURDATE())
       GROUP BY il.description ORDER BY amount DESC LIMIT 5`, [cid])
    const [recent] = await pool.query(
      `SELECT id, invoice_number, customer_name, total, status, payment_method FROM invoices WHERE company_id=? ORDER BY created_at DESC, id DESC LIMIT 5`, [cid])
    const [apps] = await pool.query(
      `SELECT a.id, a.app_number, a.service_type, a.status, COALESCE(a.customer_name, c.name) AS customer_name
       FROM applications a LEFT JOIN customers c ON c.id=a.customer_id
       WHERE a.company_id=? AND a.status NOT IN ('completed','rejected') ORDER BY a.created_at DESC LIMIT 5`, [cid])
    const [[outstanding]] = await pool.query(
      "SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE company_id=? AND status='posted' AND payment_method='customer_credit'", [cid])
    res.json({
      week: days, payments: payments.map(p => ({ method: p.method, amount: num(p.amount), count: p.cnt })),
      top: top.map(t => ({ name: t.name, qty: num(t.qty), amount: num(t.amount) })),
      recent: recent.map(r => ({ ...r, total: num(r.total) })), pendingApps: apps, outstanding: num(outstanding.t),
    })
  })
}
