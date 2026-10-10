import * as materialService from "../services/material.service.js";
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

export async function getOrderFeasibility(req, res) {
  const feasibility = await orderService.getOrderFeasibility(req.validated.params.id);
  return sendSuccess(res, { feasibility });
}

export async function confirmOrder(req, res) {
  const result = await orderService.confirmOrder(
    req.validated.params.id,
    requestContext(req),
  );
  return sendIdempotent(res, result);
}

export async function updateOrder(req, res) {
  const result = await orderService.updateOrder(
    req.validated.params.id,
    req.validated.body,
    requestContext(req),
  );
  return sendIdempotent(res, result);
}

export async function reserveMaterial(req, res) {
  const result = await materialService.reserveForOrder(req.validated.params.id, req.validated.body, requestContext(req));
  return sendIdempotent(res, result);
}

export async function getReservations(req, res) {
  const data = await materialService.getOrderReservations(req.validated.params.id);
  return sendSuccess(res, data);
}

export async function issueMaterial(req, res) {
  const result = await materialService.issueForOrder(req.validated.params.id, req.validated.body, requestContext(req));
  return sendIdempotent(res, result);
}

export async function returnMaterial(req, res) {
  const result = await materialService.returnForOrder(req.validated.params.id, req.validated.body, requestContext(req));
  return sendIdempotent(res, result);
}
