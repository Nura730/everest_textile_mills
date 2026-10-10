import { User } from '../models/User.js';
import { verifyAccessToken } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';

// "Bearer <token>": scheme is case-insensitive (RFC 7235), exactly one token, nothing else.
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

function unauthenticated() {
  return new AppError('UNAUTHENTICATED', 'Invalid or missing authentication token');
}

/**
 * Establishes who is calling. On success sets req.user = { id, role, name, email } (frozen).
 *
 * The user is re-read from the database on every request, so the database, not the
 * token, decides: a deactivated user, a revoked token (tokenVersion bumped) or a
 * changed role takes effect on the very next request. Cost: one indexed _id lookup.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? BEARER_PATTERN.exec(header.trim()) : null;
  if (!match) throw unauthenticated();

  const { userId, tokenVersion } = verifyAccessToken(match[1]);

  const user = await User.findById(userId).select('name email role isActive tokenVersion buyerId').lean();
  // Same response for all three cases so a token holder learns nothing about the account.
  if (!user || !user.isActive || user.tokenVersion !== tokenVersion) throw unauthenticated();

  // Frozen so no later middleware can accidentally (or deliberately) change the role or company.
  // buyerId (from the DB, like the role) is what ownership checks compare against.
  req.user = Object.freeze({
    id: String(user._id),
    role: user.role,
    name: user.name,
    email: user.email,
    buyerId: user.buyerId ? String(user.buyerId) : null,
  });
  // Every later log line for this request (including the error handler's) carries userId.
  req.log = req.log?.child({ userId: req.user.id }) ?? req.log;
  return next();
}
