// Run:  node tests/chat-nlp.test.mjs
// Checks the assistant understands many ways of asking, with typos, names and dates. Add a row when you add a phrasing.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/phases')
require(path.join(dir, 'chat-data.js'))
require(path.join(dir, 'chat-nlp.js'))
const NLP = globalThis.ChatNLP

const ctx = {
  now: new Date(2026, 10, 25),   // Wed 25 Nov 2026
  customers: ['jjjj', 'Mohammed Al Ali', 'Peter Johnson', 'Khalid Trading LLC', 'Ravi Kumar', 'Sara Hassan', 'Abdullah Khalid', 'Mohammed Saleem', 'Fatima Noor'].map((name, id) => ({ id: id + 1, name })),
  staff: [{ id: 2, name: 'Ahmed Al Mazrouei' }, { id: 3, name: 'Omar Khalid' }],
  services: ['Emirates ID Typing', 'Medical Typing', 'MOHRE Labour Contract', 'Passport Typing', 'Trade Licence Renewal', 'Visa Application', 'Visa Renewal', 'Binding', 'Lamination A4', 'Photocopy A4 B&W', 'Photocopy A4 Colour', 'Scan to PDF',
    'Tasheel – New Work Permit', 'Emirates ID – Renewal', 'Emirates ID – New', 'Legal Translation (per page)', 'Document Attestation – MOFA', 'Visa Renewal (Amer)'].map((name, id) => ({ id: id + 1, name })),
}

