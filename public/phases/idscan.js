// Reads the ID number and expiry date off a photo of an ID (Emirates ID, passport, visa, licence, labour card).
//   IDScan.parse(text, kind)  – pure: finds the number and expiry in OCR text (testable on its own)
//   IDScan.readFile(file)     – OCR in the browser (Tesseract.js, loaded on first use); the picture never leaves the computer
// The result is only ever a suggestion: the screens put it in editable fields and the person checks it.
(function (root) {
  'use strict'
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
  const pad = n => String(n).padStart(2, '0')

  function toISO(y, m, d) {
    y = +y; m = +m; d = +d
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
    const dt = new Date(y, m - 1, d)
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
  }
  // OCR mixes up look-alike characters inside numbers: O→0, I/l/|→1, S→5, B→8
  const digits = s => String(s).replace(/[Oo]/g, '0').replace(/[Il|!]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/\D/g, '')

  // every date in the text, with where it was found
  function findDates(text) {
    const t = text.replace(/[0-9OoIl|SB]{1,4}\s*[\/\-.]\s*[0-9OoIl|SB]{1,2}\s*[\/\-.]\s*[0-9OoIl|SB]{1,4}/g, m => m.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'))
    const out = []
    let m
    const a = /(?<!\d)(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})(?!\d)/g
    while ((m = a.exec(t))) { let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; const iso = toISO(m[3], mo, d); if (iso) out.push({ iso, at: m.index, len: m[0].length }) }
    const b = /(?<!\d)(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/g
    while ((m = b.exec(t))) { const iso = toISO(m[1], m[2], m[3]); if (iso && !out.some(o => Math.abs(o.at - m.index) < 3)) out.push({ iso, at: m.index, len: m[0].length }) }
    const c = /(?<!\d)(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*,?\s*(\d{4})(?!\d)/gi
    while ((m = c.exec(t))) { const iso = toISO(m[3], MONTHS[m[2].toLowerCase()], m[1]); if (iso) out.push({ iso, at: m.index, len: m[0].length }) }
    return out.sort((x, y) => x.at - y.at)
  }

  // Emirates ID: 784-YYYY-NNNNNNN-C
  function findEmiratesId(text) {
    const m = /7\s*8\s*4\s*[-–—_.\s]*([0-9OIlSB|]{4})\s*[-–—_.\s]*([0-9OIlSB|]{7})\s*[-–—_.\s]*([0-9OIlSB|])(?![0-9])/.exec(text)
    if (!m) return null
    const y = digits(m[1])
    if (y.length !== 4 || +y < 1900 || +y > 2100) return null
    return `784-${y}-${digits(m[2])}-${digits(m[3])}`
  }

  // passport / visa machine-readable lines (the "<<<" lines at the bottom)
  function findMRZ(text) {
    const lines = text.toUpperCase().split(/\r?\n/).map(l => l.replace(/\s+/g, '').replace(/[«‹]/g, '<')).filter(l => l.length >= 30 && /</.test(l))
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const m = /^([A-Z0-9<]{9})([0-9OIl<])([A-Z<]{3})([0-9OIlSB]{6})([0-9OIlSB<])([MF<])([0-9OIlSB]{6})/.exec(l)
      if (!m) continue
      const exp = digits(m[7])
      const iso = toISO(2000 + +exp.slice(0, 2), exp.slice(2, 4), exp.slice(4, 6))
      const first = (lines[i - 1] || '')[0]
      return { number: m[1].replace(/</g, ''), expiry: iso, kind: first === 'V' ? 'Visa Copy' : 'Passport Copy' }
    }
    return null
  }

  const LABEL = /(expiry|expires|expiration|expire|exp\.?\s*date|date\s*of\s*expiry|valid\s*(?:until|till|to|thru)|valid\s*up\s*to|تاريخ\s*الانتهاء|انتهاء)/ig

  function labelledExpiry(text, dates) {
    let m
    LABEL.lastIndex = 0
    while ((m = LABEL.exec(text))) {
      const end = m.index + m[0].length
      const after = dates.find(d => d.at >= end - 3 && d.at <= end + 70)
      if (after) return after.iso
      const before = [...dates].reverse().find(d => d.at + d.len <= m.index + 3 && d.at >= m.index - 45)
      if (before) return before.iso
    }
    return null
  }

  const KIND_PATTERNS = {
    'Passport Copy': [/passport\s*(?:no|number|n[°o])\.?[:\s#]*([A-Z]{0,2}\d{6,9})/i],
    'Visa Copy': [/(?:u\.?i\.?d\.?|file|visa|permit)(?:\s*(?:no|number|n[°o])\.?)?\s*[:#]?\s*([0-9][0-9\/\- ]{5,20}[0-9])/i],
    'Trade Licence': [/licen[cs]e\s*(?:no|number|n[°o])\.?[:\s#]*([A-Z0-9][A-Z0-9\-\/]{3,20})/i],
    'Labour Card': [/(?:card|person|labou?r)\s*(?:no|number|code)\.?[:\s#]*(\d{6,14})/i],
  }

  // text → { number, expiry, kind, kindFromImage, found }
  function parse(text, kindHint) {
    text = String(text || '')
    const dates = findDates(text)
    const res = { number: null, expiry: null, kind: kindHint || null, kindFromImage: false, dates: dates.map(d => d.iso) }

    const eid = findEmiratesId(text)
    const mrz = findMRZ(text)
    if (eid) { res.number = eid; res.kind = 'Emirates ID'; res.kindFromImage = true }
    else if (mrz) { res.number = mrz.number; res.kind = mrz.kind; res.kindFromImage = true; res.expiry = mrz.expiry }

    if (!res.number) {
      for (const [kind, pats] of Object.entries(KIND_PATTERNS)) {
        if (kindHint && kind !== kindHint) continue
        for (const re of pats) { const m = re.exec(text); if (m) { res.number = m[1].trim().replace(/\s+/g, ' '); res.kind = kind; break } }
        if (res.number) break
      }
    }

    if (!res.expiry) res.expiry = labelledExpiry(text, dates)
    // Emirates ID back: birth, issue and expiry dates; the expiry is the latest one
    if (!res.expiry && res.kind === 'Emirates ID' && dates.length >= 2) res.expiry = dates.map(d => d.iso).sort().pop()
    if (!res.expiry && res.kind === 'Emirates ID' && dates.length === 1 && dates[0].iso > new Date().toISOString().slice(0, 10)) res.expiry = dates[0].iso
    res.found = { number: !!res.number, expiry: !!res.expiry }
    return res
  }

  // several pictures of one document (front and back): keep whatever each one found
  function merge(list) {
    const out = { number: null, expiry: null, kind: null, kindFromImage: false, found: { number: false, expiry: false } }
    for (const r of list) {
      if (!out.number && r.number) out.number = r.number
      if (r.expiry && (!out.expiry || r.expiry > out.expiry)) out.expiry = r.expiry
      if (r.kindFromImage && !out.kindFromImage) { out.kind = r.kind; out.kindFromImage = true }
      else if (!out.kind && r.kind) out.kind = r.kind
    }
    out.found = { number: !!out.number, expiry: !!out.expiry }
    return out
  }

  // ───────── reading the picture (browser only) ─────────
  let tessLoading = null
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve()
    if (tessLoading) return tessLoading
    tessLoading = new Promise((ok, bad) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
      s.onload = () => ok(); s.onerror = () => { tessLoading = null; bad(new Error('offline')) }
      document.head.appendChild(s)
    })
    return tessLoading
  }

  // scale up, grey and stretch the contrast: ID cards are small, glossy photos
  async function prepare(file, rotate) {
    let bmp
    try { bmp = await createImageBitmap(file) } catch (_) {
      bmp = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file) })
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight
    const scale = Math.min(Math.max(2000 / Math.max(w, h), 0.6), 2.5)
    const cw = Math.round(w * scale), ch = Math.round(h * scale)
    const cv = document.createElement('canvas')
    cv.width = rotate ? ch : cw; cv.height = rotate ? cw : ch
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
    if (rotate) { g.translate(cv.width, 0); g.rotate(Math.PI / 2) }
    g.drawImage(bmp, 0, 0, cw, ch)
    const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data, hist = new Uint32Array(256)
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = d[i + 1] = d[i + 2] = v; hist[v]++ }
    const total = cv.width * cv.height; let acc = 0, lo = 0, hi = 255
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break } }
    const span = Math.max(hi - lo, 40)
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v }
    g.putImageData(img, 0, 0)
    return cv
  }

  // → { text, result } ; onStatus(message) reports progress
  async function readFile(file, kindHint, onStatus) {
    if (!/^image\//.test(file.type)) throw new Error('not-image')
    onStatus && onStatus('Loading the reader…')
    await loadTesseract()
    const logger = m => { if (onStatus && m.status === 'recognizing text') onStatus(`Reading… ${Math.round((m.progress || 0) * 100)}%`) }
    let text = '', result
    for (const rotate of [false, true]) {
      const cv = await prepare(file, rotate)
      const { data } = await root.Tesseract.recognize(cv, 'eng', { logger })
      text = data.text || ''
      result = parse(text, kindHint)
      if (result.found.number || result.found.expiry) break          // good enough: otherwise try the picture turned sideways
    }
    return { text, result }
  }

  const api = { parse, merge, findDates, readFile, loadTesseract }
  root.IDScan = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
