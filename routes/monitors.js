const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const pinger = require('../services/pinger');

// Helper to validate URLs
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * GET /api/monitors
 * Get all monitors for the authenticated user, with uptime % and avg latency
 */
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const monitors = await db.query(
      'SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    // Fetch stats for each monitor
    for (let monitor of monitors) {
      const stats = await db.query(
        `SELECT 
           COUNT(id) as total, 
           SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_count,
           AVG(response_time_ms) as avg_latency
         FROM checks 
         WHERE monitor_id = ?`,
        [monitor.id]
      );

      const total = stats[0].total || 0;
      const upCount = stats[0].up_count || 0;
      const avgLatency = stats[0].avg_latency || 0;

      monitor.uptime_percentage = total > 0 ? parseFloat(((upCount / total) * 100).toFixed(2)) : 100.00;
      monitor.avg_response_time = Math.round(avgLatency);
      
      // Convert SQLite is_active integer to boolean if needed, or maintain consistency
      monitor.is_active = !!monitor.is_active;
    }

    res.status(200).json({ success: true, monitors });
  } catch (error) {
    console.error('Fetch monitors error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving monitors.' });
  }
});

/**
 * GET /api/monitors/:id
 * Get details of a single monitor, including recent checks (for charts) and incident logs
 */
router.get('/:id', authenticateToken, async (req, res) => {
  const monitorId = req.params.id;
  const userId = req.user.id;

  try {
    // Verify ownership
    const monitors = await db.query(
      'SELECT * FROM monitors WHERE id = ? AND user_id = ?',
      [monitorId, userId]
    );

    if (!monitors || monitors.length === 0) {
      return res.status(404).json({ success: false, message: 'Monitor not found.' });
    }

    const monitor = monitors[0];
    monitor.is_active = !!monitor.is_active;

    // Get overall stats
    const stats = await db.query(
      `SELECT 
         COUNT(id) as total, 
         SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_count,
         AVG(response_time_ms) as avg_latency
       FROM checks 
       WHERE monitor_id = ?`,
      [monitorId]
    );
    const total = stats[0].total || 0;
    const upCount = stats[0].up_count || 0;
    monitor.uptime_percentage = total > 0 ? parseFloat(((upCount / total) * 100).toFixed(2)) : 100.00;
    monitor.avg_response_time = Math.round(stats[0].avg_latency || 0);

    // Get recent 50 checks for the chart (ordered chronologically for plotting)
    const checks = await db.query(
      `SELECT status, response_time_ms, timestamp 
       FROM (
         SELECT id, status, response_time_ms, timestamp 
         FROM checks 
         WHERE monitor_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 50
       ) sub
       ORDER BY timestamp ASC`,
      [monitorId]
    );

    // Get recent 10 incidents
    const incidents = await db.query(
      `SELECT id, down_time, up_time, error_message, duration_minutes 
       FROM incidents 
       WHERE monitor_id = ? 
       ORDER BY down_time DESC 
       LIMIT 10`,
      [monitorId]
    );

    res.status(200).json({
      success: true,
      monitor,
      checks,
      incidents
    });
  } catch (error) {
    console.error('Fetch monitor details error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving monitor details.' });
  }
});

/**
 * POST /api/monitors
 * Create a new monitor and trigger initial check
 */
router.post('/', authenticateToken, async (req, res) => {
  const { name, url } = req.body;
  const userId = req.user.id;

  if (!name || !url) {
    return res.status(400).json({ success: false, message: 'Name and URL are required.' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ success: false, message: 'Invalid URL. Must start with http:// or https://' });
  }

  try {
    // Insert new monitor
    const result = await db.query(
      `INSERT INTO monitors (user_id, name, url, status, is_active) 
       VALUES (?, ?, ?, 'PENDING', 1)`,
      [userId, name.trim(), url.trim()]
    );

    const monitorId = result.insertId;

    // Fire-and-forget: perform initial ping immediately
    pinger.pingMonitor(monitorId).catch(err => {
      console.error(`Error during initial ping for monitor ${monitorId}:`, err);
    });

    res.status(201).json({
      success: true,
      message: 'Monitor created successfully. Initializing check...',
      monitor: {
        id: monitorId,
        name,
        url,
        status: 'PENDING',
        is_active: true
      }
    });
  } catch (error) {
    console.error('Create monitor error:', error);
    res.status(500).json({ success: false, message: 'Server error creating monitor.' });
  }
});

/**
 * PUT /api/monitors/:id
 * Update an existing monitor's details or toggle active status
 */
