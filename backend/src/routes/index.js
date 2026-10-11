import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authRoutes from './auth.routes.js';
import buyerRoutes from './buyer.routes.js';
import healthRoutes from './health.routes.js';
import inventoryRoutes from './inventory.routes.js';
import machineRoutes from './machine.routes.js';
import productionRoutes from './production.routes.js';
import auditRoutes from './audit.routes.js';
import costingRoutes from './costing.routes.js';
import syncRoutes from './sync.routes.js';
import intelligenceRoutes from './intelligence.routes.js';
import signatureRoutes from './signature.routes.js';
import { qcRoutes, rollRoutes } from './quality.routes.js';
import { dispatchRoutes, finishedGoodRoutes, invoiceRoutes, paymentRoutes, summaryRoutes } from './fulfilment.routes.js';
import orderRoutes from './order.routes.js';
import productRoutes from './product.routes.js';
import userRoutes from './user.routes.js';
import yarnLotRoutes from './yarnLot.routes.js';
import { attendanceRoutes, wageRoutes, workerRoutes } from './workforce.routes.js';

// Every /api resource router is mounted here, so the whole API surface is visible in one file.
const router = Router();

// ── Public routes ───────────────────────────────────────────────────────────
router.use('/health', healthRoutes);
// /auth/login is public; /auth/me applies authenticate itself.
router.use('/auth', authRoutes);

// ── Everything below requires a valid token (secure by default) ─────────────
// A router added later is protected automatically; each route still declares
// which roles may call it with authorize(...). Unknown /api paths answer 401
// to anonymous callers, so the route list cannot be probed without a token.
router.use(authenticate);

router.use('/users', userRoutes);
router.use('/yarn-lots', yarnLotRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/buyers', buyerRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/machines', machineRoutes);
router.use('/production-runs', productionRoutes);
router.use('/rolls', rollRoutes);
router.use('/qc', qcRoutes);
router.use('/finished-goods', finishedGoodRoutes);
router.use('/dispatches', dispatchRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/summary', summaryRoutes);
router.use('/audit', auditRoutes);
router.use('/costing', costingRoutes);
router.use('/sync', syncRoutes);
router.use('/intelligence', intelligenceRoutes);
router.use('/signatures', signatureRoutes);
router.use('/workers', workerRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/wages', wageRoutes);

export default router;
