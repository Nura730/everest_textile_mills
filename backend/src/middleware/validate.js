import { AppError } from '../utils/AppError.js';

const LOCATIONS = ['params', 'query', 'body'];

/**
 * validate({ body, query, params }) — each a zod schema, all optional.
 * Parsed (coerced, stripped) values go on req.validated. Express 5 makes req.query
 * read-only, and keeping raw and parsed input apart makes it obvious which one a
 * controller is using: controllers must read req.validated only.
 */
export function validate(schemas) {
  return function validateRequest(req, res, next) {
    const validated = {};
    const details = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        validated[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ location, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) {
      return next(new AppError('VALIDATION_ERROR', 'Request validation failed', { details }));
    }

    req.validated = validated;
    return next();
  };
}
