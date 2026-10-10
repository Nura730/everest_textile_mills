import * as inventoryService from '../services/inventory.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';

export async function receiveLot(req, res) {
  const result = await inventoryService.receiveLot(req.validated.body, requestContext(req));
  return sendIdempotent(res, result);
}

export async function listLots(req, res) {
  const { lots, meta } = await inventoryService.listLots(req.validated.query, req.user);
  return sendSuccess(res, { lots }, { meta });
}

export async function getLot(req, res) {
  const lot = await inventoryService.getLot(req.validated.params.id, req.user);
  return sendSuccess(res, { lot });
}

export async function getLotTransactions(req, res) {
  const { transactions, meta } = await inventoryService.getLotTransactions(req.validated.params.id, req.validated.query);
  return sendSuccess(res, { transactions }, { meta });
}

export async function getYarnSummary(req, res) {
  const summary = await inventoryService.getYarnSummary(req.validated.query);
  return sendSuccess(res, { summary });
}