router.put('/:id', authenticateToken, async (req, res) => {
  const monitorId = req.params.id;
  const userId = req.user.id;
  const { name, url, is_active } = req.body;

  try {
    // Verify ownership
    const monitors = await db.query(
      'SELECT id, is_active FROM monitors WHERE id = ? AND user_id = ?',
      [monitorId, userId]
    );

    if (!monitors || monitors.length === 0) {
      return res.status(404).json({ success: false, message: 'Monitor not found.' });
    }

    const currentMonitor = monitors[0];

    // Build update fields dynamically
    const updateFields = [];
    const params = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name.trim());
    }

    if (url !== undefined) {
      if (!isValidUrl(url)) {
        return res.status(400).json({ success: false, message: 'Invalid URL. Must start with http:// or https://' });
      }
      updateFields.push('url = ?');
      params.push(url.trim());
    }

    if (is_active !== undefined) {
      const activeVal = is_active ? 1 : 0;
      updateFields.push('is_active = ?');
      params.push(activeVal);
      
      // If toggling from paused to active, clear PENDING/DOWN status back to active check status
      if (!currentMonitor.is_active && activeVal === 1) {
        updateFields.push("status = 'PENDING'");
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No update parameters provided.' });
    }

    params.push(monitorId);

    await db.query(
      `UPDATE monitors SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    // If monitor was just re-activated, trigger a ping check
    if (!currentMonitor.is_active && is_active === true) {
      pinger.pingMonitor(monitorId).catch(err => {
        console.error(`Error during re-activation ping for monitor ${monitorId}:`, err);
      });
    }

    res.status(200).json({ success: true, message: 'Monitor updated successfully.' });
  } catch (error) {
    console.error('Update monitor error:', error);
    res.status(500).json({ success: false, message: 'Server error updating monitor.' });
  }
});

/**
 * DELETE /api/monitors/:id
 * Delete a monitor (and cascades checks/incidents)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  const monitorId = req.params.id;
  const userId = req.user.id;

  try {
    // Verify ownership
    const monitors = await db.query(
      'SELECT id FROM monitors WHERE id = ? AND user_id = ?',
      [monitorId, userId]
    );

    if (!monitors || monitors.length === 0) {
      return res.status(404).json({ success: false, message: 'Monitor not found.' });
    }

    // Delete monitor. Cascade deletes associated checks/incidents.
    await db.query('DELETE FROM monitors WHERE id = ?', [monitorId]);

    res.status(200).json({ success: true, message: 'Monitor and all associated records deleted.' });
  } catch (error) {
    console.error('Delete monitor error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting monitor.' });
  }
});

/**
 * POST /api/monitors/:id/check
 * Trigger immediate manual check for a monitor
 */
router.post('/:id/check', authenticateToken, async (req, res) => {
  const monitorId = req.params.id;
  const userId = req.user.id;

  try {
    // Verify ownership
    const monitors = await db.query(
      'SELECT id, is_active FROM monitors WHERE id = ? AND user_id = ?',
      [monitorId, userId]
    );

    if (!monitors || monitors.length === 0) {
      return res.status(404).json({ success: false, message: 'Monitor not found.' });
    }

    if (!monitors[0].is_active) {
      return res.status(400).json({ success: false, message: 'Cannot check a paused monitor.' });
    }

    // Run synchronous ping check for this monitor and return result
    const result = await pinger.pingMonitor(monitorId);

    res.status(200).json({
      success: true,
      message: 'Ping completed successfully.',
      checkResult: result
    });
  } catch (error) {
    console.error('Manual check error:', error);
    res.status(500).json({ success: false, message: 'Server error running check.' });
  }
});

/**
 * GET /api/monitors/:id/history
 * Get full incident history for a specific monitor (Postman/API checklist endpoint)
 */
router.get('/:id/history', authenticateToken, async (req, res) => {
  const monitorId = req.params.id;
  const userId = req.user.id;

  try {
    // Verify ownership
    const monitors = await db.query(
      'SELECT id, name, url FROM monitors WHERE id = ? AND user_id = ?',
      [monitorId, userId]
    );

    if (!monitors || monitors.length === 0) {
      return res.status(404).json({ success: false, message: 'Monitor not found.' });
    }

    // Fetch all incidents for this monitor
    const incidents = await db.query(
      `SELECT 
         id,
         monitor_id,
         down_time,
         up_time,
         error_message,
         duration_minutes,
         CASE WHEN up_time IS NULL THEN 'ONGOING' ELSE 'RESOLVED' END as resolution_status
       FROM incidents 
       WHERE monitor_id = ? 
       ORDER BY down_time DESC`,
      [monitorId]
    );

    // Also return last 20 raw checks for debugging
    const recentChecks = await db.query(
      `SELECT status, status_code, response_time_ms, error_message, timestamp 
       FROM checks 
       WHERE monitor_id = ? 
       ORDER BY timestamp DESC 
       LIMIT 20`,
      [monitorId]
    );

    res.status(200).json({
      success: true,
      monitor: monitors[0],
      total_incidents: incidents.length,
      incidents,
      recent_checks: recentChecks
    });
  } catch (error) {
    console.error('Fetch history error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving history.' });
  }
});

module.exports = router;

