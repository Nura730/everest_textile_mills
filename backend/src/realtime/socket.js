import { Server } from 'socket.io';
import { ROLES } from '../constants/roles.js';
import { AuditLog } from '../models/AuditLog.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { allowedFor, BUYER_ACTIONS, toPublicEntry } from '../services/audit.service.js';
import { verifyAccessToken } from '../services/token.service.js';

/*
 * Phase 16: live updates over Socket.IO (instruction.md §15).
 *
 * What is pushed is exactly what was COMMITTED: a MongoDB change stream on the audit log. Every
 * business change writes its audit entry in the same transaction, so a client is never told about a
 * change that later rolled back, and no service has to remember to publish anything.
 *
 * Each socket authenticates with the same JWT as the API and joins rooms for its role (and, for a
 * buyer, its company). An entry is sent to a room only if that role may see it in the audit center,
 * in the same shape (money fields removed for staff; plain milestones for buyers). Sockets are
 * re-checked every minute: an expired token, deactivated account or revoked session is disconnected.
 *
 * Event 'activity': the public audit entry. Clients use entityType/orderId/machineId to refresh.
 */

const STAFF_ROLES = [ROLES.ADMIN, ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR];
const RECHECK_MS = 60_000;

async function loadUser(token) {
  const { userId, tokenVersion } = verifyAccessToken(token);
  const user = await User.findById(userId).select('name role isActive tokenVersion buyerId').lean();
  if (!user || !user.isActive || user.tokenVersion !== tokenVersion) return null;
  return { id: String(user._id), role: user.role, name: user.name, buyerId: user.buyerId ? String(user.buyerId) : null };
}

/** Sends one committed audit entry to every room allowed to see it. */
export async function fanOut(io, entry) {
  const actor = await User.findById(entry.actorId, { name: 1 }).lean();
  const names = new Map(actor ? [[String(actor._id), actor.name]] : []);
  for (const role of STAFF_ROLES) {
    if (allowedFor(role, entry.action)) io.to(`role:${role}`).emit('activity', toPublicEntry(entry, { role }, names));
  }
  if (entry.orderId && BUYER_ACTIONS.has(entry.action)) {
    const order = await Order.findById(entry.orderId, { buyerId: 1 }).lean();
    if (order?.buyerId) io.to(`buyer:${order.buyerId}`).emit('activity', toPublicEntry(entry, { role: ROLES.BUYER }, names));
  }
}

export function attachRealtime(httpServer, { corsOrigins, logger }) {
  const io = new Server(httpServer, {
    cors: { origin: [...corsOrigins] },
    // Clients only listen; nothing large is ever sent to the server.
    maxHttpBufferSize: 10_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = typeof token === 'string' ? await loadUser(token) : null;
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = user;
      socket.data.token = token;
      return next();
    } catch {
      return next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(`role:${user.role}`);
    socket.join(`user:${user.id}`);
    if (user.role === ROLES.BUYER && user.buyerId) socket.join(`buyer:${user.buyerId}`);
    socket.emit('ready', { role: user.role });
  });

  const stream = AuditLog.watch([{ $match: { operationType: 'insert' } }]);
  stream.on('change', (change) => {
    fanOut(io, change.fullDocument).catch((err) => logger?.warn({ err }, 'Realtime fan-out failed'));
  });
  stream.on('error', (err) => logger?.error({ err }, 'Audit change stream failed; live updates stopped'));

  const recheck = setInterval(async () => {
    for (const socket of await io.fetchSockets()) {
      try {
        if (!(await loadUser(socket.data.token))) socket.disconnect(true);
      } catch {
        socket.disconnect(true);
      }
    }
  }, RECHECK_MS);
  recheck.unref();

  return {
    io,
    async close() {
      clearInterval(recheck);
      await stream.close().catch(() => {});
      // Disconnect clients but leave the HTTP server to its owner (io.close() would close it too).
      io.disconnectSockets(true);
      io.engine.close();
    },
  };
}
