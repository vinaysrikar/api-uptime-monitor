const cron = require('node-cron');
const pinger = require('./pinger');

/**
 * Initializes and starts the background cron schedules
 */
function startCron() {
  console.log('[Cron] Initializing background pinger service...');
  
  // Default to standard 5 minutes, support 1 minute toggle via ENV for easier grading / demo
  const useOneMinute = process.env.CRON_INTERVAL_1M === 'true';
  const cronPattern = useOneMinute ? '* * * * *' : '*/5 * * * *';
  const intervalLabel = useOneMinute ? '1 minute' : '5 minutes';
  
  cron.schedule(cronPattern, async () => {
    console.log(`[Cron] Starting scheduled cron checks at ${new Date().toLocaleTimeString()}...`);
    try {
      await pinger.pingAllMonitors();
    } catch (err) {
      console.error('[Cron] Error running scheduled pinger:', err);
    }
  });

  console.log(`[Cron] Background cron scheduler registered: pings run every ${intervalLabel} (${cronPattern}).`);
}

module.exports = {
  startCron
};
