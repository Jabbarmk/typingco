// Roles & permissions. A role is a named set of permissions; every user has one.
// (The browser uses the permission list to decide which screens and buttons a person sees.)
import pool from './db.js'

export const PERMISSIONS = [
  ['Sales',          'pos',            'Make sales (POS)'],
  ['Sales',          'quotations',     'Create and send quotations'],
  ['Sales',          'sales_view',     'See invoices'],
  ['Sales',          'sales_edit',     'Edit or void invoices'],
  ['Customers',      'customers_view', 'See customers'],
  ['Customers',      'customers_edit', 'Add and edit customers'],
  ['Customers',      'customers_delete', 'Delete customers'],
  ['Work',           'applications',   'Manage applications'],
  ['Work',           'documents_view', 'See customer documents'],
  ['Work',           'documents_edit', 'Upload documents'],
  ['Work',           'documents_delete', 'Delete documents'],
  ['Work',           'renewals',       'Renewals and notifications'],
  ['Work',           'services_edit',  'Edit services and prices'],
  ['Money',          'expenses',       'Add and edit expenses'],
  ['Money',          'accounting',     'See accounting'],
  ['Money',          'vat',            'VAT / tax'],
  ['Money',          'reports',        'Reports'],
  ['Money',          'profit',         'Profit and what customers owe'],
  ['Cash and staff', 'cash_own',       'Own shift and cash drawer'],
  ['Cash and staff', 'staff_report',   'All staff sales and commission'],
  ['Administration', 'settings',       'Company settings and invoice templates'],
  ['Administration', 'users_manage',   'Manage users and roles'],
  ['Administration', 'einvoice',       'E-Invoice'],
].map(([group, id, label]) => ({ group, id, label }))

const ALL = PERMISSIONS.map(p => p.id)
const DEFAULTS = [
  { name: 'Admin', base: 'admin', is_system: 1, description: 'Full access, including users and settings', permissions: ALL },
  { name: 'Manager', base: 'manager', is_system: 1, description: 'Everything except managing users and roles', permissions: ALL.filter(p => p !== 'users_manage') },
  { name: 'Operator', base: 'operator', is_system: 1, description: 'Front desk: sales, customers, applications and their own shift',
    permissions: ['pos', 'quotations', 'sales_view', 'customers_view', 'customers_edit', 'applications', 'documents_view', 'documents_edit', 'renewals', 'cash_own'] },
  { name: 'Accountant', base: 'operator', is_system: 0, description: 'Books and reports only: no selling, no settings',
    permissions: ['sales_view', 'customers_view', 'documents_view', 'expenses', 'accounting', 'vat', 'reports', 'profit', 'staff_report'] },
]
const BASE_ROLE_NAME = { admin: 'Admin', manager: 'Manager', operator: 'Operator' }

const parse = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a.filter(p => ALL.includes(p)) : [] } catch { return [] } }
const clean = list => [...new Set((Array.isArray(list) ? list : []).filter(p => ALL.includes(p)))]

// the built-in roles exist for every company (created the first time they are needed)
export async function ensureRoles(cid) {
  const [have] = await pool.query('SELECT name FROM roles WHERE company_id=?', [cid])
  if (have.length) return
  for (const d of DEFAULTS)
    await pool.query('INSERT IGNORE INTO roles (company_id,name,description,base,permissions,is_system) VALUES (?,?,?,?,?,?)',
      [cid, d.name, d.description, d.base, JSON.stringify(d.permissions), d.is_system])
}

// what a user may do: their role's list; users without a role fall back to the built-in role for their type
export async function permissionsFor(userId) {
  const [[u]] = await pool.query('SELECT id, role, role_id, company_id FROM users WHERE id=?', [userId])
  if (!u) return null
  if (u.role === 'superadmin') return { role_id: null, role_name: 'Super Admin', base: 'admin', permissions: ALL }
  if (u.company_id) await ensureRoles(u.company_id)
  let role
  if (u.role_id) [[role]] = await pool.query('SELECT * FROM roles WHERE id=? AND company_id=?', [u.role_id, u.company_id])
  if (!role) [[role]] = await pool.query('SELECT * FROM roles WHERE company_id=? AND name=?', [u.company_id, BASE_ROLE_NAME[u.role] || 'Operator'])
  return { role_id: role ? role.id : null, role_name: role ? role.name : u.role, base: role ? role.base : u.role, permissions: role ? parse(role.permissions) : [] }
}

// Resolve a role id for a user being saved. Returns { role_id, base } or an error string.
export async function resolveRole(cid, roleId) {
  if (!roleId) return { role_id: null, base: null }
  const [[r]] = await pool.query('SELECT id, base FROM roles WHERE id=? AND company_id=?', [roleId, cid])
  return r ? { role_id: r.id, base: r.base } : { error: 'That role does not exist' }
}