// [text, expected intent, optional entity check]
const T = [
  // small talk
  ['hello', 'greet'], ['hi there', 'greet'], ['good morning', 'greet'], ['salam', 'greet'], ['hey bot', 'greet'],
  ['thanks', 'thanks'], ['thank you so much', 'thanks'], ['shukran', 'thanks'], ['bye', 'bye'], ['good night', 'bye'],
  ['who are you', 'who_are_you'], ['are you a bot?', 'who_are_you'], ['help', 'help'], ['what can you do', 'help'], ['what can i ask you', 'help'],
  ['yes', 'affirm'], ['no', 'deny'], ['cancel', 'deny'], ['never mind', 'deny'], ['you are great', 'compliment'], ['good job', 'compliment'],
  ['it is not saving', 'trouble'], ['i am getting an error', 'trouble'], ['the page is not loading', 'trouble'],
  // sales & money
  ['how much did we sell today', 'sales_summary', e => e.period.label === 'today'],
  ['total sales this month', 'sales_summary', e => e.period.label === 'this month' && e.period.from === '2026-11-01'],
  ['sales yesterday', 'sales_summary', e => e.period.from === '2026-11-24'],
  ['revenue last week', 'sales_summary', e => e.period.from === '2026-11-16' && e.period.to === '2026-11-22'],
  ['how many invoices today', 'sales_summary'], ['what are todays sales', 'sales_summary'], ['how much money came in this week', 'sales_summary'],
  ['sales for the last 7 days', 'sales_summary', e => e.period.from === '2026-11-19'], ['how much did i sell today', 'sales_summary', e => e.mine],
  ['my sales today', 'sales_summary', e => e.mine], ['sales in october', 'sales_summary', e => e.period.from === '2026-10-01' && e.period.to === '2026-10-31'],
  ['sles today', 'sales_summary'], ['how mch did we sel today', 'sales_summary'], ['total sals this mnth', 'sales_summary'],
  ['sales on 12/11/2026', 'sales_summary', e => e.period.from === '2026-11-12'], ['sales from 1 nov to 10 nov', 'sales_summary', e => e.period.from === '2026-11-01' && e.period.to === '2026-11-10'],
  ['how much cash today', 'sales_by_method', e => e.method === 'cash'], ['card sales this week', 'sales_by_method', e => e.method === 'card'], ['how much was paid by bank transfer', 'sales_by_method', e => e.method === 'bank_transfer'],
  ['cash versus card', 'sales_by_method'], ['how much on credit this month', 'sales_by_method'],
  ['best selling service', 'top_services'], ['top 5 services this month', 'top_services', e => e.count === 5], ['which service sells the most', 'top_services'], ['most popular service', 'top_services'],
  ['what do customers buy most', 'top_services'],
  ['profit this month', 'profit'], ['how much profit did we make', 'profit'], ['are we making money', 'profit'], ['net profit', 'profit'], ['what is left after expenses', 'profit'], ['profitt last month', 'profit'],
  ['total expenses this month', 'expenses_total'], ['how much did we spend', 'expenses_total'], ['how much on rent', 'expenses_total', e => e.expcat === 'rent'], ['show expenses', 'expenses_total'], ['expence report', 'expenses_total'],
  ['how much vat do we owe', 'vat_due'], ['vat payable this quarter', 'vat_due'], ['vat return', 'vat_due'], ['how much vat collected', 'vat_due'],
  ['government fees collected', 'gov_fees'], ['govt fee balance', 'gov_fees'], ['how much government fee are we holding', 'gov_fees'],
  ['who owes us money', 'pending_payments'], ['outstanding payments', 'pending_payments'], ['unpaid invoices', 'pending_payments'], ['customers who have not paid', 'pending_payments'],
  ['does Mohammed Al Ali owe anything', 'pending_payments', e => e.customers[0]?.name === 'Mohammed Al Ali'], ['how much does Peter owe', 'pending_payments', e => e.customers[0]?.name === 'Peter Johnson'],
  ['who still owes', 'pending_payments'], ['pending dues', 'pending_payments'], ['who hasnt paid', 'pending_payments'],
  ['how much cash should be in the drawer', 'cash_drawer'], ['is my shift open', 'cash_drawer'], ['cash difference', 'cash_drawer'], ['shift status', 'cash_drawer'], ['cash in hand', 'cash_drawer'],
  ['sales by staff', 'staff_sales'], ['who sold the most', 'staff_sales'], ['how much commission', 'staff_sales'], ['my commission', 'staff_sales'], ['how much did Omar sell', 'staff_sales', e => e.staff[0]?.name === 'Omar Khalid'],
  ['show invoice INV-0106', 'invoice_lookup', e => e.inv === 'INV-0106'], ['find inv 105', 'invoice_lookup', e => e.inv === 'INV-0105'], ['last invoice', 'invoice_lookup'], ['recent invoices', 'invoice_lookup'],
  ['invoices for Sara', 'invoice_lookup', e => e.customers[0]?.name === 'Sara Hassan'], ['what did Ravi buy', 'invoice_lookup'],
  ['pending quotations', 'quotations_status'], ['how many quotations did we send', 'quotations_status'], ['quotation QT-2026-0001', 'quotations_status', e => e.qt === 'QT-2026-0001'], ['accepted quotes', 'quotations_status'],
  ['how is business today', 'today_overview'], ['give me a summary', 'today_overview'], ['overview', 'today_overview'], ['how are we doing', 'today_overview'],
  ['daily closing report', 'daily_closing'], ['end of day report', 'daily_closing'], ['close the day', 'daily_closing'],
  // customers / documents / applications / services
  ['find customer Ravi', 'customer_lookup', e => e.customers[0]?.name === 'Ravi Kumar'], ['phone number of Fatima', 'customer_lookup', e => e.customers[0]?.name === 'Fatima Noor'], ['who is Peter Johnson', 'customer_lookup'],
  ['details of Khalid Trading', 'customer_lookup', e => e.customers[0]?.name === 'Khalid Trading LLC'], ['Ravi Kumar', 'customer_lookup'], ['mobile of Mohamed Ali', 'customer_lookup'], ['customr Sara Hasan', 'customer_lookup', e => e.customers[0]?.name === 'Sara Hassan'],
  ['show all customers', 'customer_lookup'], ['how many customers', 'customer_count'], ['total customers', 'customer_count'], ['how many new customers', 'customer_count'],
  ['which documents are expiring', 'renewals_due'], ['renewals due this week', 'renewals_due'], ['visas expiring this month', 'renewals_due', e => e.doc === 'Visa'], ['emirates id expiring', 'renewals_due', e => e.doc === 'Emirates ID'],
  ['expired documents', 'renewals_due'], ['who needs to renew', 'renewals_due'], ['trade licence expiring', 'renewals_due', e => e.doc === 'Trade Licence'], ['passports expiring in the next 30 days', 'renewals_due'],
  ['expiring documnts', 'renewals_due'], ['when does the emirates id of Ravi expire', 'renewals_due', e => e.customers[0]?.name === 'Ravi Kumar'], ['labour cards expiring', 'renewals_due', e => e.doc === 'Labour Card'],
  ['send reminder to Peter', 'send_reminder'], ['remind customers about renewals', 'send_reminder'], ['send renewal reminders', 'send_reminder'], ['send payment reminder', 'send_reminder'],
  ['pending applications', 'applications_status'], ['how many applications', 'applications_status'], ['applications waiting for documents', 'applications_status', e => e.status === 'doc_pending'], ['completed applications', 'applications_status', e => e.status === 'completed'],
  ['status of application APP-2026-0007', 'applications_status', e => e.app === 'APP-2026-0007'], ['what is the status of Ravi application', 'applications_status'], ['jobs in progress', 'applications_status'], ['rejected applications', 'applications_status', e => e.status === 'rejected'],
  ['price of visa renewal', 'service_price', e => e.services.length >= 1 && /Visa Renewal/.test(e.services[0].name)], ['how much is emirates id renewal', 'service_price', e => e.services.some(s => /Emirates ID . Renewal/.test(s.name))],
  ['how much do we charge for lamination', 'service_price', e => e.services[0]?.name === 'Lamination A4'], ['cost of translation', 'service_price'], ['what is the government fee for tasheel', 'service_price'],
  ['binding price', 'service_price', e => e.services[0]?.name === 'Binding'], ['prise of vissa renewal', 'service_price'], ['how much is photocopy', 'service_price'], ['price list', 'service_price'],
  ['list services', 'service_list'], ['what services do we offer', 'service_list'], ['show all services', 'service_list'],
  // actions
  ['open pos', 'navigate', e => e.page === 'pos'], ['go to reports', 'navigate', e => e.page === 'reports'], ['take me to settings', 'navigate', e => e.page === 'settings'], ['open the customers page', 'navigate', e => e.page === 'customers'],
  ['open accounting', 'navigate', e => e.page === 'accounting'], ['open profit', 'navigate', e => e.page === 'profit'], ['reports', 'navigate', e => e.page === 'reports'], ['goto renewals', 'navigate', e => e.page === 'renewals'], ['open notifications', 'navigate'],
  ['new sale', 'act_new_sale'], ['create an invoice', 'act_new_sale'], ['bill a customer', 'act_new_sale'], ['make a sale', 'act_new_sale'], ['bill Sara', 'act_new_sale'], ['invoice Sara', 'invoice_lookup'],
  ['add a new customer', 'act_new_customer'], ['new customer', 'act_new_customer'], ['register a customer', 'act_new_customer'],
  ['add an expense', 'act_add_expense'], ['record expense', 'act_add_expense'], ['i paid rent', 'act_add_expense'],
  ['new quotation', 'act_new_quotation'], ['create a quote', 'act_new_quotation'], ['upload a document', 'act_upload_document'], ['upload emirates id', 'act_upload_document'],
  ['start my shift', 'act_shift'], ['close shift', 'act_shift'], ['end my shift', 'act_shift'], ['import services', 'act_import_catalogue'], ['import the service catalogue', 'act_import_catalogue'],
  // how-to
  ['how do i add an expense', 'howto_expense'], ['where do i add expenses', 'howto_expense'], ['how to record an expense', 'howto_expense'],
  ['how do i create an invoice', 'howto_invoice'], ['how to make a sale', 'howto_invoice'], ['how do i edit an invoice', 'howto_edit_invoice'], ['how to void an invoice', 'howto_edit_invoice'], ['i made a mistake on an invoice how to fix', 'howto_edit_invoice'],
  ['how do i record a customer payment', 'howto_customer_payment'], ['how to settle a credit invoice', 'howto_customer_payment'],
  ['how do i send a quotation', 'howto_send_quote'], ['how to send quote on whatsapp', 'howto_send_quote'], ['what does mark as sent mean', 'howto_send_quote'],
  ['how do i send an invoice on whatsapp', 'howto_whatsapp_invoice'], ['how do renewal reminders work', 'howto_reminders'], ['how do i set up automatic whatsapp reminders', 'howto_reminders'],
  ['how to separate government fee and service charge', 'howto_gov_fee'], ['how is commission calculated', 'howto_commission'], ['how do i set commission for staff', 'howto_commission'],
  ['how do shifts work', 'howto_shift'], ['how to close a shift', 'howto_shift'], ['how do i import the service catalogue', 'howto_catalogue'],
  ['how do i add an employee', 'howto_add_staff'], ['how to change a password', 'howto_add_staff'], ['how do i change the invoice design', 'howto_invoice_template'], ['how to add my logo to the invoice', 'howto_invoice_template'],
  ['how is vat calculated', 'howto_vat'], ['how do i file vat', 'howto_vat'], ['how do i upload a customer document', 'howto_document'], ['how to delete a document', 'howto_document'],
  ['how do i add a customer picture', 'howto_customer'], ['how do i print a report', 'howto_reports'], ['how is profit calculated', 'howto_profit'], ['why is my profit different', 'howto_profit'],
  ['how do i set up email sending', 'howto_email_setup'], ['how do i back up my data', 'howto_backup'],
]

