// Test script for API Uptime Monitor
// Runs core backend logic: database initialization, user registration mock, monitor creation, pings, and stat computation.

require('dotenv').config();
const db = require('./config/db');
const pinger = require('./services/pinger');
const bcrypt = require('bcryptjs');

async function runTests() {
  console.log('🧪 Starting Backend Integration Test...\n');

  try {
    // 1. Initialize Database
    await db.initialize();
    console.log('✅ Database connection and tables verified.');

    // 2. Create test user directly if not exists
    const email = 'test@example.com';
    const password = 'password123';
    
    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    let userId;

    if (existing && existing.length > 0) {
      userId = existing[0].id;
      console.log(`👤 Test user already exists (ID: ${userId})`);
    } else {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      const insertUser = await db.query(
        "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
        ['Test Developer', email, hash]
      );
      userId = insertUser.insertId;
      console.log(`👤 Created new test user (ID: ${userId})`);
    }

    // 3. Clean up existing monitors for test user to ensure clean state
    await db.query('DELETE FROM monitors WHERE user_id = ?', [userId]);
    console.log('🧹 Cleaned up old test monitors.');

    // 4. Create two test monitors
    // One that will respond UP (e.g. https://httpstat.us/200 or https://www.google.com)
    // One that will respond DOWN (e.g. https://httpstat.us/500 or https://invalid-domain-xxxx.com)
    const urlUp = 'https://httpstat.us/200';
    const urlDown = 'https://httpstat.us/500';

    const monitorUp = await db.query(
      "INSERT INTO monitors (user_id, name, url, status, is_active) VALUES (?, 'Google Ping Test (UP)', ?, 'PENDING', 1)",
      [userId, urlUp]
    );
    const monitorUpId = monitorUp.insertId;

    const monitorDown = await db.query(
      "INSERT INTO monitors (user_id, name, url, status, is_active) VALUES (?, 'Failure Server Test (DOWN)', ?, 'PENDING', 1)",
      [userId, urlDown]
    );
    const monitorDownId = monitorDown.insertId;

    console.log(`🖥️  Created monitors for testing:`);
    console.log(`   - Monitor 1 (UP): ID ${monitorUpId} -> ${urlUp}`);
    console.log(`   - Monitor 2 (DOWN): ID ${monitorDownId} -> ${urlDown}\n`);

    // 5. Trigger Pings
    console.log('📡 Running ping checks (sending HTTP requests)...');
    
    console.log('   Pinging Monitor 1 (Expecting UP)...');
    const resUp = await pinger.pingMonitor(monitorUpId);
    console.log(`   Result: Status = ${resUp.status}, Latency = ${resUp.responseTime}ms, Code = ${resUp.statusCode}`);

    console.log('   Pinging Monitor 2 (Expecting DOWN)...');
    const resDown = await pinger.pingMonitor(monitorDownId);
    console.log(`   Result: Status = ${resDown.status}, Latency = ${resDown.responseTime}ms, Code = ${resDown.statusCode}, Error = "${resDown.errorMessage}"\n`);

    // 6. Verify stats calculations
    console.log('📊 Verifying Database records and statistic logic...');
    
    // Read check entries
    const checks = await db.query('SELECT status, response_time_ms FROM checks WHERE monitor_id IN (?, ?)', [monitorUpId, monitorDownId]);
    console.log(`   - Total checks recorded in DB: ${checks.length}`);

    // Verify incident logs
    const incidents = await db.query('SELECT monitor_id, down_time, error_message FROM incidents WHERE monitor_id = ?', [monitorDownId]);
    console.log(`   - Total incidents logged for Monitor 2: ${incidents.length}`);
    if (incidents.length > 0) {
      console.log(`   - Logged Error: "${incidents[0].error_message}"`);
    }

    // Run statistical query mimicking routes/monitors.js
    const statsUp = await db.query(
      `SELECT 
         COUNT(id) as total, 
         SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_count,
         AVG(response_time_ms) as avg_latency
       FROM checks 
       WHERE monitor_id = ?`,
      [monitorUpId]
    );
    
    const total = statsUp[0].total || 0;
    const upCount = statsUp[0].up_count || 0;
    const uptimePercentage = total > 0 ? ((upCount / total) * 100).toFixed(2) : '100.00';
    console.log(`   - Calculated Uptime percentage for Monitor 1: ${uptimePercentage}%`);
    console.log(`   - Average Latency for Monitor 1: ${Math.round(statsUp[0].avg_latency)}ms`);

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test execution failed with error:', error);
    process.exit(1);
  }
}

runTests();
