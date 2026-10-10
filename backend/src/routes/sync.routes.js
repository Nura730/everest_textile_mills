import { Router } from 'express';
import { z } from 'zod';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { SYNC_OUTCOME } from '../models/SyncEvent.js';
import { listSyncEvents, SYNC_EVENT_TYPES, syncEvents } from '../services/sync.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

// Mounted at /api/sync. Offline replay is for the floor and QC roles (and the owner); each event is
// also checked against its own action's roles in the service.
const router = Router();
const deviceId = z.string().trim().regex(/^[A-Za-z0-9_-]{8,100}$/, { error: 'must be a device id' });

const syncBody = z.strictObject({
  deviceId,
  events: z
    .array(
      z.strictObject({
        eventId: z.uuid(),
        type: z.enum(SYNC_EVENT_TYPES),
        payload: z.record(z.string(), z.unknown()),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(25)
    .refine((events) => new Set(events.map((e) => e.eventId)).size === events.length, { error: 'eventIds must be unique within a batch' }),
});

router.post('/events', authorize(ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN), validate({ body: syncBody }), async (req, res) => {
  sendSuccess(res, await syncEvents(req.validated.body, { actor: req.user, requestId: req.id ?? null }));
});

router.get(
  '/events',
  authorize(...ALL_ROLES),
  validate({
    query: z.object({
      outcome: z.enum(Object.values(SYNC_OUTCOME)).optional(),
      deviceId: deviceId.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  async (req, res) => {
    const { events, meta } = await listSyncEvents(req.validated.query, req.user);
    sendSuccess(res, { events }, { meta });
  },
);

export default router;
