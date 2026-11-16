import jwt from 'jsonwebtoken';
import db from './db.js';

const TOKEN_EXPIRY = '24h';

// Fail fast in production: never run with a predictable signing key.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  if (process.env.JWT_SECRET.length < 24) {
    throw new Error('JWT_SECRET must be at least 24 characters');
  }
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ sub: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = verifyToken(token);
    const user = await db.get('SELECT user_id, username, full_name, role, is_active, must_change_password FROM users WHERE user_id = ?', [payload.sub]);
    if (!user || !user.is_active) return res.status(401).json({ error: 'User not found or inactive' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const ROLE_RANK = { VIEWER: 1, CASHIER: 2, MANAGER: 3, ADMIN: 4 };

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

export function requireRoleOrAbove(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if ((ROLE_RANK[req.user.role] || 0) < (ROLE_RANK[minRole] || 0)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}