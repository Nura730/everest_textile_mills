import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import * as workforce from '../services/workforce.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import {
  attendanceIdParamsSchema,
  correctAttendanceBodySchema,
  createWorkerBodySchema,
  dayRegisterQuerySchema,
  listAttendanceQuerySchema,
  listWorkersQuerySchema,
  recordAttendanceBodySchema,
  updateWorkerBodySchema,
  wageSummaryQuerySchema,
  workerIdParamsSchema,
} from '../validators/workforce.validators.js';

// Workers (/api/workers), the attendance register (/api/attendance) and wages (/api/wages).
//  - workers and wage terms: ADMIN manages; FLOOR_MANAGER and QC read (without rates)
//  - attendance: FLOOR_MANAGER and ADMIN record and correct (floor: recent days only); QC reads
//  - wages (money): ADMIN only. Store keeper and buyers: no access.
const admin = authorize(ROLES.ADMIN);
const recorders = authorize(ROLES.FLOOR_MANAGER, ROLES.ADMIN);
const readers = authorize(ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);

export const workerRoutes = Router();
workerRoutes.get('/', readers, validate({ query: listWorkersQuerySchema }), async (req, res) => {
  const { workers, meta } = await workforce.listWorkers(req.validated.query, req.user);
  sendSuccess(res, { workers }, { meta });
});
workerRoutes.post('/', admin, validate({ body: createWorkerBodySchema }), async (req, res) => sendSuccess(res, await workforce.createWorker(req.validated.body, requestContext(req)), { status: 201 }));
workerRoutes.get('/:id', readers, validate({ params: workerIdParamsSchema }), async (req, res) => sendSuccess(res, await workforce.getWorker(req.validated.params.id, req.user)));
workerRoutes.patch('/:id', admin, validate({ params: workerIdParamsSchema, body: updateWorkerBodySchema }), async (req, res) =>
  sendSuccess(res, await workforce.updateWorker(req.validated.params.id, req.validated.body, requestContext(req))),
);

export const attendanceRoutes = Router();
attendanceRoutes.get('/', readers, validate({ query: listAttendanceQuerySchema }), async (req, res) => {
  const { attendance, meta } = await workforce.listAttendance(req.validated.query, req.user);
  sendSuccess(res, { attendance }, { meta });
});
attendanceRoutes.get('/register', readers, validate({ query: dayRegisterQuerySchema }), async (req, res) => sendSuccess(res, await workforce.dayRegister(req.validated.query, req.user)));
attendanceRoutes.post('/', recorders, requireIdempotencyKey, validate({ body: recordAttendanceBodySchema }), async (req, res) =>
  sendIdempotent(res, await workforce.recordAttendance(req.validated.body, requestContext(req))),
);
attendanceRoutes.patch('/:id', recorders, validate({ params: attendanceIdParamsSchema, body: correctAttendanceBodySchema }), async (req, res) =>
  sendSuccess(res, await workforce.correctAttendance(req.validated.params.id, req.validated.body, requestContext(req))),
);

export const wageRoutes = Router();
wageRoutes.get('/summary', admin, validate({ query: wageSummaryQuerySchema }), async (req, res) => sendSuccess(res, await workforce.wageSummary(req.validated.query)));
