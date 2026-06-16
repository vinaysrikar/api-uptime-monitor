const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_portfolio_key';

/**
 * Middleware to verify JWT and attach user info to request
 */
function authenticateToken(req, res, next) {
  // Read Authorization header
  const authHeader = req.headers['authorization'];
  // Expecting format: Bearer <token>
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access Denied: No authentication token provided.' 
    });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // Contains { id, email }
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access Denied: Invalid or expired authentication token.' 
    });
  }
}

module.exports = authenticateToken;
