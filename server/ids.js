// A customer's ID (number + expiry) lives in two places: on the customer record and as a document (so it shows up in
// Documents, Renewals and the reminders). These helpers keep the two in step, whichever one is edited.
import pool from './db.js'

// customer id_type  <->  document name
export const ID_DOC_NAME = { emirates_id: 'Emirates ID', passport: 'Passport Copy', visa: 'Visa Copy' }
const DOC_ID_TYPE = Object.fromEntries(Object.entries(ID_DOC_NAME).map(([k, v]) => [v, k]))

const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v))
export const cleanDate = v => validDate(v) ? String(v) : null
export const cleanNumber = v => { const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60); return s || null }

// customer saved with an ID expiry → make sure the matching document exists with the same number and expiry
export async function syncIdDocument(cid, customerId, userId) {
  const [[c]] = await pool.query(
    "SELECT id_type, id_number, DATE_FORMAT(id_expiry,'%Y-%m-%d') AS id_expiry FROM customers WHERE id=? AND company_id=?", [customerId, cid])
  const name = c && ID_DOC_NAME[c.id_type]
  if (!name) return
  const [[doc]] = await pool.query('SELECT id FROM documents WHERE company_id=? AND customer_id=? AND name=? ORDER BY id DESC LIMIT 1', [cid, customerId, name])
  if (doc) {
    await pool.query('UPDATE documents SET expires_at=?, doc_number=? WHERE id=?', [c.id_expiry, c.id_number, doc.id])
  } else if (c.id_expiry) {          // only create one when there is an expiry to track
    let uid = null
    if (userId) { const [[u]] = await pool.query('SELECT id FROM users WHERE id=?', [userId]); uid = u ? u.id : null }
    await pool.query('INSERT INTO documents (company_id,customer_id,name,file_path,doc_number,expires_at,uploaded_by) VALUES (?,?,?,?,?,?,?)',
      [cid, customerId, name, '', c.id_number, c.id_expiry, uid])
  }
}

// ID document uploaded with a number / expiry → copy them onto the customer
export async function syncCustomerFromDoc(cid, customerId, docName, number, expiry) {
  const idType = DOC_ID_TYPE[docName]
  if (!idType || (!number && !expiry)) return
  const sets = ['id_type=?'], vals = [idType]
  if (number) { sets.push('id_number=?'); vals.push(number) }
  if (expiry) { sets.push('id_expiry=?'); vals.push(expiry) }
  await pool.query(`UPDATE customers SET ${sets.join(',')} WHERE id=? AND company_id=?`, [...vals, customerId, cid])
}