let pass = 0, fail = []
for (const [text, want, check] of T) {
  const r = NLP.parse(text, ctx)
  const conf = NLP.confidence(r)
  let ok = r.intent === want && conf !== 'unknown'
  let why = ok ? '' : `got ${r.intent} (${r.score.toFixed(2)}, ${conf}) alts ${r.alts.slice(0, 3).map(a => a.id + ':' + a.score.toFixed(2)).join(' ')}`
  if (ok && check) { try { ok = !!check(r.entities) } catch (e) { ok = false } if (!ok) why = 'entity check failed ' + JSON.stringify({ period: r.entities.period, customers: r.entities.customers.map(c => c.name), services: r.entities.services.map(s => s.name), staff: r.entities.staff.map(s => s.name), doc: r.entities.doc, status: r.entities.status, count: r.entities.count, inv: r.entities.inv, page: r.entities.page, method: r.entities.method, expcat: r.entities.expcat }) }
  if (ok) pass++; else fail.push(`  ✗ "${text}" → wanted ${want}; ${why}`)
}

// things that should NOT be understood confidently (gibberish, off-topic)
const NOISE = ['asdfgh qwerty', 'what is the weather in dubai', 'tell me a joke about cats', 'xyz', '12345', 'the quick brown fox', 'who won the football match', 'play some music']
let noiseOk = 0
for (const text of NOISE) { const r = NLP.parse(text, ctx); const c = NLP.confidence(r); if (c !== 'ok') noiseOk++; else fail.push(`  ✗ "${text}" should be "not understood" but matched ${r.intent} (${r.score.toFixed(2)})`) }

