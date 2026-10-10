import { z } from 'zod';
import { emailSchema, passwordWithinBcryptLimit } from './common.validators.js';

// No minimum length here beyond "present": login must not reveal the password policy,
// and an old account may predate a policy change.
export const loginBodySchema = z.object({
  email: emailSchema,
  password: passwordWithinBcryptLimit(z.string().min(1)),
});
