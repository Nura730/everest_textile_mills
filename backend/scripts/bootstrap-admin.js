// npm run bootstrap:admin — creates the first ADMIN from BOOTSTRAP_ADMIN_* variables.
// Safe in production; refuses if an active admin already exists.
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { getConfig } from '../src/config/env.js';
import { BootstrapRefusedError, bootstrapAdmin, bootstrapEnvSchema } from '../src/scripts/bootstrapAdmin.js';

async function main() {
  const config = getConfig(); // also loads backend/.env

  const parsed = bootstrapEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Field names and rules only, never values.
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }

  await connectDatabase(config.mongodbUri);
  try {
    const admin = await bootstrapAdmin({
      name: parsed.data.BOOTSTRAP_ADMIN_NAME,
      email: parsed.data.BOOTSTRAP_ADMIN_EMAIL,
      password: parsed.data.BOOTSTRAP_ADMIN_PASSWORD,
    });
    console.log(`Created admin ${admin.email}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.`);
    return 0;
  } catch (err) {
    if (err instanceof BootstrapRefusedError) {
      console.error(`Refused: ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    await disconnectDatabase();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
