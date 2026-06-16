require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const db = require('./config/db');
const cronService = require('./services/cron');

// Import routers
const authRouter = require('./routes/auth');
const monitorsRouter = require('./routes/monitors');
const incidentsRouter = require('./routes/incidents');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/monitors', monitorsRouter);
app.use('/api/incidents', incidentsRouter);

// Fallback to send index.html for Single Page App routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after database initialization
async function startServer() {
  try {
    // 1. Initialize DB tables
    await db.initialize();

    if (db.DB_TYPE === 'mysql') {
      console.log('✅ MySQL connected!');
    } else {
      console.log('✅ SQLite connected!');
    }

    // 2. Start node-cron background job
    cronService.startCron();
    console.log('✅ Cron job started — monitors will be checked every 5 minutes.');

    // 3. Listen on port
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running on port ${PORT} → http://localhost:${PORT}`);
      console.log(`📁 Dashboard:  http://localhost:${PORT}`);
      console.log(`📡 API Base:   http://localhost:${PORT}/api`);
      console.log(`\nPress Ctrl+C to stop the server.\n`);
    });
  } catch (err) {
    console.error('❌ CRITICAL: Server initialization failed:', err);
    process.exit(1);
  }
}

startServer();