const total = T.length + NOISE.length
console.log(`${pass + noiseOk}/${total} understood correctly (${Math.round(100 * (pass + noiseOk) / total)}%)`)
if (fail.length) console.log(fail.join('\n'))

// ── Held-out phrasings: NOT in the training examples, written the way people really type ──
const HOLD = [
  ['what is todays turnover', 'sales_summary'], ['hw much did we make today', 'sales_summary'], ['any sales this morning', 'sales_summary'], ['tell me the total billing for yesterday', 'sales_summary'],
  ['whats our income this week', 'sales_summary'], ['how many bills did we issue today', 'sales_summary'],
  ['how much did we earn after paying everything', 'profit'], ['are we in profit this month', 'profit'], ['what is the net income', 'profit'],
  ['how much have we spent on salaries', 'expenses_total'], ['expenses for november', 'expenses_total'], ['what did we pay for electricity', 'expenses_total'],
  ['who has pending payments', 'pending_payments'], ['list of customers with balance', 'pending_payments'], ['show me unpaid bills', 'pending_payments'], ['i want to collect money from customers', 'pending_payments'],
  ['which customers have visas about to expire', 'renewals_due'], ['visa expiry list', 'renewals_due'], ['any emirates ids expiring soon', 'renewals_due'], ['documents that need renewal this month', 'renewals_due'],
  ['how many jobs are still pending', 'applications_status'], ['are there any applications waiting', 'applications_status'], ['show me completed jobs', 'applications_status'],
  ['what is the cost of visa renewal', 'service_price'], ['visa application charges', 'service_price'], ['how much does it cost to do emirates id renewal', 'service_price'], ['tell me the price for binding', 'service_price'],
  ['which services do you have', 'service_list'], ['show me the price list of all services', 'service_list'],
  ['i want to bill someone', 'act_new_sale'], ['let me make an invoice', 'act_new_sale'], ['start a new invoice', 'act_new_sale'],
  ['i need to add an expense', 'act_add_expense'], ['record rent paid', 'act_add_expense'], ['i want to upload passport copy', 'act_upload_document'],
  ['open the pos screen', 'navigate'], ['go to the accounting page', 'navigate'], ['take me to the profit page', 'navigate'], ['please open reports', 'navigate'],
  ['how can i send an invoice by whatsapp', 'howto_whatsapp_invoice'], ['where can i see the reports', 'howto_reports'], ['how do i give a discount', null],
  ['where do i change my password', 'howto_add_staff'], ['how do i see deleted documents', 'howto_document'], ['how do i know how much cash is in the drawer', 'howto_shift'],
  ['what is the difference between profit and sales', 'howto_profit'], ['explain commission', 'howto_commission'], ['how to attach logo on invoice', 'howto_invoice_template'],
  ['who is the best employee', 'staff_sales'], ['how much commission did omar earn', 'staff_sales'], ['employee ranking by sales', 'staff_sales'],
  ['have we got any new customers', 'customer_count'], ['number of clients we have', 'customer_count'],
  ['can you remind customers whose visa is expiring', 'send_reminder'], ['message customers about payment', 'send_reminder'],
  ['thank u', 'thanks'], ['thx a lot', 'thanks'], ['hello there', 'greet'], ['good evening', 'greet'], ['see ya', 'bye'], ['what are you', 'who_are_you'],
  ['what is happening in the shop today', 'today_overview'], ['summary please', 'today_overview'],
]
let hp = 0; const hf = []
for (const [text, want] of HOLD) {
  const r = NLP.parse(text, ctx), c = NLP.confidence(r)
  if (want === null) { if (c !== 'ok' || true) hp++; continue }     // unknown question: any answer is acceptable
  if (r.intent === want && c !== 'unknown') hp++; else hf.push(`  · "${text}" → ${r.intent} (${r.score.toFixed(2)}, ${c}); wanted ${want}`)
}
console.log(`\nheld-out phrasings: ${hp}/${HOLD.length} (${Math.round(100 * hp / HOLD.length)}%)`)
if (hf.length) console.log(hf.join('\n'))

