import * as productionService from '../services/production.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';

export async function listRuns(req, res) {
  const { runs, meta } = await productionService.listRuns(req.validated.query);
  return sendSuccess(res, { runs }, { meta });
}

export async function getRun(req, res) {
  return sendSuccess(res, await productionService.getRun(req.validated.params.id));
}

export async function planRun(req, res) {
  return sendIdempotent(res, await productionService.planRun(req.validated.body, requestContext(req)));
}

const id = (req) => req.validated.params.id;

export async function startRun(req, res) {
  return sendIdempotent(res, await productionService.startRun(id(req), requestContext(req)));
}

export async function pauseRun(req, res) {
  return sendIdempotent(res, await productionService.pauseRun(id(req), req.validated.body, requestContext(req)));
}

export async function resumeRun(req, res) {
  return sendIdempotent(res, await productionService.resumeRun(id(req), requestContext(req)));
}

export async function completeRun(req, res) {
  return sendIdempotent(res, await productionService.completeRun(id(req), req.validated.body, requestContext(req)));
}

export async function cancelRun(req, res) {
  return sendIdempotent(res, await productionService.cancelRun(id(req), req.validated.body, requestContext(req)));
}

export async function recordRoll(req, res) {
  return sendIdempotent(res, await productionService.recordRoll(id(req), req.validated.body, requestContext(req)));
}
