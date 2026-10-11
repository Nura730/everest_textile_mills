import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Invoice } from '../../src/models/Fulfilment.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Payment } from '../../src/models/Payment.js';
import { User } from '../../src/models/User.js';
import { paymentState } from '../../src/services/payment.service.js';
import { addDaysToDateString, todayInIndia } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let store;
let buyer;
let otherBuyer;
let invoice; // ₹10,500 (₹10,000 + 5% GST)
let seq = 0;
const today = todayInIndia();
const buyerId = new mongoose.Types.ObjectId();

const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const post = (actor, path, body, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const pay = (amountPaise, actor = admin, key) => post(actor, `/api/invoices/${invoice._id}/payments`, { amountPaise, receivedOn: today, method: 'BANK_TRANSFER', reference: 'UTR123' }, key);

async function newInvoice({ issuedAt = new Date(), totalPaise = 1_050_000, forBuyer = buyerId } = {}) {
  seq += 1;
  return Invoice.create({
    invoiceNumber: `INV-T-${seq}`, orderId: new mongoose.Types.ObjectId(), orderNumber: `ORD-T-${seq}`, dispatchId: new mongoose.Types.ObjectId(), dispatchNumber: `DSP-T-${seq}`,
    buyerId: forBuyer, buyer: { code: 'BUY-T', name: 'Test Buyer' }, lines: [{ description: 'Fabric', lengthCm: 10_000, pricePerMetrePaise: 10_000, amountPaise: totalPaise - Math.round(totalPaise / 21) }],
    subtotalPaise: totalPaise - Math.round(totalPaise / 21), taxRateBasisPoints: 500, taxPaise: Math.round(totalPaise / 21), totalPaise, issuedBy: new mongoose.Types.ObjectId(), issuedAt,
  });
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), Invoice.init(), Payment.init(), IdempotencyRecord.init(), AuditLog.createCollection()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  buyer = await createTestUser({ role: ROLES.BUYER, buyerId });
  otherBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: new mongoose.Types.ObjectId() });
  invoice = await newInvoice();
});

afterEach(async () => {
  await Promise.all([Invoice.deleteMany({}), Payment.collection.deleteMany({}), AuditLog.collection.deleteMany({}), IdempotencyRecord.deleteMany({}), User.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('payment state', () => {
  it('derives due date, status and overdue days from what was paid', () => {
    const inv = { issuedAt: new Date('2026-09-01T06:00:00Z'), totalPaise: 1000 };
    expect(paymentState(inv, 0, { today: '2026-09-15', termsDays: 30 })).toMatchObject({ dueDate: '2026-10-01', status: 'UNPAID', overdue: false, outstandingPaise: 1000 });
    expect(paymentState(inv, 400, { today: '2026-10-05', termsDays: 30 })).toMatchObject({ status: 'PARTIALLY_PAID', overdue: true, daysOverdue: 4, outstandingPaise: 600 });
    expect(paymentState(inv, 1000, { today: '2026-12-01', termsDays: 30 })).toMatchObject({ status: 'PAID', overdue: false, outstandingPaise: 0 });
  });
});

describe('buyer payments', () => {
  it('a new invoice is UNPAID: issuing never records a payment', async () => {
    const res = await get(admin, `/api/invoices/${invoice._id}`);
    expect(res.body.data.invoice.payment).toMatchObject({ status: 'UNPAID', paidPaise: 0, outstandingPaise: 1_050_000 });
    expect(res.body.data.invoice.payment.dueDate).toBe(addDaysToDateString(today, 30));
  });

  it('partial then full payment; never more than is owed; retries replay', async () => {
    const key = newKey();
    const first = await pay(400_000, admin, key);
    expect(first.status).toBe(201);
    expect(first.body.data.invoice.payment).toMatchObject({ status: 'PARTIALLY_PAID', outstandingPaise: 650_000 });
    expect((await pay(400_000, admin, key)).headers['idempotent-replayed']).toBe('true');
    const over = await pay(650_001);
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'OVERPAYMENT', details: { outstandingPaise: 650_000 } });
    expect((await pay(650_000)).body.data.invoice.payment.status).toBe('PAID');
    expect((await pay(1)).body.error.code).toBe('OVERPAYMENT');
    expect(await Payment.countDocuments()).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'PAYMENT_RECORDED' })).toBe(2);
  });

  it('a mistaken payment is reversed once, with a reason; the record stays', async () => {
    const payment = (await pay(1_050_000)).body.data.payment;
    expect((await post(admin, `/api/payments/${payment.id}/reverse`, { reason: 'x' })).status).toBe(400);
    expect((await post(admin, `/api/payments/${payment.id}/reverse`, { reason: 'Cheque bounced' })).status).toBe(201);
    expect((await post(admin, `/api/payments/${payment.id}/reverse`, { reason: 'Cheque bounced again' })).body.error.code).toBe('DUPLICATE_RESOURCE');
    expect((await get(admin, `/api/invoices/${invoice._id}`)).body.data.invoice.payment.status).toBe('UNPAID');
    const list = (await get(admin, `/api/invoices/${invoice._id}/payments`)).body.data.payments;
    expect(list.map((p) => [p.kind, p.amountPaise, p.reversed])).toEqual([['RECEIPT', 1_050_000, true], ['REVERSAL', -1_050_000, false]]);
  });

  it('validates amounts and dates; only the admin records; buyers see only their own', async () => {
    expect((await pay(0)).status).toBe(400);
    expect((await pay(10.5)).status).toBe(400);
    expect((await post(admin, `/api/invoices/${invoice._id}/payments`, { amountPaise: 100, receivedOn: addDaysToDateString(today, 1), method: 'CASH' })).status).toBe(400);
    for (const actor of [store, buyer]) expect((await pay(100, actor)).status).toBe(403);
    await pay(100_000);
    expect((await get(buyer, `/api/invoices/${invoice._id}/payments`)).body.data.payments).toHaveLength(1);
    expect((await get(otherBuyer, `/api/invoices/${invoice._id}/payments`)).status).toBe(404);
    expect((await get(buyer, '/api/invoices')).body.data.invoices[0].payment.status).toBe('PARTIALLY_PAID');
  });

  it('receivables group what is owed by buyer and age it past the due date', async () => {
    await newInvoice({ issuedAt: new Date(Date.now() - 45 * 86_400_000), totalPaise: 200_000 }); // 15 days overdue
    await newInvoice({ issuedAt: new Date(Date.now() - 100 * 86_400_000), totalPaise: 300_000 }); // 70 days overdue
    await pay(50_000);
    const res = await get(admin, '/api/payments/receivables');
    expect(res.body.data.totals).toMatchObject({ outstandingPaise: 1_000_000 + 200_000 + 300_000, notDue: 1_000_000, d1to30: 200_000, over60: 300_000, invoices: 3 });
    expect(res.body.data.byBuyer).toHaveLength(1);
    expect((await get(buyer, '/api/payments/receivables')).status).toBe(403);
  });
});
