const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const DB_TYPE = (process.env.DB_TYPE || 'mysql').toLowerCase();

let mysqlPool = null;
let sqliteDb = null;

// Initialize SQLite database
function getSqliteDb() {
  if (!sqliteDb) {
    const dbPath = path.resolve(__dirname, '../uptime_monitor.sqlite');
    sqliteDb = new sqlite3.Database(dbPath);
  }
  return sqliteDb;
}

// Promisify SQLite methods
function sqliteQuery(sql, params = []) {
  const db = getSqliteDb();
  return new Promise((resolve, reject) => {
    // Check if it is a write query
    const isWrite = /^\s*(insert|update|delete|create|drop|alter)/i.test(sql);
    
    if (isWrite) {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({
          insertId: this.lastID,
          affectedRows: this.changes
        });
      });
    } else {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    }
  });
}

// Connect to MySQL
async function getMysqlPool() {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'uptime_monitor',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return mysqlPool;
}

// Main query interface
async function query(sql, params = []) {
  if (DB_TYPE === 'sqlite') {
    return sqliteQuery(sql, params);
  } else {
    const pool = await getMysqlPool();
    const [result] = await pool.query(sql, params);
    return result;
  }
}

// Database Initialization helper
async function initialize() {
  if (DB_TYPE === 'sqlite') {
    console.log('Using SQLite Database. Initializing tables...');
    try {
      // Create tables sequentially in SQLite
      await sqliteQuery(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_verified INTEGER DEFAULT 0,
          verification_code TEXT,
          verification_expires DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await sqliteQuery(`
        CREATE TABLE IF NOT EXISTS monitors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING',
          is_active INTEGER DEFAULT 1,
          last_checked DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await sqliteQuery(`
        CREATE TABLE IF NOT EXISTS checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          monitor_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          status_code INTEGER,
          response_time_ms INTEGER,
          error_message TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `);

      await sqliteQuery(`
        CREATE TABLE IF NOT EXISTS incidents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          monitor_id INTEGER NOT NULL,
          down_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          up_time DATETIME,
          error_message TEXT,
          duration_minutes INTEGER,
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `);
      
      console.log('SQLite tables initialized successfully.');
    } catch (error) {
      console.error('Error initializing SQLite database:', error);
      throw error;
    }
  } else {
    console.log('Using MySQL Database. Testing connection...');
    try {
      const pool = await getMysqlPool();
      // Test the pool
      const connection = await pool.getConnection();
      console.log('Successfully connected to MySQL database.');

      // Auto-migration for existing MySQL users table
      try {
        const [tables] = await connection.query("SHOW TABLES LIKE 'users'");
        if (tables.length > 0) {
          const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'is_verified'");
          if (columns.length === 0) {
            console.log('[Migration] Appending email verification columns to existing MySQL users table...');
            await connection.query("ALTER TABLE users ADD COLUMN is_verified TINYINT(1) DEFAULT 0");
            await connection.query("ALTER TABLE users ADD COLUMN verification_code VARCHAR(6) DEFAULT NULL");
            await connection.query("ALTER TABLE users ADD COLUMN verification_expires TIMESTAMP NULL DEFAULT NULL");
            console.log('[Migration] Database tables successfully updated.');
          }
        }
      } catch (migrationErr) {
        console.warn('[Migration] Warning: Non-critical migration query failed:', migrationErr.message);
      }

      connection.release();
    } catch (error) {
      console.error('Failed to connect to MySQL database:', error.message);
      console.log('Ensure MySQL is running and database configuration in .env is correct.');
      console.log('Or switch to SQLite by setting DB_TYPE=sqlite in .env');
      throw error;
    }
  }
}

module.exports = {
  query,
  initialize,
  DB_TYPE
};
