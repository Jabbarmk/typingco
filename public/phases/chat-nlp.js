// The assistant's language engine. Pure functions (no DOM, no network) so it can be tested on its own.
//   parse(text, ctx) -> { intent, score, alts, entities, … }
// Pipeline: normalise → fix spelling → pull out entities (invoice/quotation numbers, services, customers, staff,
// document types, dates…) → mask them → classify what is left against the example phrasings in chat-data.js
// (TF-IDF vectors of words and word pairs, cosine similarity).
(function (root) {
  'use strict'
  const D = root.CHAT_DATA

  // ───────── words ─────────
  const STOP = new Set(('a an the of is are was were am be been being to for in on at by with and or we our us my me i you your it its this that these those ' +
    'please pls can could would will shall do does did have has had just also some all there here so then than about tell show give let get want need like ' +
    'much many what whats which who whom where when why how too very really still yet now ago ' +
    'hey hi hello ok okay yes no').split(' '))
  // words that carry the question type even though they are common
  const KEEP = new Set(['how', 'what', 'who', 'which', 'where', 'when', 'why', 'much', 'many', 'yes', 'no', 'ok', 'okay', 'hi', 'hello', 'hey', 'show', 'give', 'tell', 'get', 'need', 'want'])
  const SYN = {
    sell: 'sale', sells: 'sale', sold: 'sale', selling: 'sale', sales: 'sale', revenue: 'sale', turnover: 'sale', takings: 'sale',
    spend: 'expense', spent: 'expense', spending: 'expense', expenditure: 'expense', expenses: 'expense', costs: 'expense',
    customers: 'customer', clients: 'customer', client: 'customer',
    owe: 'owe', owes: 'owe', owed: 'owe', owing: 'owe', outstanding: 'owe', unpaid: 'owe', dues: 'owe', debtors: 'owe', receivable: 'owe', receivables: 'owe',
    profits: 'profit', profitable: 'profit', margin: 'profit', earn: 'profit', earned: 'profit', earning: 'profit', earnings: 'profit',
    price: 'price', prices: 'price', pricing: 'price', cost: 'price', charge: 'price', charges: 'price', rate: 'price', fee: 'fee', fees: 'fee',
    expire: 'expire', expires: 'expire', expired: 'expire', expiring: 'expire', expiry: 'expire', expiration: 'expire', renew: 'expire', renewal: 'expire', renewals: 'expire', renewed: 'expire',
    remind: 'remind', reminds: 'remind', reminder: 'remind', reminders: 'remind', reminded: 'remind', notify: 'remind', alert: 'remind', alerts: 'remind',
    docs: 'document', doc: 'document', paper: 'document', papers: 'document', paperwork: 'document',
    bill: 'bill', bills: 'bill', billing: 'bill', invoices: 'invoice', quote: 'quotation', quotes: 'quotation', quotations: 'quotation',
    create: 'add', register: 'add', insert: 'add', enter: 'add', record: 'add', log: 'add', make: 'add', put: 'add', save: 'add', start: 'start', begin: 'start',
    launch: 'open', goto: 'open', navigate: 'open', visit: 'open', switch: 'open',
    hi: 'hello', hey: 'hello', hola: 'hello', salam: 'hello', salaam: 'hello', hii: 'hello', helo: 'hello',
    thx: 'thanks', thank: 'thanks', tnx: 'thanks', shukran: 'thanks', cheers: 'thanks', bye: 'bye', goodbye: 'bye', cya: 'bye',
    gov: 'government', govt: 'government', pos: 'pos', staff: 'employee', employees: 'employee', employee: 'employee', cashier: 'employee', salesperson: 'employee', salesman: 'employee',
    commissions: 'commission', shifts: 'shift', drawer: 'drawer', till: 'drawer', applications: 'application', jobs: 'application', job: 'application',
    pending: 'pending', waiting: 'pending', unfinished: 'pending', done: 'done', completed: 'done', finished: 'done', ready: 'done',
    amount: 'amount', total: 'total', totals: 'total', overall: 'total', sum: 'total', recently: 'recent', latest: 'recent', newest: 'recent', previous: 'recent',
  }
  const stem = w => {
    if (w.length <= 3 || /^q_|^ent_|\d/.test(w)) return w
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
    if (/(ses|xes|zes|ches|shes)$/.test(w) && w.length > 5) return w.slice(0, -2)
    if (/ss$|us$|is$/.test(w)) return w
    if (/s$/.test(w)) return w.slice(0, -1)
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3)
    return w
  }
  const canon = w => { const s = SYN[w]; return s !== undefined ? s : stem(w) }

  // ───────── text clean-up ─────────
  function normalise(text) {
    let s = String(text || '').toLowerCase().replace(/[’‘`´]/g, "'")
    s = s.replace(/\bwhat'?s\b/g, 'what is').replace(/\bwho'?s\b/g, 'who is').replace(/\bi'?m\b/g, 'i am').replace(/\bdon'?t\b/g, 'do not')
      .replace(/\bcan'?t\b/g, 'can not').replace(/\bdoesn'?t\b/g, 'does not').replace(/\bisn'?t\b/g, 'is not').replace(/\bhaven'?t\b/g, 'have not')
      .replace(/\b(hasnt|havent|didnt|dont|cant|isnt|doesnt|wont|hadnt|arent|wasnt)\b/g, 'not').replace(/\bit'?s\b/g, 'it is').replace(/\bthat'?s\b/g, 'that is').replace(/\bwe'?re\b/g, 'we are').replace(/'s\b/g, '')
    // common chat shorthand and typos of very short words
    s = s.replace(/\b(hw|hww)\b/g, 'how').replace(/\b(wat|wht|whts|wats)\b/g, 'what').replace(/\b(u|yu)\b/g, 'you').replace(/\bur\b/g, 'your').replace(/\bpls\b/g, 'please')
      .replace(/\b(cust|custs|custmer|custmers)\b/g, 'customer').replace(/\binv\b(?!\s*-?\d)/g, 'invoice').replace(/\bqtn\b/g, 'quotation').replace(/\bamt\b/g, 'amount').replace(/\babt\b/g, 'about').replace(/\bwhos\b/g, 'who is')
    s = s.replace(/&/g, ' and ').replace(/[^a-z0-9_\-\/\.:؀-ۿ ]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()
    return s
  }

  // how-to / explanation questions
  const HOWTO = /\b(how (do|can|should|would|to|does|did|is|are)\b|how to\b|where (do|can|is|are|to|should)\b|steps? (to|for)\b|guide|tutorial|explain|difference between|meaning of|what does .{1,40} mean|why (is|are|can|does|do|did|am|not)\b|what is (a|an|the)? ?(shift|commission|service income|pass through)|setup|set up)\b/
  const NAV_VERB = /\b(open|go to|goto|go|take me|launch|navigate|switch to|bring up|visit)\b/

  // ───────── dates ─────────
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const MON3 = MONTHS.map(m => m.slice(0, 3))
  const pad = n => String(n).padStart(2, '0')
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const monday = d => addDays(d, -((d.getDay() + 6) % 7))
  const monthRange = (y, m) => [new Date(y, m, 1), new Date(y, m + 1, 0)]
  const monthIdx = w => { const i = MONTHS.indexOf(w); return i >= 0 ? i : MON3.indexOf(w.slice(0, 3)) }
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

  function parseDateToken(t, now) {
    let m
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return new Date(+m[1], +m[2] - 1, +m[3])
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t))) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1])
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})$/.exec(t))) return new Date(now.getFullYear(), +m[2] - 1, +m[1])
    if ((m = new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MONTH_RE + '(?:\\s+(\\d{4}))?$').exec(t))) return new Date(m[3] ? +m[3] : now.getFullYear(), monthIdx(m[2]), +m[1])
    if ((m = new RegExp('^' + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$').exec(t))) return new Date(m[3] ? +m[3] : now.getFullYear(), monthIdx(m[1]), +m[2])
    return null
  }
  const DATE_RE = '(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH_RE + '(?:\\s+\\d{4})?|' + MONTH_RE + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+\\d{4})?)'

  // returns { period, rest }: period = {from, to, label} (ISO dates) or null; rest = text with the date words removed
  function parsePeriod(s, now) {
    now = now || new Date()
    let m, r
    const out = (from, to, label, re, found) => ({ period: { from: iso(from), to: iso(to), label }, rest: s.replace(re, ' ').replace(/\s+/g, ' ').trim() })
    if ((m = new RegExp('\\b(?:from|between)\\s+' + DATE_RE + '\\s+(?:to|and|till|until|-)\\s+' + DATE_RE + '\\b').exec(s))) {
      const toks = [...s.matchAll(new RegExp(DATE_RE, 'g'))].map(x => parseDateToken(x[0], now)).filter(Boolean)
      if (toks.length >= 2) return out(toks[0], toks[1], `${iso(toks[0])} to ${iso(toks[1])}`, new RegExp('\\b(?:from|between)\\s+' + DATE_RE + '\\s+(?:to|and|till|until|-)\\s+' + DATE_RE + '\\b'))
    }
    // looking forward (renewals, expiries): "next week", "next month", "next 30 days", "coming month", "soon"
    if ((m = /\b(?:next|coming|upcoming)\s+(\d{1,3})\s+(day|week|month)s?\b/.exec(s))) {
      const n = +m[1], to = m[2] === 'day' ? addDays(now, n) : m[2] === 'week' ? addDays(now, 7 * n) : new Date(now.getFullYear(), now.getMonth() + n, now.getDate())
      return out(now, to, `the next ${n} ${m[2]}${n > 1 ? 's' : ''}`, /\b(?:next|coming|upcoming)\s+\d{1,3}\s+(?:day|week|month)s?\b/)
    }
    if (/\b(next|coming|upcoming)\s+week\b/.test(s)) { const st = addDays(monday(now), 7); return out(st, addDays(st, 6), 'next week', /\b(next|coming|upcoming)\s+week\b/g) }
    if (/\b(next|coming|upcoming)\s+month\b/.test(s)) { const [a, b] = monthRange(now.getFullYear(), now.getMonth() + 1); return out(a, b, 'next month', /\b(next|coming|upcoming)\s+month\b/g) }
    if (/\b(?:soon|shortly)\b/.test(s)) return out(now, addDays(now, 30), 'the next 30 days', /\b(?:soon|shortly)\b/g)
    if ((m = /\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month)s?\b/.exec(s))) {
      const n = +m[1], from = m[2] === 'day' ? addDays(now, -(n - 1)) : m[2] === 'week' ? addDays(now, -(7 * n - 1)) : new Date(now.getFullYear(), now.getMonth() - n, now.getDate() + 1)
      return out(from, now, `the last ${n} ${m[2]}${n > 1 ? 's' : ''}`, /\b(?:last|past|previous)\s+\d{1,3}\s+(?:day|week|month)s?\b/)
    }
    if (/\b(today|tonight|so far|todays|this (morning|afternoon|evening)|right now)\b/.test(s)) return out(now, now, 'today', /\b(today|tonight|so far|todays|this (morning|afternoon|evening)|right now)\b/g)
    if (/\byesterday\b/.test(s)) return out(addDays(now, -1), addDays(now, -1), 'yesterday', /\byesterday\b/g)
    if (/\b(last|previous|past)\s+week\b/.test(s)) { const st = addDays(monday(now), -7); return out(st, addDays(st, 6), 'last week', /\b(last|previous|past)\s+week\b/g) }
    if (/\b(this|current)\s+week\b|\bweek to date\b/.test(s)) return out(monday(now), now, 'this week', /\b(this|current)\s+week\b|\bweek to date\b/g)
    if (/\b(last|previous|past)\s+month\b/.test(s)) { const [a, b] = monthRange(now.getFullYear(), now.getMonth() - 1); return out(a, b, 'last month', /\b(last|previous|past)\s+month\b/g) }
    if (/\b(this|current)\s+month\b|\bmtd\b/.test(s)) { const [a] = monthRange(now.getFullYear(), now.getMonth()); return out(a, now, 'this month', /\b(this|current)\s+month\b|\bmtd\b/g) }
    if (/\b(last|previous)\s+quarter\b/.test(s)) { const q = Math.floor(now.getMonth() / 3) - 1, y = q < 0 ? now.getFullYear() - 1 : now.getFullYear(), qq = (q + 4) % 4; return out(new Date(y, qq * 3, 1), new Date(y, qq * 3 + 3, 0), 'last quarter', /\b(last|previous)\s+quarter\b/g) }
    if (/\b(this|current)\s+quarter\b/.test(s)) { const q = Math.floor(now.getMonth() / 3); return out(new Date(now.getFullYear(), q * 3, 1), now, 'this quarter', /\b(this|current)\s+quarter\b/g) }
    if (/\b(last|previous)\s+year\b/.test(s)) return out(new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear() - 1, 11, 31), 'last year', /\b(last|previous)\s+year\b/g)
    if (/\b(this|current)\s+year\b|\bytd\b|\byear to date\b/.test(s)) return out(new Date(now.getFullYear(), 0, 1), now, 'this year', /\b(this|current)\s+year\b|\bytd\b|\byear to date\b/g)
    if ((m = new RegExp('\\b' + DATE_RE + '\\b').exec(s)) && (r = parseDateToken(m[1], now))) return out(r, r, iso(r), new RegExp('\\b' + DATE_RE + '\\b'))
    if ((m = new RegExp('\\b(?:in|for|during|of|on)?\\s*' + MONTH_RE + '(?:\\s+(\\d{4}))?\\b').exec(s)) && !(m[1] === 'may' && !/\b(in|for|during|of)\s+may\b/.test(s))) {
      let y = m[2] ? +m[2] : now.getFullYear(); const mi = monthIdx(m[1])
      if (!m[2] && mi > now.getMonth()) y -= 1
      const [a, b] = monthRange(y, mi); return out(a, b, `${MONTHS[mi][0].toUpperCase() + MONTHS[mi].slice(1)} ${y}`, new RegExp('\\b(?:in|for|during|of|on)?\\s*' + MONTH_RE + '(?:\\s+\\d{4})?\\b'))
    }
    return { period: null, rest: s }
  }

  // ───────── fuzzy words ─────────
  function dist(a, b) {            // Damerau–Levenshtein (adjacent swaps count as one edit)
    const al = a.length, bl = b.length
    if (Math.abs(al - bl) > 3) return 9
    const d = []
    for (let i = 0; i <= al; i++) { d[i] = [i]; for (let j = 1; j <= bl; j++) d[i][j] = i === 0 ? j : 0 }
    for (let i = 1; i <= al; i++) for (let j = 1; j <= bl; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
    return d[al][bl]
  }
  const tokEq = (a, b) => { if (a === b) return true; const l = Math.min(a.length, b.length); if (l < 5) return false; const d = dist(a, b); return d <= 1 || (l >= 8 && d <= 2) }

  // ───────── training the classifier from the examples ─────────
  const PAGE_PHRASES = []
  for (const [id, list] of Object.entries(D.PAGES)) list.forEach(p => PAGE_PHRASES.push([p, id]))
  PAGE_PHRASES.sort((a, b) => b[0].length - a[0].length)

  function features(text, opts) {
    opts = opts || {}
    let s = normalise(String(text).replace(/\{(\w+)\}/g, ' ent_$1 '))
    s = s.replace(/\bhow much\b/g, ' q_howmuch ').replace(/\bhow many\b/g, ' q_howmany ')
    if (!opts.keepPeriod) s = parsePeriod(s).rest
    const words = s.split(' ').filter(Boolean).map(w => /^\d+$/.test(w) ? '' : w).filter(Boolean)
    const QW = ['how', 'what', 'where', 'when', 'why', 'which', 'who', 'show', 'give', 'tell', 'get', 'need', 'want', 'much', 'many']
    let toks = words.filter(w => !STOP.has(w) || KEEP.has(w)).map(canon).filter(w => !QW.includes(w) || w === 'who')
    if (!toks.length) toks = words.filter(w => !QW.includes(w)).map(canon)      // e.g. "what can you do": nothing left, so keep the plain words
    const f = new Map()
    const add = (k, w) => f.set(k, (f.get(k) || 0) + w)
    toks.forEach((t, i) => { add(t, 1); if (i) add(toks[i - 1] + '_' + t, 0.8) })
    return f
  }

  const EX = []                      // {intent, vec}
  const DF = new Map()
  D.INTENTS.forEach(it => it.ex.forEach(text => {
    const f = features(text)
    EX.push({ intent: it.id, f })
    f.forEach((_, k) => DF.set(k, (DF.get(k) || 0) + 1))
  }))
  const N = EX.length
  const idf = k => Math.log(1 + N / (DF.get(k) || 0.35))
  const vectorise = f => { const v = new Map(); let n = 0; f.forEach((tf, k) => { const w = (1 + Math.log(tf)) * idf(k); v.set(k, w); n += w * w }); return { v, n: Math.sqrt(n) || 1 } }
  EX.forEach(e => { e.vec = vectorise(e.f) })

  // words the engine knows (for spelling correction)
  const VOCAB = new Map()
  EX.forEach(e => e.f.forEach((_, k) => { if (!k.includes('_') && k.length >= 4) VOCAB.set(k, (VOCAB.get(k) || 0) + 1) }))
  Object.keys(SYN).forEach(w => { if (w.length >= 4) VOCAB.set(w, (VOCAB.get(w) || 0) + 1) })
  const SHORT_FIX = ['much', 'many', 'sell', 'sale', 'paid', 'cash', 'rent', 'visa', 'card', 'show', 'open', 'list', 'find', 'last', 'week', 'owes', 'staff']
  ;['today', 'yesterday', 'week', 'month', 'year', 'quarter', 'last', 'this', 'november', 'december', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october',
    'invoice', 'customer', 'expense', 'document', 'quotation', 'application', 'service', 'payment', 'commission', 'employee', 'passport', 'licence', 'license', 'labour', 'emirates', 'visa', 'cash', 'card', 'rent', 'salary', 'transfer']
    .forEach(w => VOCAB.set(w, (VOCAB.get(w) || 0) + 2))
  // everyday words that must never be "corrected" into one of our domain words (shop → stop, rate → rent …)
  const COMMON = new Set(('shop store office work home time place thing system number name news group order close product item items sheet form file folder email mail phone call message print copy scan paper book list data user users page pages state ' +
    'status show stock stop step steps sure still tell year years hour hours month months week weeks daily today good great nice best help sell tool tools plan plans back bank card cards case cases part parts point points rule rules sale sales rate rates ' +
    'fine find free full gave give goes gone have here hold idea join keep kind know last late left less life line live long look lost love made main make many mark mean meet mind miss more most move much must near need next once only open over pack paid pass ' +
    'past pick plus post pull push read real rest ride rise role room safe same save seem seen send ship side sign size slow some soon sort spot stay such take talk team term test text than that them then they thin this thus till tour town true turn type unit ' +
    'upon used very view wait walk want warm wash ways wear well went were what when whom wide wife will wind wish with word yard your zone').split(' '))
  const GENERIC_NAME_WORDS = new Set(['llc', 'ltd', 'trading', 'services', 'service', 'company', 'co', 'the', 'and', 'for', 'general', 'typing', 'est', 'establishment', 'group'])

  function correct(w, known) {
    if (w.length === 3 && !STOP.has(w) && SYN[w] === undefined && !VOCAB.has(w) && !known.has(w) && /^[a-z]+$/.test(w)) { if (COMMON.has(w)) return w; const c = SHORT_FIX.find(v => v[0] === w[0] && dist(w, v) === 1); return c || w }
    if (w.length < 4 || /\d|_/.test(w) || STOP.has(w) || COMMON.has(w) || SYN[w] !== undefined || VOCAB.has(w) || VOCAB.has(stem(w)) || known.has(w)) return w
    let best = null, bd = 9, bc = -1
    const lim = w.length <= 6 ? 1 : 2
    for (const [v, c] of VOCAB) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > lim) continue
      const d = dist(w, v)
      if (d <= lim && (d < bd || (d === bd && c > bc))) { best = v; bd = d; bc = c }
    }
    return best || w
  }

  // ───────── entities ─────────
  // pages where just typing the name means "take me there" (for the others, e.g. "profit", the person wants the figures)
  const BARE_OK = new Set(['dashboard', 'customers', 'services', 'applications', 'documents', 'renewals', 'notifications', 'accounting', 'reports', 'settings', 'einvoice', 'cashstaff'])
  const DOCS = [[/\b(emirates\s*id|e\.?id|eid|id card)\b/, 'Emirates ID'], [/\bvisas?\b/, 'Visa'], [/\bpassports?\b/, 'Passport'],
    [/\btrade\s*licen[cs]es?\b|\btl\b/, 'Trade Licence'], [/\b(labou?r\s*cards?|work\s*permits?)\b/, 'Labour Card'], [/\bestablishment\s*cards?\b/, 'Establishment Card']]
  const EXPCAT = [[/\brent\b/, 'rent'], [/\b(salary|salaries|payroll|wages?)\b/, 'salar'], [/\b(utilit\w*|electric\w*|water|dewa|sewa|internet|telephone)\b/, 'utilit'],
    [/\b(supplies|stationery|office|paper|toner|ink)\b/, 'office'], [/\b(transport|fuel|petrol|taxi|diesel)\b/, 'transport'], [/\b(government|govt|gov)\b/, 'govern']]
  const STATUS = [[/\b(doc pending|waiting for (the )?documents?|need(s|ed|ing)? (the )?documents?|missing documents?|documents? pending)\b/, 'doc_pending'], [/\b(completed|complete|done|finished|ready|delivered)\b/, 'completed'],
    [/\b(rejected|refused|declined)\b/, 'rejected'], [/\b(processing|in process|in progress|under process)\b/, 'processing'], [/\bsubmitted\b/, 'submitted'], [/\b(pending|waiting|open|unfinished)\b/, 'pending'], [/\bnew\b/, 'new']]

  function nameTokens(name) {
    return normalise(name).split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !GENERIC_NAME_WORDS.has(w) && !/^\d+$/.test(w))
  }

  // find which of `items` ({id,name}) the message talks about; returns [{item, matched:[token idx], coverage}] best first
  function matchNames(toks, items, opts) {
    opts = opts || {}
    const out = []
    for (const it of items) {
      const nt = it._t || (it._t = nameTokens(it.name))
      if (!nt.length) continue
      const used = []
      let hit = 0
      for (const t of nt) {
        const i = toks.findIndex((w, ix) => !used.includes(ix) && tokEq(w, t) && !(opts.skip && opts.skip.has(w)))
        if (i >= 0) { used.push(i); hit++ }
      }
      if (hit) out.push({ item: it, used, hit, coverage: hit / nt.length, size: nt.length })
    }
    out.sort((a, b) => b.hit - a.hit || b.coverage - a.coverage || b.size - a.size)
    return out
  }

  function extract(text, ctx) {
    ctx = ctx || {}
    const now = ctx.now || new Date()
    const e = { period: null, customers: [], services: [], staff: [], doc: null, inv: null, qt: null, app: null, method: null, count: null, mine: false, page: null, status: null, expcat: null, howto: false, navverb: false }
    let s = normalise(text)
    const raw = s
    e.howto = HOWTO.test(s)
    e.navverb = NAV_VERB.test(s)
    e.mine = /\b(my|mine|myself)\b/.test(s) || /\bhow much did i\b/.test(s)

    // ids
    let m
    if ((m = /\binv[-\s]?(\d{3,6})\b/.exec(s))) { e.inv = 'INV-' + String(m[1]).padStart(4, '0'); s = s.replace(m[0], ' ent_inv ') }
    if ((m = /\bqt[-\s]?(\d{4})[-\s]?(\d{1,5})\b/.exec(s))) { e.qt = `QT-${m[1]}-${String(m[2]).padStart(4, '0')}`; s = s.replace(m[0], ' ent_qt ') }
    if ((m = /\bapp[-\s]?(\d[\w-]*)\b/.exec(s))) { e.app = m[0].replace(/\s/g, '-').toUpperCase(); s = s.replace(m[0], ' ent_app ') }

    // spelling (words the engine knows plus the names of this company's customers / services / staff)
    const known = new Set()
    ;['customers', 'services', 'staff'].forEach(k => (ctx[k] || []).forEach(it => nameTokens(it.name).forEach(t => known.add(t))))
    s = s.split(' ').map(w => correct(w, known)).join(' ')

    // dates
    const pp = parsePeriod(s, now); e.period = pp.period; s = pp.rest
    if ((m = /\b(top|first|last|latest|recent|best)\s+(\d{1,2})\b/.exec(s))) { e.count = +m[2]; s = s.replace(m[0], ' ' + m[1] + ' ') }   // keep "top" / "latest": it tells what is wanted

    const wantsDocs = /\b(expir\w*|renew\w*|document|documents|docs?)\b/.test(s)
    const priceish = /\b(price|prices|pricing|cost|costs|charge|charges|rate|fee|fees|how much)\b/.test(s)
    const toks = s.split(' ').filter(Boolean)

    // services: every word of a service name present (or all but one for long names)
    if ((priceish || !wantsDocs) && !e.inv && (ctx.services || []).length) {
      const GEN = new Set(['service', 'fee', 'price', 'cost', 'charge', 'per', 'page'])
      const cands = []
      const dfTok = new Map()          // how many services use each word (a rare word on its own can identify a service)
      for (const sv of ctx.services) { const st = sv._st || (sv._st = normalise(sv.name).split(' ').filter(w => w.length >= 2 && !STOP.has(w) && !GEN.has(w))); new Set(st).forEach(t => dfTok.set(t, (dfTok.get(t) || 0) + 1)) }
      for (const sv of ctx.services) {
        const st = sv._st || (sv._st = normalise(sv.name).split(' ').filter(w => w.length >= 2 && !STOP.has(w) && !GEN.has(w)))
        if (!st.length) continue
        const used = []; let hit = 0
        for (const t of st) { const i = toks.findIndex((w, ix) => !used.includes(ix) && (tokEq(w, t) || (w.length >= 3 && t.length >= 3 && (stem(w) === stem(t))))); if (i >= 0) { used.push(i); hit++ } }
        const distinct = priceish && used.some(ix => toks[ix].length >= 5 && (dfTok.get(st.find(t => tokEq(toks[ix], t))) || 9) <= 4)
        if (hit && (hit === st.length || (hit >= 2 && hit / st.length >= 0.6) || distinct)) cands.push({ sv, used, hit, cov: hit / st.length, size: st.length })
      }
      if (cands.length) {
        const bestCov = Math.max(...cands.map(c => c.cov))
        let pick = cands.filter(c => c.cov === bestCov)
        const maxHit = Math.max(...pick.map(c => c.hit)); pick = pick.filter(c => c.hit === maxHit)
        e.services = pick.map(c => c.sv)
        const mask = new Set(pick.flatMap(c => c.used))
        toks.forEach((w, i) => { if (mask.has(i)) toks[i] = '' }); toks.splice(toks.findIndex(w => w === '') < 0 ? toks.length : toks.findIndex(w => w === ''), 0, 'ent_svc')
      }
    }
    let t2 = toks.filter(Boolean)

    // customers, then staff (rare-word protection: a single name word that is also something the assistant understands is not a name)
    const skip = new Set(); VOCAB.forEach((_, k) => skip.add(k))
    const pickNames = (items, tag, key) => {
      if (!(items || []).length) return
      const ms = matchNames(t2, items, { skip })
      if (!ms.length) return
      const top = ms[0]
      const same = ms.filter(x => x.hit === top.hit && x.coverage === top.coverage)
      e[key] = same.slice(0, 6).map(x => x.item)
      const mask = new Set(top.used)
      t2 = t2.map((w, i) => mask.has(i) ? (i === Math.min(...top.used) ? tag : '') : w).filter(Boolean)
    }
    pickNames(ctx.customers, 'ent_cust', 'customers')
    if (!e.customers.length) pickNames(ctx.staff, 'ent_staff', 'staff')
    else if ((ctx.staff || []).length) { const sm = matchNames(t2, ctx.staff, { skip }); if (sm.length) e.staff = sm.filter(x => x.hit === sm[0].hit).slice(0, 3).map(x => x.item) }
    s = t2.join(' ')

    for (const [re, name] of DOCS) if (re.test(s)) { e.doc = name; if (!e.services.length) s = s.replace(re, ' ent_doc '); break }
    for (const [re, name] of EXPCAT) if (re.test(s)) { e.expcat = name; break }
    for (const [re, name] of STATUS) if (re.test(s)) { e.status = name; break }
    e.method = /\bbank transfer\b|\btransfers?\b/.test(s) ? 'bank_transfer' : /\bcredit card\b|\bcards?\b/.test(s) ? 'card' : /\bcash\b/.test(s) ? 'cash' : /\bon credit\b|\bcredit sales?\b/.test(s) ? 'customer_credit' : null

    // pages: only with a "go to / open" verb, or when the whole message is just a page name
    const bare = s.replace(/\b(the|page|screen|please|pls|me|to|section|tab)\b/g, ' ').replace(/\s+/g, ' ').trim()
    for (const [phrase, id] of PAGE_PHRASES) {
      const re = new RegExp('\\b' + phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b')
      if (re.test(s)) {
        if (e.navverb || (bare === phrase && !e.period && !e.count && BARE_OK.has(id))) { e.page = id; s = s.replace(re, ' ent_page ') }
        break
      }
    }
    s = s.replace(/\b(open|go to|goto|go|take me|launch|navigate|switch to|bring up|visit)\b/g, ' open ')
    return { entities: e, masked: s.replace(/\s+/g, ' ').trim(), raw }
  }

  // ───────── classify ─────────
  function classify(masked, entities) {
    let s = masked.replace(/\bhow much\b/g, ' q_howmuch ').replace(/\bhow many\b/g, ' q_howmany ')
    const f = features(s.replace(/ent_(\w+)/g, ' ent_$1 '), { keepPeriod: true })
    const q = vectorise(f)
    const per = new Map()
    for (const ex of EX) {
      let dot = 0
      const [small, big] = q.v.size <= ex.vec.v.size ? [q.v, ex.vec.v] : [ex.vec.v, q.v]
      small.forEach((w, k) => { const o = big.get(k); if (o) dot += w * o })
      const sim = dot / (q.n * ex.vec.n)
      const cur = per.get(ex.intent) || []
      cur.push(sim); per.set(ex.intent, cur)
    }
    const types = {}; D.INTENTS.forEach(i => { types[i.id] = i.type })
    const scored = []
    per.forEach((sims, id) => {
      sims.sort((a, b) => b - a)
      let sc = sims[0] + 0.1 * (sims[1] || 0)
      if (types[id] === 'howto') sc *= entities.howto ? 1.15 : 0.8
      else if (entities.howto && id !== 'help') sc *= 0.7
      scored.push({ id, score: Math.min(sc, 1) })
    })
    scored.sort((a, b) => b.score - a.score)
    return scored
  }

  function parse(text, ctx) {
    const raw0 = String(text || '').trim()
    const { entities, masked, raw } = extract(raw0, ctx)
    const e = entities
    let ranked = classify(masked, e)
    let intent = ranked[0], via = 'model'

    // rules that are certain
    if (!e.howto) {
      if (e.inv) { intent = { id: 'invoice_lookup', score: 0.95 }; via = 'rule' }
      else if (e.qt) { intent = { id: 'quotations_status', score: 0.95 }; via = 'rule' }
      else if (e.app) { intent = { id: 'applications_status', score: 0.95 }; via = 'rule' }
      else if (e.page && (e.navverb || masked === 'ent_page')) { intent = { id: 'navigate', score: 0.92 }; via = 'rule' }
    }
    // "how much cash today" is a sales question; the drawer questions mention the drawer / shift / expected cash
    if (intent.id === 'cash_drawer' && e.period && !/\b(drawer|shift|till|hand|expected|difference|short|over)\b/.test(raw)) { intent = { id: 'sales_by_method', score: Math.max(intent.score * 0.9, 0.5) }; via = 'rule' }
    if (!raw) intent = { id: 'empty', score: 1 }
    return { text: raw0, intent: intent.id, score: intent.score, via, alts: ranked.slice(0, 4), entities: e, masked, norm: raw }
  }

  // ───────── decide how sure we are ─────────
  function confidence(res) {
    if (res.intent === 'empty') return 'ok'
    const top = res.score, second = (res.alts.find(a => a.id !== res.intent) || { score: 0 }).score
    if (res.via === 'rule') return 'ok'
    if (top >= 0.5 && top - second >= 0.04) return 'ok'
    if (top >= 0.68) return 'ok'
    if (top >= 0.3) return 'ambiguous'
    return 'unknown'
  }

  const api = { parse, confidence, parsePeriod, normalise, extract, classify, dist, intents: D.INTENTS, _EX: EX }
  root.ChatNLP = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
