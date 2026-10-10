import * as orderService from "../services/order.service.js";
import { sendIdempotent, sendSuccess } from "../utils/apiResponse.js";
import { requestContext } from "../utils/requestContext.js";

export async function createOrder(req, res) {
  const result = await orderService.createOrder(
    req.validated.body,
    requestContext(req),
  );
  return sendIdempotent(res, result);
}

export async function listOrders(req, res) {
  const { orders, meta } = await orderService.listOrders(
    req.validated.query,
    req.user,
  );
  return sendSuccess(res, { orders }, { meta });
}

export async function getOrder(req, res) {
  const order = await orderService.getOrder(req.validated.params.id, req.user);
  return sendSuccess(res, { order });
}

export async function cancelOrder(req, res) {
  const result = await orderService.cancelOrder(
    req.validated.params.id,
    req.validated.body,
    requestContext(req),
  );
  return sendIdempotent(res, result);
}

export async function rejectOrder(req, res) {
  const result = await orderService.rejectOrder(
    req.validated.params.id,
    req.validated.body,
    requestContext(req),
  );
  return sendIdempotent(res, result);
}
