const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

/**
 * GET /api/incidents
 * Get historical downtime incidents for all monitors belonging to the authenticated user
 */
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const incidents = await db.query(
      `SELECT 
         i.id,
         i.monitor_id,
         i.down_time,
         i.up_time,
         i.error_message,
         i.duration_minutes,
         m.name as monitor_name,
         m.url as monitor_url
       FROM incidents i
       JOIN monitors m ON i.monitor_id = m.id
       WHERE m.user_id = ?
       ORDER BY i.down_time DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      incidents
    });
  } catch (error) {
    console.error('Fetch incidents error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving incident history.' });
  }
});

module.exports = router;
