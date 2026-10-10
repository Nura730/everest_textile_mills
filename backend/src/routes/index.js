import { Router } from 'express';
import healthRoutes from './health.routes.js';

// Every /api resource router is mounted here, so the whole API surface is visible in one file.
const router = Router();

router.use('/health', healthRoutes);

export default router;
