import mongoose from 'mongoose';
import { ROLES } from '../constants/roles.js';
import { User, toPublicUser } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from './password.service.js';

/**
 * Business rule: only an ADMIN creates accounts (no public registration), including
 * other ADMINs. The creator is recorded in createdBy for accountability.
 * A duplicate email is rejected by the unique index (409 DUPLICATE_RESOURCE), which is
 * race-safe: two simultaneous requests cannot both pass a "does it exist?" pre-check.
 */
export async function createUser({ name, email, password, role }, actor) {
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    createdBy: actor.id,
  });
  return toPublicUser(user);
}

export async function listUsers({ role, isActive, page, limit }) {
  const filter = {};
  if (role !== undefined) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { users: users.map(toPublicUser), meta: { page, limit, total } };
}

const ADMIN_STATUS_LOCK_ID = 'user-admin-status';

/**
 * Two admins deactivating each other at the same moment would each see "one other
 * admin remains" and both commit, leaving none (write skew: snapshot isolation does not
 * stop two transactions that write DIFFERENT documents). Writing one shared lock
 * document turns that into a write conflict, so MongoDB aborts one transaction and
 * withTransaction retries it; the retry sees the other commit and refuses.
 */
async function claimAdminStatusLock(session) {
  await mongoose.connection
    .collection('locks')
    .updateOne({ _id: ADMIN_STATUS_LOCK_ID }, { $inc: { version: 1 } }, { upsert: true, session });
}

/**
 * Activate or deactivate an account (ADMIN only).
 * Rules:
 *  - an admin cannot deactivate their own account;
 *  - the last active ADMIN cannot be deactivated (nobody could manage users afterwards);
 *  - deactivation bumps tokenVersion, so every token already issued stops working at once;
 *  - setting the status it already has is a no-op (idempotent, no extra token revocation).
 */
export async function setUserStatus(userId, isActive, actor) {
  if (!isActive && userId === actor.id) {
    throw new AppError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
  }

  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const target = await User.findById(userId).session(session);
      if (!target) {
        throw new AppError('NOT_FOUND', 'User not found');
      }
      if (target.isActive === isActive) {
        updated = target;
        return;
      }

      if (!isActive && target.role === ROLES.ADMIN) {
        await claimAdminStatusLock(session);
        const otherActiveAdmins = await User.countDocuments({
          role: ROLES.ADMIN,
          isActive: true,
          _id: { $ne: target._id },
        }).session(session);
        if (otherActiveAdmins === 0) {
          throw new AppError('LAST_ACTIVE_ADMIN', 'The last active admin cannot be deactivated');
        }
      }

      const update = isActive
        ? { $set: { isActive: true } }
        : { $set: { isActive: false }, $inc: { tokenVersion: 1 } };
      updated = await User.findOneAndUpdate({ _id: target._id }, update, { returnDocument: 'after', session });
    });
    return toPublicUser(updated);
  } finally {
    await session.endSession();
  }
}
