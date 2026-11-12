import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
dotenv.config()

const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'alnoor_erp',
  waitForConnections: true,
  connectionLimit:    10,
  timezone: '+04:00',
  charset:  'utf8mb4',
  // Ensure utf8mb4 on every new connection
  typeCast: true,
})

// Wrap pool.query to run SET NAMES on fresh connections
const _getConn = pool.getConnection.bind(pool)
pool.getConnection = async (...args) => {
  const conn = await _getConn(...args)
  try { await conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'") } catch {}
  return conn
}

export default pool
