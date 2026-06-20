const nodemailer = require('nodemailer');

// Create Transporter
let transporter = null;
const isMock = process.env.SMTP_USER === 'mock_user' || !process.env.SMTP_USER;

if (!isMock) {
  try {
    // Using the built-in 'gmail' service is more reliable on cloud providers
    // and automatically handles the correct ports and TLS settings.
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } catch (error) {
    console.error('Error creating Nodemailer transport:', error.message);
    transporter = null; // Fallback to mock logging
  }
}

/**
 * Send Email Notification
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} html - HTML body content
 * @param {string} textFallback - Plain text fallback
 */
async function sendMail(to, subject, html, textFallback) {
  const from = process.env.EMAIL_FROM || '"API Uptime Monitor" <alerts@uptime-monitor.local>';
  
  if (isMock || !transporter) {
    console.log('\n========================================================================');
    console.log(`✉️  [MOCK EMAIL SENT]`);
    console.log(`From:    ${from}`);
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Content:\n${textFallback}`);
    console.log('========================================================================\n');
    return { mock: true };
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: textFallback,
      html
    });
    console.log(`✉️  [EMAIL SENT] MessageId: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ [EMAIL ERROR] Failed to send email to ${to}:`, error.message);
    // Return gracefully so the main ping operation doesn't crash on email failure
    return { error: error.message };
  }
}

/**
 * Send DOWN Alert Email
 */
async function sendDownAlert(email, monitorName, monitorUrl, errorMessage, timestamp) {
  const subject = `🚨 ALERT: ${monitorName} is DOWN`;
  
  const textFallback = `
ALERT: Your monitor "${monitorName}" (${monitorUrl}) is DOWN!
Time: ${timestamp}
Error: ${errorMessage}
  `.trim();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #1f2937; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-top: 6px solid #ef4444; }
        .header { padding: 30px; text-align: center; background-color: #fef2f2; }
        .header h1 { margin: 0; color: #dc2626; font-size: 24px; font-weight: 700; }
        .content { padding: 30px; line-height: 1.6; }
        .monitor-card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .monitor-name { font-size: 18px; font-weight: 600; margin: 0 0 5px 0; color: #0f172a; }
        .monitor-url { font-size: 14px; color: #64748b; margin: 0; word-break: break-all; }
        .details-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .details-table td { padding: 8px 0; font-size: 14px; }
        .details-table td.label { color: #64748b; width: 120px; font-weight: 500; }
        .details-table td.value { color: #0f172a; font-weight: 600; }
        .error-badge { display: inline-block; background-color: #fef2f2; border: 1px solid #fee2e2; color: #b91c1c; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-family: monospace; word-break: break-all; margin-top: 10px; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; background-color: #f8fafc; border-top: 1px solid #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 Incident Alert</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>This is an automated alert from your API Uptime Monitor. One of your monitored endpoints has gone <strong>DOWN</strong>.</p>
          
          <div class="monitor-card">
            <p class="monitor-name">${monitorName}</p>
            <p class="monitor-url"><a href="${monitorUrl}" target="_blank" style="color: #3b82f6; text-decoration: none;">${monitorUrl}</a></p>
            
            <table class="details-table">
              <tr>
                <td class="label">Event Status</td>
                <td class="value" style="color: #ef4444;">DOWN</td>
              </tr>
              <tr>
                <td class="label">Detected At</td>
                <td class="value">${timestamp}</td>
              </tr>
            </table>
            
            <div style="margin-top: 10px;">
              <span style="font-size: 13px; font-weight: 500; color: #64748b; display: block;">Error Reason:</span>
              <div class="error-badge">${errorMessage}</div>
            </div>
          </div>
          
          <p>We will continue to check this endpoint and notify you immediately once it recovers.</p>
        </div>
        <div class="footer">
          <p>Sent by API Uptime Monitor &bull; Portfolio Project</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendMail(email, subject, html, textFallback);
}

/**
 * Send UP Alert Email (Recovery)
 */
async function sendUpAlert(email, monitorName, monitorUrl, downtimeDuration, timestamp) {
  const subject = `✅ RECOVERY: ${monitorName} is UP`;
  
  const textFallback = `
RECOVERY: Your monitor "${monitorName}" (${monitorUrl}) is back UP!
Time: ${timestamp}
Downtime Duration: ${downtimeDuration}
  `.trim();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #1f2937; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-top: 6px solid #10b981; }
        .header { padding: 30px; text-align: center; background-color: #ecfdf5; }
        .header h1 { margin: 0; color: #059669; font-size: 24px; font-weight: 700; }
        .content { padding: 30px; line-height: 1.6; }
        .monitor-card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .monitor-name { font-size: 18px; font-weight: 600; margin: 0 0 5px 0; color: #0f172a; }
        .monitor-url { font-size: 14px; color: #64748b; margin: 0; word-break: break-all; }
        .details-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .details-table td { padding: 8px 0; font-size: 14px; }
        .details-table td.label { color: #64748b; width: 120px; font-weight: 500; }
        .details-table td.value { color: #0f172a; font-weight: 600; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; background-color: #f8fafc; border-top: 1px solid #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Incident Resolved</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Good news! Your monitored endpoint is back online and responding normally.</p>
          
          <div class="monitor-card">
            <p class="monitor-name">${monitorName}</p>
            <p class="monitor-url"><a href="${monitorUrl}" target="_blank" style="color: #3b82f6; text-decoration: none;">${monitorUrl}</a></p>
            
            <table class="details-table">
              <tr>
                <td class="label">Event Status</td>
                <td class="value" style="color: #10b981;">UP</td>
              </tr>
              <tr>
                <td class="label">Recovered At</td>
                <td class="value">${timestamp}</td>
              </tr>
              <tr>
                <td class="label">Total Downtime</td>
                <td class="value" style="color: #b91c1c;">${downtimeDuration}</td>
              </tr>
            </table>
          </div>
          
          <p>We will continue to monitor the site and notify you of any future changes.</p>
        </div>
        <div class="footer">
          <p>Sent by API Uptime Monitor &bull; Portfolio Project</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendMail(email, subject, html, textFallback);
}

/**
 * Send UP Alert Email (Recovery)
 * ... (existing is above, wait - let's make sure the search is exact!)
 */

/**
 * Send Email Verification Code
 */
async function sendVerificationEmail(email, code) {
  const subject = `🛡️ Verify Your Account - UptimePulse`;
  
  const textFallback = `
Welcome to UptimePulse!
Please verify your email address to activate your account.
Your 6-digit verification code is: ${code}
This code will expire in 15 minutes.
  `.trim();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #1f2937; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-top: 6px solid #6366f1; }
        .header { padding: 30px; text-align: center; background-color: #e0e7ff; }
        .header h1 { margin: 0; color: #4338ca; font-size: 24px; font-weight: 700; }
        .content { padding: 30px; line-height: 1.6; text-align: center; }
        .code-box { display: inline-block; background-color: #f5f3ff; border: 2px dashed #8b5cf6; color: #6d28d9; padding: 12px 24px; border-radius: 8px; font-size: 28px; font-weight: 700; letter-spacing: 0.15em; font-family: monospace; margin: 24px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; background-color: #f8fafc; border-top: 1px solid #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛡️ Email Verification Required</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Thank you for registering an account on UptimePulse! To complete your registration and begin monitoring your endpoints, please verify your email address by entering the code below:</p>
          
          <div class="code-box">${code}</div>
          
          <p style="font-size: 13px; color: #64748b;">This verification code is valid for <strong>15 minutes</strong>. If you did not register this account, please ignore this email.</p>
        </div>
        <div class="footer">
          <p>Sent by API Uptime Monitor &bull; Portfolio Project</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendMail(email, subject, html, textFallback);
}

module.exports = {
  sendDownAlert,
  sendUpAlert,
  sendVerificationEmail
};