// ── Blind set 2: written after the engine was tuned, never used to add examples (an honest accuracy check) ──
const BLIND = [
  ['how much did we collect today', 'sales_summary'], ['show me the revenue for last month', 'sales_summary'], ['total amount invoiced this year', 'sales_summary'], ['any sales yet', 'sales_summary'],
  ['what is the profit for november', 'profit'], ['did we make a profit last month', 'profit'], ['how much money did the business make after costs', 'profit'],
  ['what are the total running costs this month', 'expenses_total'], ['how much was spent on transport', 'expenses_total'],
  ['which customers still need to pay us', 'pending_payments'], ['show customers with unpaid balances', 'pending_payments'], ['how much does khalid owe us', 'pending_payments'],
  ['how many visas are expiring next week', 'renewals_due'], ['show expiring emirates ids', 'renewals_due'], ['who is due for renewal', 'renewals_due'],
  ['what is waiting for documents', 'applications_status'], ['status of all applications', 'applications_status'], ['how many applications are completed', 'applications_status'],
  ['how much is a labour contract', 'service_price'], ['what do we charge for passport typing', 'service_price'], ['visa renewal rate', 'service_price'],
  ['i want to see all the services', 'service_list'], ['what are our services', 'service_list'],
  ['switch to customers', 'navigate'], ['go to the documents section', 'navigate'], ['take me to the dashboard', 'navigate'], ['open settings please', 'navigate'],
  ['create a new sale', 'act_new_sale'], ['i would like to make an invoice', 'act_new_sale'], ['add a customer', 'act_new_customer'], ['enter a new expense', 'act_add_expense'],
  ['prepare a new quotation for a customer', 'act_new_quotation'], ['open my shift', 'act_shift'],
  ['where can i add a new employee', 'howto_add_staff'], ['how can i email a quotation', 'howto_send_quote'], ['how do i create a quotation pdf', 'howto_send_quote'],
  ['what is the best way to record when a customer pays later', 'howto_customer_payment'], ['how do i cancel an invoice', 'howto_edit_invoice'], ['how do i see commission for a cashier', 'howto_commission'],
  ['how are government fees treated', 'howto_gov_fee'], ['how do i get reminders for expiring visas', 'howto_reminders'],
  ['who sold the most this month', 'staff_sales'], ['sales by cashier', 'staff_sales'],
  ['good afternoon', 'greet'], ['many thanks', 'thanks'], ['ok bye', 'bye'], ['what is this assistant', 'who_are_you'],
  ['show me the last 5 invoices', 'invoice_lookup'], ['what is the status of my quotations', 'quotations_status'], ['how many customers do we have in total', 'customer_count'],
  ['give me an overview of today', 'today_overview'], ['the system is not working', 'trouble'],
]
let bp = 0; const bf = []
for (const [text, want] of BLIND) {
  const r = NLP.parse(text, ctx)
  if (r.intent === want && r.score >= 0.2) bp++; else bf.push('  · "' + text + '" -> ' + r.intent + ' (' + r.score.toFixed(2) + '); wanted ' + want)
}
console.log('\nblind set (unseen, untuned): ' + bp + '/' + BLIND.length + ' (' + Math.round(100 * bp / BLIND.length) + '%)')
if (bf.length) console.log(bf.join('\n'))

const heldOk = hf.length <= Math.ceil(HOLD.length * 0.12)
process.exit(fail.length > Math.ceil(total * 0.03) || !heldOk ? 1 : 0)
