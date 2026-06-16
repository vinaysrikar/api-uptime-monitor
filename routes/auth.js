const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const emailService = require('../services/email');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_portfolio_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * POST /api/auth/register
 * Register a new user and send a verification code
 */
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  // Simple validation
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  try {
    // Check if user already exists
    const existingUser = await db.query('SELECT id, is_verified FROM users WHERE email = ?', [email]);
    if (existingUser && existingUser.length > 0) {
      const user = existingUser[0];
      if (!user.is_verified) {
        return res.status(400).json({ 
          success: false, 
          message: 'An account with this email is pending verification.', 
          requiresVerification: true, 
          email 
        });
      }
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Save user as unverified
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, is_verified, verification_code, verification_expires) 
       VALUES (?, ?, ?, 0, ?, ?)`,
      [name, email, passwordHash, verificationCode, verificationExpires]
    );

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationCode);

    res.status(201).json({
      success: true,
      message: 'Account registered successfully. A verification code has been sent to your email.',
      requiresVerification: true,
      email
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

/**
 * POST /api/auth/verify
 * Verify the 6-digit code and activate account
 */
router.post('/verify', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
  }

  try {
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const user = users[0];

    if (user.is_verified) {
      return res.status(400).json({ success: false, message: 'Account is already verified.' });
    }

    if (user.verification_code !== code) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    // Check expiry
    const expiry = new Date(user.verification_expires);
    if (expiry < new Date()) {
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new one.' });
    }

    // Activate user
    await db.query(
      'UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?',
      [user.id]
    );

    // Generate session JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(200).json({
      success: true,
      message: 'Email verified and account activated successfully.',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend a new verification code
 */
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const user = users[0];

    if (user.is_verified) {
      return res.status(400).json({ success: false, message: 'Account is already verified.' });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Update DB
    await db.query(
      'UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?',
      [verificationCode, verificationExpires, user.id]
    );

    // Send email
    await emailService.sendVerificationEmail(email, verificationCode);

    res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email.'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ success: false, message: 'Server error during resending.' });
  }
});

/**
 * POST /api/auth/login
 * Log in a user (checks verification state)
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    // Fetch user
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!users || users.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = users[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials.' });
    }

    // Check email verification status
    if (!user.is_verified) {
      return res.status(400).json({
        success: false,
        message: 'Your email address is not verified yet.',
        requiresVerification: true,
        email: user.email
      });
    }

    // Generate JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

/**
 * GET /api/auth/me
 * Validate session and get user info
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const users = await db.query('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving profile.' });
  }
});

module.exports = router;
