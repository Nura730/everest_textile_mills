import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function login(req, res) {
  const result = await authService.login(req.validated.body);
  // A response carrying a credential must never be stored by a browser or proxy cache.
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, result);
}

export async function me(req, res) {
  const user = await authService.getCurrentUser(req.user.id);
  return sendSuccess(res, { user });
}
