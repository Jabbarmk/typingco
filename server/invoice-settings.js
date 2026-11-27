// Per-company invoice template settings (template choice, editable texts, PAID stamp, logo)
import pool from './db.js'

export const TEMPLATES = ['classic', 'boxed', 'bilingual']

// Editable text fields and their max lengths (anything else sent by the client is ignored)
const TEXT_FIELDS = {
  title_en: 120, title_ar: 120, address_ar: 250, phone_ar: 60, signatory: 120,
  note_en: 300, note_ar: 300, footer_promo: 250, footer_line: 300, stamp_text: 20,
  company_ar: 150,
}
const BOOL_FIELDS = ['show_stamp', 'stamp_hide_credit']

export async function ensureInvoiceSettingsSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS invoice_settings (
    company_id INT PRIMARY KEY,
    template   VARCHAR(30) NOT NULL DEFAULT 'classic',
    config     TEXT NULL,
    logo       MEDIUMTEXT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  )`)
}

function parseConfig(row) {
  try { return row && row.config ? JSON.parse(row.config) : {} } catch { return {} }
}
function publicRow(row) {
  return { template: row ? row.template : 'classic', config: parseConfig(row), logo: row && row.logo ? row.logo : '' }
}

export function registerInvoiceSettings(app) {
  app.get('/api/:cid/invoice-settings', async (req, res) => {
    const [[row]] = await pool.query('SELECT * FROM invoice_settings WHERE company_id=?', [req.params.cid])
    res.json(publicRow(row))
  })

  // Body: { template?, config?, logo? }  — logo: data URL, '' to remove, undefined to keep
  app.put('/api/:cid/invoice-settings', async (req, res) => {
    const cid = req.params.cid
    const [[co]] = await pool.query('SELECT id FROM companies WHERE id=?', [cid])
    if (!co) return res.status(404).json({ error: 'Company not found' })
    const [[cur]] = await pool.query('SELECT * FROM invoice_settings WHERE company_id=?', [cid])
    const b = req.body || {}

    let template = cur ? cur.template : 'classic'
    if (b.template !== undefined) {
      if (!TEMPLATES.includes(b.template)) return res.status(400).json({ error: 'Unknown template' })
      template = b.template
    }

    let config = parseConfig(cur)
    if (b.config && typeof b.config === 'object') {
      const next = { ...config }
      for (const [k, max] of Object.entries(TEXT_FIELDS)) if (typeof b.config[k] === 'string') next[k] = b.config[k].slice(0, max)
      for (const k of BOOL_FIELDS) if (typeof b.config[k] === 'boolean') next[k] = b.config[k]
      config = next
    }

    let logo = cur ? cur.logo : null
    if (b.logo !== undefined) {
      if (b.logo === '' || b.logo === null) logo = null
      else if (typeof b.logo === 'string' && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(b.logo)) {
        if (b.logo.length > 2_000_000) return res.status(413).json({ error: 'Logo is too large (max about 1.5 MB)' })
        logo = b.logo
      } else return res.status(400).json({ error: 'Logo must be a PNG, JPG, WEBP or SVG image' })
    }

    await pool.query(
      `INSERT INTO invoice_settings (company_id, template, config, logo) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE template=VALUES(template), config=VALUES(config), logo=VALUES(logo)`,
      [cid, template, JSON.stringify(config), logo])
    const [[row]] = await pool.query('SELECT * FROM invoice_settings WHERE company_id=?', [cid])
    res.json(publicRow(row))
  })
}
