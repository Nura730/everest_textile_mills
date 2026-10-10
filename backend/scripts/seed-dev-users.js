// npm run seed:dev — one user per role, a buyer company and sample products, for local
// development. Refuses in production.
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { getConfig } from '../src/config/env.js';
import { seedDevCatalog } from '../src/scripts/seedDevCatalog.js';
import { seedDevDemo } from '../src/scripts/seedDevDemo.js';
import { seedDevMachines } from '../src/scripts/seedDevMachines.js';
import { seedDevUsers, seedEnvSchema } from '../src/scripts/seedDevUsers.js';

async function main() {
  const config = getConfig(); // also loads backend/.env
  if (config.isProduction) {
    console.error('seed:dev refuses to run with NODE_ENV=production. Use npm run bootstrap:admin instead.');
    return 1;
  }

  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Field names and rules only, never values.
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }

  await connectDatabase(config.mongodbUri);
  try {
    const report = await seedDevUsers({ nodeEnv: config.nodeEnv, password: parsed.data.SEED_PASSWORD });
    console.log('Dev users (password = SEED_PASSWORD from your .env):');
    console.table(report);
    const catalog = await seedDevCatalog({ nodeEnv: config.nodeEnv });
    console.log('Dev buyer company and products:');
    console.table(catalog);
    const demo = await seedDevDemo({ nodeEnv: config.nodeEnv, password: parsed.data.SEED_PASSWORD });
    console.log('Demo workflow records (created through the real services):');
    console.table(demo);
    const machines = await seedDevMachines({ nodeEnv: config.nodeEnv });
    console.log('Dev machines:');
    console.table(machines);
    return 0;
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
