// Run:  node tests/idscan.test.mjs
// Checks the ID reader finds the number and expiry in text like the OCR produces (including its usual mistakes).
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/phases/idscan.js'))
const S = globalThis.IDScan

let pass = 0; const fail = []
const t = (name, text, hint, want) => {
  const r = S.parse(text, hint)
  const bad = Object.entries(want).filter(([k, v]) => r[k] !== v).map(([k, v]) => `${k}: got ${JSON.stringify(r[k])}, wanted ${JSON.stringify(v)}`)
  if (bad.length) fail.push(`  ✗ ${name} — ${bad.join('; ')}`); else pass++
}

// Emirates ID
t('EID front', 'United Arab Emirates\nResident Identity Card\nID Number 784-1990-1234567-1\nName: Mohammed Ali\nNationality: India', 'Emirates ID', { number: '784-1990-1234567-1', kind: 'Emirates ID' })
t('EID back (labelled)', 'Date of Birth 12/03/1990 Sex: M\nIssuing Date 06/05/2023\nExpiry Date 06/05/2028\nCard Number 123456789', 'Emirates ID', { expiry: '2028-05-06' })
t('EID back (no label: latest date wins)', 'DOB 12/03/1990\nIssue 06/05/2023\n06/05/2028', 'Emirates ID', { expiry: '2028-05-06' })
t('EID number with spaces', 'ID Number 784 1990 1234567 1', 'Emirates ID', { number: '784-1990-1234567-1' })
t('EID number, no separators', 'ID 784199012345671', 'Emirates ID', { number: '784-1990-1234567-1' })
t('EID number with OCR letter mistakes', 'ID Number 784-I990-123456B-l', 'Emirates ID', { number: '784-1990-1234568-1' })
t('EID found even when "Other" was picked', 'ID Number 784-1985-7654321-2', 'Other', { number: '784-1985-7654321-2', kind: 'Emirates ID', kindFromImage: true })
t('expiry with letter O instead of 0', 'Expiry Date: 06-O5-2O28', 'Emirates ID', { expiry: '2028-05-06' })
t('expiry written 2028/05/06', 'Expiry 2028/05/06', 'Emirates ID', { expiry: '2028-05-06' })
t('expiry in words', 'Date of Expiry 06 MAY 2028', 'Emirates ID', { expiry: '2028-05-06' })
t('expiry with the label on the line before', 'Expiry Date\n15/11/2027', 'Emirates ID', { expiry: '2027-11-15' })
t('day/month swapped when month >12 (m/d/y)', 'Expiry 05/28/2028', 'Emirates ID', { expiry: '2028-05-28' })
t('not a real date is ignored', 'Expiry 31/02/2028', 'Emirates ID', { expiry: null })

// passports (machine-readable zone)
const MRZ = 'P<INDKUMAR<<RAVI<<<<<<<<<<<<<<<<<<<<<<<<<<<<\nN1234567<8IND9003123M2805069<<<<<<<<<<<<<<<6'
t('passport MRZ', MRZ, 'Passport Copy', { number: 'N1234567', expiry: '2028-05-06', kind: 'Passport Copy', kindFromImage: true })
t('passport MRZ with spaces and « marks', MRZ.replace(/</g, '«').replace('P«IND', 'P< IND'), 'Passport Copy', { number: 'N1234567' })
t('passport detected although "Emirates ID" was selected', MRZ, 'Emirates ID', { kind: 'Passport Copy', number: 'N1234567' })
t('passport label number', 'Passport No. K9876543\nDate of Expiry 21 JUL 2031', 'Passport Copy', { number: 'K9876543', expiry: '2031-07-21' })

// visa, licence, labour card
t('visa UID + valid until', 'Residence Visa\nUID No: 123456789\nValid Until 30/09/2027', 'Visa Copy', { number: '123456789', expiry: '2027-09-30' })
t('trade licence', 'DED Trade Licence\nLicense No: 123456\nExpiry Date: 01/10/2027', 'Trade Licence', { number: '123456', expiry: '2027-10-01' })
t('labour card', 'Ministry of Human Resources\nLabour Card\nCard No: 12345678901\nExpiry Date 02/02/2026', 'Labour Card', { number: '12345678901', expiry: '2026-02-02' })

// nothing useful
t('empty text', '', 'Emirates ID', { number: null, expiry: null })
t('unrelated text', 'Thank you for visiting our shop', 'Emirates ID', { number: null, expiry: null })
t('a 1990 birth date alone is not taken as the expiry', 'Date of Birth 12/03/1990', 'Emirates ID', { expiry: null })

// two pictures (front + back) of one card
const m = S.merge([S.parse('ID Number 784-1990-1234567-1', 'Emirates ID'), S.parse('Expiry Date 06/05/2028', 'Emirates ID')])
const mOk = m.number === '784-1990-1234567-1' && m.expiry === '2028-05-06' && m.found.number && m.found.expiry
if (mOk) pass++; else fail.push('  ✗ front + back merge: ' + JSON.stringify(m))

const total = pass + fail.length
console.log(`${pass}/${total} correct`)
if (fail.length) console.log(fail.join('\n'))
process.exit(fail.length ? 1 : 0)
