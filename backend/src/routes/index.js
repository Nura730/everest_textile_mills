import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import healthRoutes from './health.routes.js';

// Every /api resource router is mounted here, so the whole API surface is visible in one file.
const router = Router();

// ── Public routes ───────────────────────────────────────────────────────────
router.use('/health', healthRoutes);

// ── Everything below requires a valid token (secure by default) ─────────────
// A router added later is protected automatically; each route still declares
// which roles may call it with authorize(...). Unknown /api paths answer 401
// to anonymous callers, so the route list cannot be probed without a token.
router.use(authenticate);

export default router;
