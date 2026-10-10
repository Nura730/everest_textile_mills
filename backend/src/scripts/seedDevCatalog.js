import { ROLES } from '../constants/roles.js';
import { Buyer } from '../models/Buyer.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';

export const DEV_BUYER = Object.freeze({
  code: 'BUY-DEV',
  name: 'Dev Buyer Textiles Pvt Ltd',
  contactName: 'Buyer Contact',
  email: 'buyer@everest.local',
});

// 110 g/m² × 1.5 m = 165 g/m of fabric → 170 g/m of yarn with process waste (the CLAUDE.md example:
// 5,000 m → 850 kg). 140 g/m² × 1.6 m = 224 g/m → 235 g/m.
export const DEV_PRODUCTS = Object.freeze([
  {
    code: 'COT-NAVY-PLAIN',
    name: 'Navy Cotton Plain',
    material: 'COTTON',
    colour: 'Navy',
    weave: 'PLAIN',
    widthCm: 150,
    gsm: 110,
    yarnGramsPerMetre: 170,
    defaultPricePerMetrePaise: 18000,
  },
  {
    code: 'POL-WHITE-TWILL',
    name: 'White Polyester Twill',
    material: 'POLYESTER',
    colour: 'White',
    weave: 'TWILL',
    widthCm: 160,
    gsm: 140,
    yarnGramsPerMetre: 235,
    defaultPricePerMetrePaise: 15000,
  },
]);

async function upsertByCode(Model, data) {
  // A copy: Mongoose adds fields (e.g. __v) to the update object, and the seed constants are frozen.
  const result = await Model.updateOne({ code: data.code }, { $setOnInsert: { ...data } }, { upsert: true });
  return result.upsertedCount === 1 ? 'created' : 'exists';
}

/**
 * Dev-only catalog: one buyer company, two products, and the dev BUYER account linked to the
 * company. Idempotent: existing records are never changed; the buyer account is linked only if it
 * is not linked to any company yet.
 */
export async function seedDevCatalog({ nodeEnv }) {
  if (nodeEnv === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production.');
  }

  const report = [{ type: 'buyer', code: DEV_BUYER.code, status: await upsertByCode(Buyer, DEV_BUYER) }];
  for (const product of DEV_PRODUCTS) {
    report.push({ type: 'product', code: product.code, status: await upsertByCode(Product, product) });
  }

  const buyer = await Buyer.findOne({ code: DEV_BUYER.code }).lean();
  const link = await User.updateOne(
    { email: 'buyer@everest.local', role: ROLES.BUYER, buyerId: null },
    { $set: { buyerId: buyer._id } },
  );
  report.push({ type: 'link', code: `buyer@everest.local → ${DEV_BUYER.code}`, status: link.modifiedCount === 1 ? 'created' : 'exists' });
  return report;
}
