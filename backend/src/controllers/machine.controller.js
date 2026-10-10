import * as machineService from '../services/machine.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';

export async function createMachine(req, res) {
  const machine = await machineService.createMachine(req.validated.body, requestContext(req));
  return sendSuccess(res, { machine }, { status: 201 });
}

export async function listMachines(req, res) {
  const { machines, meta } = await machineService.listMachines(req.validated.query);
  return sendSuccess(res, { machines }, { meta });
}

export async function getMachine(req, res) {
  return sendSuccess(res, await machineService.getMachine(req.validated.params.id));
}

export async function getMachineEvents(req, res) {
  const { events, meta } = await machineService.getMachineEvents(req.validated.params.id, req.validated.query);
  return sendSuccess(res, { events }, { meta });
}

export async function updateMachine(req, res) {
  const machine = await machineService.updateMachine(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { machine });
}

export async function setMachineActive(req, res) {
  const machine = await machineService.setMachineActive(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { machine });
}

export async function startMaintenance(req, res) {
  return sendIdempotent(res, await machineService.startMaintenance(req.validated.params.id, req.validated.body, requestContext(req)));
}

export async function endMaintenance(req, res) {
  return sendIdempotent(res, await machineService.endMaintenance(req.validated.params.id, req.validated.body, requestContext(req)));
}

export async function reportProblem(req, res) {
  return sendIdempotent(res, await machineService.reportProblem(req.validated.params.id, req.validated.body, requestContext(req)));
}

export async function resolveProblem(req, res) {
  const { id, eventId } = req.validated.params;
  return sendIdempotent(res, await machineService.resolveProblem(id, eventId, req.validated.body, requestContext(req)));
}
