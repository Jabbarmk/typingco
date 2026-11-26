// Quotations: real PDF, e-mail with the PDF attached, and a "sent" record (audit trail + status).
import PDFDocument from 'pdfkit'
import nodemailer from 'nodemailer'
import pool from './db.js'

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const money = n => num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// PDF standard fonts only cover Latin text; anything else (e.g. Arabic) would print as garbage, so show "?" instead
const latin = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '?')
const fmtDate = v => {
  if (!v) return '—'
  const d = new Date(v); if (isNaN(d)) return String(v)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}
const dateOnly = v => v instanceof Date ? v.toISOString().slice(0, 10) : v   // DATE columns come back as Date objects

const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
const transport = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : parseInt(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

// Plain e-mail for other parts of the app (e.g. a new company's welcome message). Never throws.
export async function sendMail({ to, subject, text, fromName }) {
  if (!smtpConfigured()) return { sent: false, reason: 'E-mail is not set up on the server (SMTP settings)' }
  try {
    await transport().sendMail({ from: process.env.SMTP_FROM || `"${(fromName || 'TypinGo ERP').replace(/"/g, '')}" <${process.env.SMTP_USER}>`, to, subject, text })
    return { sent: true }
  } catch (e) { return { sent: false, reason: e.message } }
}

async function loadQuote(cid, id) {
  const [[q]] = await pool.query('SELECT * FROM quotations WHERE id=? AND company_id=?', [id, cid])
  if (!q) return null
  const [lines] = await pool.query('SELECT * FROM quotation_lines WHERE quotation_id=? ORDER BY id', [q.id])
  const [[co]] = await pool.query('SELECT name, address, phone, email, trn FROM companies WHERE id=?', [cid])
  const [[ins]] = await pool.query('SELECT logo FROM invoice_settings WHERE company_id=?', [cid]).catch(() => [[null]])
  return { q: { ...q, issue_date: dateOnly(q.issue_date), valid_until: dateOnly(q.valid_until), lines }, co: co || {}, logo: ins && ins.logo || '' }
}

export function buildQuotePdf({ q, co, logo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Quotation ${q.quote_number}`, Author: co.name || '' } })
    const chunks = []
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)

    const ACCENT = '#1d467a', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', SOFT = '#f8fafc'
    const L = 40, R = 555, W = R - L
    const col = { desc: L, qty: L + 262, unit: L + 312, vat: L + 392, amt: L + 432 }   // amt column ends at R

    // ── letterhead ──
    let logoW = 0
    try {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(logo || '')
      if (m) { doc.image(Buffer.from(m[2], 'base64'), L, 40, { fit: [90, 48] }); logoW = 104 }
    } catch (_) { /* unreadable logo: skip it */ }
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(18).text(latin(co.name || 'Quotation'), L + logoW, 42, { width: 300 })
    const meta = [[co.address, co.phone, co.email].filter(Boolean).join('  ·  '), co.trn ? 'TRN: ' + co.trn : ''].filter(Boolean).map(latin).join('\n')
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(meta, L + logoW, doc.y + 2, { width: 290 })
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('QUOTATION', 340, 40, { width: R - 340, align: 'right' })
    doc.fillColor(ACCENT).fontSize(11).text(latin(q.quote_number), 340, 66, { width: R - 340, align: 'right' })
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`Issued: ${fmtDate(q.issue_date)}`, 340, 83, { width: R - 340, align: 'right' })
      .text(`Valid until: ${fmtDate(q.valid_until)}`, 340, 96, { width: R - 340, align: 'right' })
    doc.moveTo(L, 118).lineTo(R, 118).lineWidth(2.5).strokeColor(ACCENT).stroke()

    // ── bill to ──
    let y = 132
    doc.roundedRect(L, y, 260, 74, 6).fill(SOFT)
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text('QUOTATION FOR', L + 12, y + 10)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(latin(q.lead_name || '—'), L + 12, y + 23, { width: 236 })
    const who = [q.lead_company, q.lead_phone, q.lead_email].filter(Boolean).map(latin)
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(who.join('\n'), L + 12, doc.y + 2, { width: 236 })
    y += 92

    // ── line items ──
    const header = yy => {
      doc.rect(L, yy, W, 22).fill(ACCENT)
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5)
      doc.text('DESCRIPTION', col.desc + 8, yy + 7, { width: 240 })
      doc.text('QTY', col.qty, yy + 7, { width: 40, align: 'center' })
      doc.text('UNIT PRICE', col.unit, yy + 7, { width: 76, align: 'right' })
      doc.text('VAT', col.vat, yy + 7, { width: 36, align: 'center' })
      doc.text('AMOUNT', col.amt, yy + 7, { width: R - col.amt - 8, align: 'right' })
      return yy + 22
    }
    y = header(y)
    ;(q.lines || []).forEach((l, i) => {
      const desc = latin(l.description)
      doc.font('Helvetica').fontSize(9.5)
      const h = Math.max(24, doc.heightOfString(desc, { width: 240 }) + 14)
      if (y + h > 740) { doc.addPage(); y = header(40) }
      if (i % 2) doc.rect(L, y, W, h).fill(SOFT)
      doc.fillColor(INK).font('Helvetica').fontSize(9.5)
      doc.text(desc, col.desc + 8, y + 7, { width: 240 })
      doc.text(String(num(l.quantity) % 1 ? num(l.quantity).toFixed(3) : num(l.quantity)), col.qty, y + 7, { width: 40, align: 'center' })
      doc.text(money(l.unit_price), col.unit, y + 7, { width: 76, align: 'right' })
      doc.fillColor(MUTED).text(l.vat_category === 'S' ? '5%' : '0%', col.vat, y + 7, { width: 36, align: 'center' })
      doc.fillColor(INK).font('Helvetica-Bold').text(money(l.line_amount), col.amt, y + 7, { width: R - col.amt - 8, align: 'right' })
      doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.5).strokeColor(LINE).stroke()
      y += h
    })

    // ── totals ──
    if (y + 110 > 760) { doc.addPage(); y = 40 }
    y += 14
    const row = (label, val, opts = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.big ? 13 : 10).fillColor(opts.color || (opts.bold ? INK : MUTED))
      doc.text(label, 340, y, { width: 110 }).text(val, 450, y, { width: R - 450, align: 'right' })
      y += opts.big ? 24 : 17
    }
    row('Subtotal', 'AED ' + money(q.subtotal))
    if (num(q.discount_amt) > 0) row('Discount', '- AED ' + money(q.discount_amt), { color: '#dc2626' })
    row('VAT (5%)', 'AED ' + money(q.vat_amount))
    doc.moveTo(340, y - 2).lineTo(R, y - 2).lineWidth(1).strokeColor(INK).stroke(); y += 6
    row('Total', 'AED ' + money(q.total), { bold: true, big: true, color: ACCENT })

    // ── notes & terms ──
    const block = (title, text) => {
      if (!text) return
      doc.font('Helvetica').fontSize(9)
      const h = doc.heightOfString(latin(text), { width: W - 24 }) + 34
      if (y + h > 770) { doc.addPage(); y = 40 }
      doc.roundedRect(L, y, W, h, 6).lineWidth(0.7).strokeColor(LINE).stroke()
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text(title, L + 12, y + 10)
      doc.fillColor('#334155').font('Helvetica').fontSize(9).text(latin(text), L + 12, y + 22, { width: W - 24, lineGap: 2 })
      y += h + 10
    }
    y += 14
    block('NOTES', q.notes)
    block('TERMS & CONDITIONS', q.terms_text)

    // ── footer + page numbers ──
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc.page.margins.bottom = 0          // the footer sits inside the bottom margin; without this pdfkit adds blank pages
      doc.moveTo(L, 790).lineTo(R, 790).lineWidth(0.5).strokeColor(LINE).stroke()
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`This quotation is valid until ${fmtDate(q.valid_until)}. Prices may change after the validity date.`, L, 797, { width: W - 60, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, R - 60, 797, { width: 60, align: 'right', lineBreak: false })
    }
    doc.end()
  })
}

const fileName = q => `Quotation-${q.quote_number}.pdf`

async function recordSent(cid, q, channel, userId, extra = {}) {
  let uid = null
  if (userId) { const [[u]] = await pool.query('SELECT id FROM users WHERE id=?', [userId]); uid = u ? u.id : null }
  await pool.query(
    "INSERT INTO audit_logs (user_id,company_id,action,target,result,meta) VALUES (?,?,'quotation.send',?, 'success', ?)",
    [uid, cid, q.quote_number, JSON.stringify({ quotation_id: q.id, channel, to: q.lead_name, ...extra })])
  // a draft becomes "sent" only once it has really gone out
  if (q.status === 'draft') await pool.query("UPDATE quotations SET status='sent' WHERE id=? AND company_id=? AND status='draft'", [q.id, cid])
}

export function registerQuotes(app) {
  app.get('/api/:cid/mail/status', (req, res) => res.json({ smtp_enabled: smtpConfigured() }))

  app.get('/api/:cid/quotations/:id/pdf', async (req, res) => {
    const data = await loadQuote(req.params.cid, req.params.id)
    if (!data) return res.status(404).json({ error: 'Not found' })
    const pdf = await buildQuotePdf(data)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
      'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fileName(data.q)}"` })
    res.send(pdf)
  })

  // The customer has been sent the quotation by WhatsApp / mail client / download: record it and mark it Sent
  app.post('/api/:cid/quotations/:id/sent', async (req, res) => {
    const data = await loadQuote(req.params.cid, req.params.id)
    if (!data) return res.status(404).json({ error: 'Not found' })
    const channel = ['whatsapp', 'whatsapp_pdf', 'email_client', 'pdf'].includes(req.body?.channel) ? req.body.channel : 'other'
    await recordSent(req.params.cid, data.q, channel, req.body?.user_id)
    res.json({ ok: true })
  })

  app.post('/api/:cid/quotations/:id/email', async (req, res) => {
    if (!smtpConfigured()) return res.status(503).json({ error: 'E-mail sending is not set up on the server yet' })
    const to = String(req.body?.to || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid e-mail address' })
    const data = await loadQuote(req.params.cid, req.params.id)
    if (!data) return res.status(404).json({ error: 'Not found' })
    const { q, co } = data
    const message = String(req.body?.message || '').slice(0, 4000) ||
      `Dear ${q.lead_name || 'Customer'},\n\nPlease find our quotation ${q.quote_number} attached.\n\nKind regards,\n${co.name || ''}`
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    try {
      await transport().sendMail({
        from: process.env.SMTP_FROM || `"${(co.name || 'Quotation').replace(/"/g, '')}" <${process.env.SMTP_USER}>`,
        replyTo: co.email || undefined, to,
        subject: `Quotation ${q.quote_number}${co.name ? ' — ' + co.name : ''}`,
        text: message, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(message)}</div>`,
        attachments: [{ filename: fileName(q), content: await buildQuotePdf(data), contentType: 'application/pdf' }],
      })
    } catch (e) { return res.status(502).json({ error: 'The e-mail could not be sent: ' + e.message }) }
    await recordSent(req.params.cid, q, 'email', req.body?.user_id, { email: to })
    res.json({ ok: true })
  })
}
