import { AppError } from '../utils/AppError.js';

export function notFound(req, res, next) {
  next(new AppError('NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
}