// At least one active admin must always remain, or nobody could manage users again.
export async function lastAdminGuard(cid, exceptUserId) {
  const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE company_id=? AND role='admin' AND is_active=1 AND id<>?", [cid, exceptUserId])
  return r.n === 0
}

export function registerRoles(app) {
  const shape = (r, count) => ({ id: r.id, name: r.name, description: r.description, base: r.base, is_system: !!r.is_system, permissions: parse(r.permissions), users: count || 0 })

  app.get('/api/:cid/roles', async (req, res) => {
    await ensureRoles(req.params.cid)
    const [rows] = await pool.query('SELECT * FROM roles WHERE company_id=? ORDER BY is_system DESC, id', [req.params.cid])
    const [cnt] = await pool.query(
      `SELECT COALESCE(u.role_id, r.id) AS rid, COUNT(*) AS n FROM users u
       LEFT JOIN roles r ON r.company_id=u.company_id AND u.role_id IS NULL AND r.name = CASE u.role WHEN 'admin' THEN 'Admin' WHEN 'manager' THEN 'Manager' ELSE 'Operator' END
       WHERE u.company_id=? AND u.role<>'superadmin' GROUP BY rid`, [req.params.cid])
    const by = new Map(cnt.map(c => [c.rid, c.n]))
    res.json({ permissions: PERMISSIONS, roles: rows.map(r => shape(r, by.get(r.id))) })
  })

  app.post('/api/:cid/roles', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60)
    if (!name) return res.status(400).json({ error: 'Give the role a name' })
    await ensureRoles(req.params.cid)
    const base = req.body?.base === 'manager' ? 'manager' : 'operator'    // custom roles are never "admin"
    try {
      const [r] = await pool.query('INSERT INTO roles (company_id,name,description,base,permissions,is_system) VALUES (?,?,?,?,?,0)',
        [req.params.cid, name, String(req.body?.description || '').slice(0, 200) || null, base, JSON.stringify(clean(req.body?.permissions).filter(p => p !== 'users_manage'))])
      const [[row]] = await pool.query('SELECT * FROM roles WHERE id=?', [r.insertId])
      res.status(201).json(shape(row))
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A role with that name already exists' }); throw e }
  })

  app.patch('/api/:cid/roles/:id', async (req, res) => {
    const [[role]] = await pool.query('SELECT * FROM roles WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
    if (!role) return res.status(404).json({ error: 'Role not found' })
    const upd = {}
    if (req.body?.description !== undefined) upd.description = String(req.body.description || '').slice(0, 200) || null
    if (!role.is_system && req.body?.name !== undefined) { const n = String(req.body.name).trim().slice(0, 60); if (!n) return res.status(400).json({ error: 'Give the role a name' }); upd.name = n }
    if (req.body?.permissions !== undefined) {
      if (role.name === 'Admin' && role.is_system) return res.status(400).json({ error: 'The Admin role always has every permission' })
      let perms = clean(req.body.permissions)
      if (role.base !== 'admin') perms = perms.filter(p => p !== 'users_manage')      // only Admin can manage users
      upd.permissions = JSON.stringify(perms)
    }
    if (!Object.keys(upd).length) return res.status(400).json({ error: 'Nothing to change' })
    try {
      await pool.query(`UPDATE roles SET ${Object.keys(upd).map(k => k + '=?').join(',')} WHERE id=?`, [...Object.values(upd), role.id])
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A role with that name already exists' }); throw e }
    const [[row]] = await pool.query('SELECT * FROM roles WHERE id=?', [role.id])
    res.json(shape(row))
  })

  app.delete('/api/:cid/roles/:id', async (req, res) => {
    const [[role]] = await pool.query('SELECT * FROM roles WHERE id=? AND company_id=?', [req.params.id, req.params.cid])
    if (!role) return res.status(404).json({ error: 'Role not found' })
    if (role.is_system) return res.status(400).json({ error: 'Built-in roles cannot be deleted' })
    const [[u]] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE role_id=?', [role.id])
    if (u.n) return res.status(409).json({ error: `${u.n} user${u.n === 1 ? ' has' : 's have'} this role. Give them another role first.` })
    await pool.query('DELETE FROM roles WHERE id=?', [role.id])
    res.json({ ok: true })
  })

  // the logged-in person's permissions (the browser hides what they may not use)
  app.get('/api/:cid/me/permissions', async (req, res) => {
    const p = await permissionsFor(req.query.user_id)
    if (!p) return res.status(404).json({ error: 'User not found' })
    res.json(p)
  })
}
