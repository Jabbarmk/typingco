// Brings an older database up to the shape described in database/schema.sql, without touching data:
//  - creates tables that do not exist yet
//  - adds columns that are missing
//  - widens ENUM columns that lack values the code now writes
// Production was built from an earlier schema, which caused "Unknown column ..." errors on insert.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from './db.js'

const SCHEMA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../database/schema.sql')
const SKIP_ITEM = /^(PRIMARY\s+KEY|UNIQUE|KEY|INDEX|FOREIGN\s+KEY|CONSTRAINT|CHECK|FULLTEXT)\b/i

// Split on a character at nesting depth 0, ignoring quoted text
function splitTop(text, sep) {
  const out = []; let depth = 0, q = null, cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function parseSchema(sql) {
  const clean = sql.replace(/\r/g, '').split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
  const tables = []
  for (const stmt of splitTop(clean, ';')) {
    const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)\s*[^)]*$/i)
    if (!m) continue
    const columns = []
    for (const item of splitTop(m[2], ',')) {
      const t = item.trim()
      if (!t || SKIP_ITEM.test(t)) continue
      const cm = t.match(/^`?(\w+)`?\s+([\s\S]+)$/)
      if (cm) columns.push({ name: cm[1], def: cm[2].replace(/\s+/g, ' ').trim() })
    }
    tables.push({ name: m[1], create: stmt.trim(), columns })
  }
  return tables
}

// Column definition that is safe to use in ALTER TABLE ... ADD COLUMN
function alterDef(def) {
  return def
    .replace(/\bAUTO_INCREMENT\b/ig, '')
    .replace(/\bPRIMARY\s+KEY\b/ig, '')
    .replace(/\bUNIQUE(\s+KEY)?\b/ig, '')
    .replace(/\bREFERENCES\s+\w+\s*\([^)]*\)/ig, '')
    .replace(/\s+/g, ' ').trim()
}

const enumValues = s => [...s.matchAll(/'((?:[^']|'')*)'/g)].map(x => x[1])

export async function repairSchema() {
  let sql
  try { sql = fs.readFileSync(SCHEMA_FILE, 'utf8') } catch { console.warn('schema-repair: schema.sql not found, skipped'); return { tables: [], columns: [], enums: [] } }
  const tables = parseSchema(sql)
  const report = { tables: [], columns: [], enums: [] }

  const [have] = await pool.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
  const existing = new Set(have.map(r => r.t.toLowerCase()))

  // 1) missing tables (two passes so foreign keys to later tables can resolve)
  for (let pass = 0; pass < 2; pass++) {
    for (const t of tables) {
      if (existing.has(t.name.toLowerCase())) continue
      try {
        await pool.query(t.create.replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS '))
        existing.add(t.name.toLowerCase()); report.tables.push(t.name)
      } catch (e) { if (pass) console.error(`schema-repair: could not create ${t.name}: ${e.message}`) }
    }
  }

  // 2) missing columns and 3) enum values
  const [cols] = await pool.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')
  const byTable = new Map()
  for (const r of cols) {
    const k = r.t.toLowerCase()
    if (!byTable.has(k)) byTable.set(k, new Map())
    byTable.get(k).set(r.c.toLowerCase(), r.ty)
  }
  for (const t of tables) {
    const have = byTable.get(t.name.toLowerCase())
    if (!have || report.tables.includes(t.name)) continue
    for (const col of t.columns) {
      const key = col.name.toLowerCase()
      if (!have.has(key)) {
        if (/AUTO_INCREMENT/i.test(col.def)) continue
        try {
          await pool.query(`ALTER TABLE \`${t.name}\` ADD COLUMN \`${col.name}\` ${alterDef(col.def)}`)
          report.columns.push(`${t.name}.${col.name}`)
        } catch (e) { console.error(`schema-repair: ${t.name}.${col.name}: ${e.message}`) }
      } else if (/^enum\(/i.test(col.def)) {
        const want = enumValues(col.def.match(/^enum\(([\s\S]*?)\)/i)[0])
        const cur = enumValues(have.get(key))
        const missing = want.filter(v => !cur.includes(v))
        if (missing.length) {
          const merged = [...cur, ...missing].map(v => `'${v}'`).join(',')
          const rest = alterDef(col.def).replace(/^enum\([\s\S]*?\)/i, '')
          try {
            await pool.query(`ALTER TABLE \`${t.name}\` MODIFY COLUMN \`${col.name}\` ENUM(${merged})${rest}`)
            report.enums.push(`${t.name}.${col.name} += ${missing.join('/')}`)
          } catch (e) { console.error(`schema-repair: enum ${t.name}.${col.name}: ${e.message}`) }
        }
      }
    }
  }
  if (report.tables.length)  console.log('schema-repair: created tables →', report.tables.join(', '))
  if (report.columns.length) console.log('schema-repair: added columns →', report.columns.join(', '))
  if (report.enums.length)   console.log('schema-repair: extended enums →', report.enums.join(', '))
  return report
}
