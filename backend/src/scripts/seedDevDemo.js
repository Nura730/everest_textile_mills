import { ROLES } from '../constants/roles.js';
import { Buyer } from '../models/Buyer.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { receiveLot } from '../services/inventory.service.js';
import { cancelOrder, createOrder, rejectOrder } from '../services/order.service.js';
import { hashPassword } from '../services/password.service.js';
import { todayInIndia } from '../utils/dates.js';

/*
 * Demo workflow records for local development and the project review. Everything goes through the
 * REAL services (validation, transactions, ledger, audit, idempotency) — nothing is inserted raw.
 * Every call uses a fixed Idempotency-Key, so re-running the seed creates nothing twice.
 */

export const DEMO_SECOND_BUYER = Object.freeze({
  code: 'BUY-TPR',
  name: 'Tiruppur Knits Pvt Ltd',
  contactName: 'Second Buyer',
  email: 'buyer2@everest.local',
});

const DEMO_LOTS = [
  { lotNumber: 'GRN-DEMO-0001', material: 'COTTON', colour: 'Navy', supplierName: 'Sri Lakshmi Spinners', quantityKg: 1250, costPerKgPaise: 32000 },
  { lotNumber: 'GRN-DEMO-0002', material: 'COTTON', colour: 'Navy', supplierName: 'Sri Lakshmi Spinners', quantityKg: 400, costPerKgPaise: 32500 },
  { lotNumber: 'GRN-DEMO-0003', material: 'POLYESTER', colour: 'White', supplierName: 'Reliance Polyester', quantityKg: 900, costPerKgPaise: 21000 },
  { lotNumber: 'GRN-DEMO-0004', material: 'COTTON', colour: 'Red', supplierName: 'Sri Lakshmi Spinners', quantityKg: 60, costPerKgPaise: 33000 },
];

function daysFromToday(days) {
  const date = new Date(`${todayInIndia()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const actorOf = (user) => ({ id: String(user._id), role: user.role, buyerId: user.buyerId ? String(user.buyerId) : null });
const ctx = (user, key) => ({ actor: actorOf(user), idempotencyKey: key, requestId: 'seed-dev', source: 'ONLINE' });

/** Runs one seeded action; an action that already ran (or already exists) is reported, not repeated. */
async function once(label, action) {
  try {
    const result = await action();
    return { item: label, status: result?.replayed ? 'exists' : 'created' };
  } catch (err) {
    // Same key used on an earlier day with a different date, or the record exists already.
    if (['IDEMPOTENCY_KEY_REUSED', 'DUPLICATE_RESOURCE', 'INVALID_STATE_TRANSITION'].includes(err.code) || err.code === 11000) {
      return { item: label, status: 'exists' };
    }
    throw err;
  }
}

export async function seedDevDemo({ nodeEnv, password }) {
  if (nodeEnv === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production.');
  }

  const report = [];

  // A second buyer company with its own login: demonstrates that buyers never see each other's orders.
  const upserted = await Buyer.updateOne({ code: DEMO_SECOND_BUYER.code }, { $setOnInsert: { ...DEMO_SECOND_BUYER } }, { upsert: true });
  report.push({ item: `buyer ${DEMO_SECOND_BUYER.code}`, status: upserted.upsertedCount ? 'created' : 'exists' });
  const secondBuyer = await Buyer.findOne({ code: DEMO_SECOND_BUYER.code }).lean();
  const secondUser = await User.updateOne(
    { email: 'buyer2@everest.local' },
    {
      $setOnInsert: {
        name: 'Second Buyer',
        email: 'buyer2@everest.local',
        passwordHash: await hashPassword(password),
        role: ROLES.BUYER,
        buyerId: secondBuyer._id,
        createdBy: null,
      },
    },
    { upsert: true },
  );
  report.push({ item: 'user buyer2@everest.local', status: secondUser.upsertedCount ? 'created' : 'exists' });

  const [keeper, admin, buyer1, buyer2] = await Promise.all([
    User.findOne({ email: 'store@everest.local' }).lean(),
    User.findOne({ email: 'admin@everest.local' }).lean(),
    User.findOne({ email: 'buyer@everest.local' }).lean(),
    User.findOne({ email: 'buyer2@everest.local' }).lean(),
  ]);
  if (!keeper || !admin || !buyer1?.buyerId) {
    throw new Error('seedDevDemo needs the dev users and the linked dev buyer (run seedDevUsers and seedDevCatalog first).');
  }

  // Yarn stock, received by the store keeper (ledger + audit written by the service).
  for (const lot of DEMO_LOTS) {
    report.push(await once(`yarn lot ${lot.lotNumber}`, () => receiveLot(lot, ctx(keeper, `seed-receive-${lot.lotNumber}`))));
  }

  const navy = await Product.findOne({ code: 'COT-NAVY-PLAIN' }).lean();
  const white = await Product.findOne({ code: 'POL-WHITE-TWILL' }).lean();

  // Orders placed by the buyers themselves, plus one cancelled and one rejected to show history.
  const orders = [
    { key: 'seed-order-1', user: buyer1, body: { productId: String(navy._id), quantityMetres: 5000, requiredBy: daysFromToday(21), buyerNotes: 'Pack in 100 m rolls' } },
    { key: 'seed-order-2', user: buyer1, body: { productId: String(white._id), quantityMetres: 1200, requiredBy: daysFromToday(45) } },
    { key: 'seed-order-3', user: buyer2, body: { productId: String(navy._id), quantityMetres: 2000, requiredBy: daysFromToday(10) } },
    { key: 'seed-order-4', user: buyer1, body: { productId: String(navy._id), quantityMetres: 300, requiredBy: daysFromToday(30) } },
    { key: 'seed-order-5', user: buyer2, body: { productId: String(white._id), quantityMetres: 8000, requiredBy: daysFromToday(3) } },
  ];
  const created = {};
  for (const { key, user, body } of orders) {
    report.push(
      await once(`order ${key}`, async () => {
        const result = await createOrder(body, ctx(user, key));
        created[key] = result.body.order.id;
        return result;
      }),
    );
  }

  if (created['seed-order-4']) {
    report.push(await once('cancel seed-order-4', () =>
      cancelOrder(created['seed-order-4'], { reason: 'Buyer reduced the season plan' }, ctx(buyer1, 'seed-cancel-4'))));
  }
  if (created['seed-order-5']) {
    report.push(await once('reject seed-order-5', () =>
      rejectOrder(created['seed-order-5'], { reason: '8,000 m in 3 days exceeds loom capacity' }, ctx(admin, 'seed-reject-5'))));
  }

  return report;
}
