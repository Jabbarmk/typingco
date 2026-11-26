// Connects the ID reader (idscan.js) to the screens: the Upload Documents dialog and the customer form.
// A reading only ever fills EMPTY boxes (or boxes that an earlier reading filled); anything the person typed is left alone.
(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const show = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const say = (el, html) => { if (el) el.innerHTML = html }
  const busy = (el, msg) => say(el, `<span class="spin"></span>${esc(msg)}`)

  // fill a box unless the person has typed something there
  function fill(el, value) {
    if (!el || !value) return false
    if (el.value && el.dataset.auto !== '1') return false
    el.value = value; el.dataset.auto = '1'
    return true
  }

  function summary(r, kind) {
    const bits = []
    if (r.number) bits.push(`number <code>${esc(r.number)}</code>`)
    if (r.expiry) bits.push(`expiry <code>${esc(show(r.expiry))}</code>`)
    if (!bits.length) return `<span class="warn">Couldn’t read a number or expiry from the picture.</span> Try a sharper, well-lit photo of the front (number) and back (expiry), or type them in.`
    const missing = !r.number ? 'the number' : !r.expiry ? 'the expiry date' : ''
    return `<span class="ok">Found</span> ${bits.join(' and ')}. Please check ${missing ? `them, and add ${missing}` : 'them'} against the ID.`
  }

  // ── Upload Documents dialog ──
  window.idscanQueue = async function () {
    const status = $('udoc-scan-status')
    if (!$('udoc-ocr') || !$('udoc-ocr').checked) return
    const fresh = docQueue.filter(d => !d._scanned)
    if (!fresh.length) return
    const images = fresh.filter(d => /^image\//.test(d.file.type))
    fresh.forEach(d => { d._scanned = true })
    if (!images.length) { say(status, 'PDF files can’t be read automatically — type the number and expiry above.'); return }
    try {
      for (const d of images) {
        d._ocr = (await IDScan.readFile(d.file, $('udoc-type').value, m => busy(status, `${d.name}: ${m}`))).result
      }
    } catch (e) {
      say(status, `<span class="warn">Couldn’t read the picture automatically</span> ${e.message === 'offline' ? '(the reader needs an internet connection the first time)' : ''}. Type the number and expiry above.`)
      return
    }
    const r = IDScan.merge(docQueue.filter(d => d._ocr).map(d => d._ocr))
    const sel = $('udoc-type')
    // the picture says what it is (e.g. a passport uploaded as "Emirates ID"): switch the type
    let switched = ''
    if (r.kindFromImage && r.kind && sel.value !== r.kind && [...sel.options].some(o => o.value === r.kind || o.text === r.kind)) { sel.value = r.kind; switched = ` It looks like a <b>${esc(r.kind)}</b>, so I changed the type.` }
    fill($('udoc-number'), r.number); fill($('udoc-expiry'), r.expiry)
    say(status, summary(r) + switched)
  }

  // ── customer form ──
  const KIND_TO_TYPE = { 'Emirates ID': 'emirates_id', 'Passport Copy': 'passport', 'Visa Copy': 'visa' }
  const TYPE_TO_KIND = { emirates_id: 'Emirates ID', passport: 'Passport Copy', visa: 'Visa Copy' }

  window.scanCustomerId = async function (input) {
    const files = [...(input.files || [])].filter(f => /^image\//.test(f.type))
    const status = $('nc-scan-status')
    if (!files.length) { say(status, 'Choose a picture (JPG or PNG) of the ID.'); return }
    const out = []
    try {
      for (const f of files) out.push((await IDScan.readFile(f, TYPE_TO_KIND[$('nc-idtype').value] || null, m => busy(status, `${f.name}: ${m}`))).result)
    } catch (e) {
      say(status, `<span class="warn">Couldn’t read the picture automatically</span> ${e.message === 'offline' ? '(the reader needs an internet connection the first time)' : ''}. Type the number and expiry below.`)
      input.value = ''; return
    }
    const r = IDScan.merge(out)
    let switched = ''
    if (r.kindFromImage && KIND_TO_TYPE[r.kind] && $('nc-idtype').value !== KIND_TO_TYPE[r.kind]) { $('nc-idtype').value = KIND_TO_TYPE[r.kind]; switched = ` It looks like a <b>${esc(r.kind)}</b>, so I set the ID type.` }
    fill($('nc-idnum'), r.number); fill($('nc-idexp'), r.expiry)
    say(status, summary(r) + switched)
    input.value = ''
  }
})()
