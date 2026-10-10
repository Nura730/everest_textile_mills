import * as userService from '../services/user.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function create(req, res) {
  const user = await userService.createUser(req.validated.body, req.user);
  return sendSuccess(res, { user }, { status: 201 });
}

export async function list(req, res) {
  const { users, meta } = await userService.listUsers(req.validated.query);
  return sendSuccess(res, { users }, { meta });
}

export async function updateStatus(req, res) {
  const user = await userService.setUserStatus(req.validated.params.id, req.validated.body.isActive, req.user);
  return sendSuccess(res, { user });
}
