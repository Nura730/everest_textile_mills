import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authRoutes from './auth.routes.js';
import buyerRoutes from './buyer.routes.js';
import healthRoutes from './health.routes.js';
import inventoryRoutes from './inventory.routes.js';
import orderRoutes from './order.routes.js';
import productRoutes from './product.routes.js';
import userRoutes from './user.routes.js';
import yarnLotRoutes from './yarnLot.routes.js';

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

export default router;
