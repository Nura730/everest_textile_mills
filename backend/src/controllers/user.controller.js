import * as userService from '../services/user.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function create(req, res) {
  const user = await userService.createUser(req.validated.body, req.user);
  return sendSuccess(res, { user }, { status: 201 });
}
