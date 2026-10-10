import { isRole } from '../constants/roles.js';
import { AppError } from '../utils/AppError.js';

/**
 * authorize(ROLES.ADMIN, ...) — allows only the listed roles. Must run after authenticate.
 * Arguments are checked when the route is DEFINED, so a typo crashes at startup
 * instead of silently locking everyone out (or in) at request time.
 */
export function authorize(...roles) {
  if (roles.length === 0) {
    throw new TypeError('authorize() requires at least one role');
  }
  const unknown = roles.filter((role) => !isRole(role));
  if (unknown.length > 0) {
    throw new TypeError(`authorize() received unknown role(s): ${unknown.join(', ')}`);
  }
  const allowed = new Set(roles);

  return function authorizeRole(req, res, next) {
    // Fail closed if someone mounts authorize without authenticate.
    if (!req.user) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or missing authentication token');
    }
    if (!allowed.has(req.user.role)) {
      // Generic: do not tell the caller which roles would have been allowed.
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
    }
    return next();
  };
}
