import { User, toPublicUser } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { verifyAgainstDummyHash, verifyPassword } from './password.service.js';
import { signAccessToken } from './token.service.js';

function invalidCredentials() {
  return new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
}

/**
 * Business rule: the response must not reveal whether an email exists, whether the
 * password was wrong, or whether the account is deactivated. All three paths do exactly
 * one bcrypt comparison and return the same error.
 */
export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    await verifyAgainstDummyHash(password);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  // isActive is checked AFTER the comparison so a deactivated account costs the same time.
  if (!passwordMatches || !user.isActive) {
    throw invalidCredentials();
  }

  const lastLoginAt = new Date();
  // Targeted update: no full-document save, no chance of touching passwordHash.
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt } });

  const { token, expiresAt } = signAccessToken(user);
  return {
    token,
    tokenType: 'Bearer',
    expiresAt,
    user: toPublicUser({ ...user.toObject(), lastLoginAt }),
  };
}

export async function getCurrentUser(userId) {
  const user = await User.findById(userId).lean();
  // authenticate already checked this; guard against a deletion between the two reads.
  if (!user || !user.isActive) {
    throw new AppError('UNAUTHENTICATED', 'Invalid or missing authentication token');
  }
  return toPublicUser(user);
}
