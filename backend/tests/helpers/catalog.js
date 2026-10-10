import { ORDER_STATUS } from '../../src/constants/orderStatus.js';
import { Buyer } from '../../src/models/Buyer.js';
import { Counter } from '../../src/models/Counter.js';
import { Order } from '../../src/models/Order.js';
import { Product } from '../../src/models/Product.js';
import { addYears, dateStringToDate, todayInIndia } from '../../src/utils/dates.js';

let seq = 0;
const next = () => {
  seq += 1;
  return seq;
};

/** A date string `days` after today in India. */
export function daysFromToday(days) {
  const date = dateStringToDate(todayInIndia());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const maxDeadline = () => addYears(todayInIndia(), 2);

export function createTestBuyer(overrides = {}) {
  const n = next();
  return Buyer.create({ code: `BUY-T${n}`, name: `Test Buyer ${n}`, ...overrides });
}

export function createTestProduct(overrides = {}) {
  const n = next();
  return Product.create({
    code: `COT-NAVY-${n}`,
    name: 'Navy Cotton Plain',
    material: 'COTTON',
    colour: 'Navy',
    weave: 'PLAIN',
    widthCm: 150,
    gsm: 110,
    yarnGramsPerMetre: 170,
    defaultPricePerMetrePaise: 18000,
    ...overrides,
  });
}

/** An order inserted directly (bypassing the service), for read/permission tests. */
export function createTestOrder({ buyer, product, createdBy, status = ORDER_STATUS.ORDER_CREATED, ...overrides }) {
  const n = next();
  return Order.create({
    orderNumber: `ORD-TEST-${String(n).padStart(4, '0')}`,
    buyerId: buyer._id,
    buyer: { code: buyer.code, name: buyer.name },
    productId: product._id,
    product: {
      code: product.code,
      name: product.name,
      material: product.material,
      colour: product.colour,
      yarnGramsPerMetre: product.yarnGramsPerMetre,
      pricePerMetrePaise: product.defaultPricePerMetrePaise,
    },
    quantityCm: 500_000,
    requiredYarnGrams: 850_000,
    orderValuePaise: 90_000_000,
    requiredBy: dateStringToDate(daysFromToday(10)),
    status,
    statusHistory: [{ from: null, to: status, at: new Date(), by: createdBy, byRole: 'ADMIN' }],
    createdBy,
    createdByRole: 'ADMIN',
    ...overrides,
  });
}

export async function ensureCatalogCollections() {
  await Promise.all([Buyer.init(), Product.init(), Order.init(), Counter.createCollection()]);
}

export async function clearCatalog() {
  await Promise.all([Buyer.deleteMany({}), Product.deleteMany({}), Order.deleteMany({}), Counter.deleteMany({})]);
}
