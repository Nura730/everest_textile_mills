import * as inventoryService from '../services/inventory.service.js';
import { sendIdempotent } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';

export async function receiveLot(req, res) {
  const result = await inventoryService.receiveLot(req.validated.body, requestContext(req));
  return sendIdempotent(res, result);
}
