const db = require('../config/db');
const emailService = require('./email');

/**
 * Helper to format duration in milliseconds to human-readable string (e.g., 5m 23s)
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Pings a single monitor by ID and records results
 * @param {number} monitorId 
 */
async function pingMonitor(monitorId) {
  // 1. Fetch monitor & user info
  const monitors = await db.query(
    `SELECT m.*, u.email as user_email, u.name as user_name 
     FROM monitors m 
     JOIN users u ON m.user_id = u.id 
     WHERE m.id = ?`,
    [monitorId]
  );

  if (!monitors || monitors.length === 0) {
    console.error(`[Pinger] Monitor ${monitorId} not found.`);
    return;
  }

  const monitor = monitors[0];
  if (!monitor.is_active) {
    console.log(`[Pinger] Monitor "${monitor.name}" is paused. Skipping.`);
    return;
  }

  console.log(`[Pinger] Checking ${monitor.name} (${monitor.url})...`);

  const startTime = Date.now();
  let statusCode = null;
  let status = 'DOWN';
  let errorMessage = null;
  let responseTime = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(monitor.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'API-Uptime-Monitor/1.0 (Portfolio Project)'
      }
    });

    clearTimeout(timeoutId);
    responseTime = Date.now() - startTime;
    statusCode = response.status;

    if (response.ok) {
      status = 'UP';
    } else {
      status = 'DOWN';
      errorMessage = `HTTP Error Code: ${response.status} (${response.statusText})`;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    responseTime = Date.now() - startTime;
    status = 'DOWN';

    if (error.name === 'AbortError') {
      errorMessage = 'Timeout: Request took longer than 10 seconds';
    } else {
      errorMessage = error.message || 'Unknown network error';
    }
  }

  const timestamp = new Date();

  // 2. Insert check result into database
  await db.query(
    `INSERT INTO checks (monitor_id, status, status_code, response_time_ms, error_message, timestamp) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [monitorId, status, statusCode, responseTime, errorMessage, timestamp]
  );

  // 3. Handle state transitions
  const previousStatus = monitor.status;
  
  // Update monitor last check time and current status
  await db.query(
    `UPDATE monitors SET status = ?, last_checked = ? WHERE id = ?`,
    [status, timestamp, monitorId]
  );

  // UP -> DOWN Transition
  if (status === 'DOWN' && (previousStatus === 'UP' || previousStatus === 'PENDING')) {
    console.log(`🚨 [ALERT] "${monitor.name}" has gone DOWN. Reason: ${errorMessage}`);
    
    // Log incident
    await db.query(
      `INSERT INTO incidents (monitor_id, down_time, error_message) VALUES (?, ?, ?)`,
      [monitorId, timestamp, errorMessage]
    );

    // Send email alert
    await emailService.sendDownAlert(
      monitor.user_email,
      monitor.name,
      monitor.url,
      errorMessage,
      timestamp.toLocaleString()
    );
  } 
  // DOWN -> UP Transition
  else if (status === 'UP' && previousStatus === 'DOWN') {
    console.log(`✅ [RESOLVED] "${monitor.name}" has recovered and is UP.`);

    // Find open incident (up_time is NULL)
    const openIncidents = await db.query(
      `SELECT * FROM incidents WHERE monitor_id = ? AND up_time IS NULL ORDER BY down_time DESC LIMIT 1`,
      [monitorId]
    );

    let downtimeText = 'unknown duration';
    
    if (openIncidents && openIncidents.length > 0) {
      const incident = openIncidents[0];
      const downTimeDate = new Date(incident.down_time);
      const downtimeMs = timestamp - downTimeDate;
      const downtimeMinutes = Math.max(1, Math.round(downtimeMs / 60000));
      downtimeText = formatDuration(downtimeMs);

      // Close the incident
      await db.query(
        `UPDATE incidents SET up_time = ?, duration_minutes = ? WHERE id = ?`,
        [timestamp, downtimeMinutes, incident.id]
      );
    }

    // Send email alert
    await emailService.sendUpAlert(
      monitor.user_email,
      monitor.name,
      monitor.url,
      downtimeText,
      timestamp.toLocaleString()
    );
  }

  return {
    status,
    statusCode,
    responseTime,
    errorMessage,
    timestamp
  };
}

/**
 * Runs pings on all active monitors
 */
async function pingAllMonitors() {
  console.log(`[Pinger] Starting check cycle for all active monitors...`);
  
  try {
    const activeMonitors = await db.query(
      `SELECT id FROM monitors WHERE is_active = 1`
    );

    if (!activeMonitors || activeMonitors.length === 0) {
      console.log(`[Pinger] No active monitors found to ping.`);
      return;
    }

    // Ping all monitors concurrently (or in sequence if pool is small - concurrency here is fine)
    const promises = activeMonitors.map(m => pingMonitor(m.id));
    await Promise.allSettled(promises);
    
    console.log(`[Pinger] Check cycle completed.`);
  } catch (error) {
    console.error(`[Pinger] Error during bulk ping checks:`, error);
  }
}

module.exports = {
  pingMonitor,
  pingAllMonitors
};
