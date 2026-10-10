import * as catalogService from '../services/catalog.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';

export async function createBuyer(req, res) {
  const buyer = await catalogService.createBuyer(req.validated.body, requestContext(req));
  return sendSuccess(res, { buyer }, { status: 201 });
}

export async function listBuyers(req, res) {
  const { buyers, meta } = await catalogService.listBuyers(req.validated.query);
  return sendSuccess(res, { buyers }, { meta });
}

export async function getBuyer(req, res) {
  const buyer = await catalogService.getBuyer(req.validated.params.id);
  return sendSuccess(res, { buyer });
}

export async function createProduct(req, res) {
  const product = await catalogService.createProduct(req.validated.body, requestContext(req));
  return sendSuccess(res, { product }, { status: 201 });
}

export async function listProducts(req, res) {
  const { products, meta } = await catalogService.listProducts(req.validated.query, req.user);
  return sendSuccess(res, { products }, { meta });
}

export async function getProduct(req, res) {
  const product = await catalogService.getProduct(req.validated.params.id, req.user);
  return sendSuccess(res, { product });
}

export async function updateBuyer(req, res) {
  const buyer = await catalogService.updateBuyer(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { buyer });
}

export async function setBuyerStatus(req, res) {
  const buyer = await catalogService.setBuyerStatus(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { buyer });
}

export async function updateProduct(req, res) {
  const product = await catalogService.updateProduct(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { product });
}

export async function setProductStatus(req, res) {
  const product = await catalogService.setProductStatus(req.validated.params.id, req.validated.body, requestContext(req));
  return sendSuccess(res, { product });
}
