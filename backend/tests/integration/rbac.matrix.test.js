import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { resetLoginRateLimits } from '../../src/middleware/rateLimit.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { MaterialReservation } from '../../src/models/MaterialReservation.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { Dispatch, FinishedGood, Invoice } from '../../src/models/Fulfilment.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import {
  clearCatalog,
  createTestBuyer,
  createTestOrder,
  createTestProduct,
  daysFromToday,
  ensureCatalogCollections,
} from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

/**
 * THE PERMISSION MATRIX. Every protected route and the roles allowed to call it.
 * Each later phase adds its routes here; a route missing from this table is a review flag.
 * `build` returns { path, body, headers } for a fresh, valid request so allowed roles get past
 * validation and the test checks authorization only.
 */
let seq = 0;
const STOCK_VIEWERS = [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN];
// Every BUYER actor belongs to this company, and orders built below belong to it too, so the
// matrix tests role permissions with ownership satisfied (ownership has its own tests).
let matrixBuyer;
let matrixProduct;
const newOrder = () => createTestOrder({ buyer: matrixBuyer, product: matrixProduct, createdBy: '64b7f0c2a1b2c3d4e5f60718' });

async function existingLot({ totalGrams = 100_000 } = {}) {
  seq += 1;
  return YarnLot.create({
    lotNumber: `MATRIX-${seq}`,
    material: 'COTTON',
    colour: 'Navy',
    supplierName: 'Matrix Supplier',
    costPerKgPaise: 30000,
    receivedAt: new Date(),
    receivedBy: '64b7f0c2a1b2c3d4e5f60718',
    totalGrams,
  });
}
const MATRIX_ACTOR = '64b7f0c2a1b2c3d4e5f60718';

/** A MATERIAL_RESERVED order holding 850 kg in one lot (issuedGrams of it already on the floor). */
async function reservedOrder({ issuedGrams = 0 } = {}) {
  const lot = await existingLot({ totalGrams: 1_000_000 - issuedGrams });
  await YarnLot.updateOne({ _id: lot._id }, { $set: { reservedGrams: 850_000 - issuedGrams } });
  const order = await createTestOrder({ buyer: matrixBuyer, product: matrixProduct, createdBy: MATRIX_ACTOR, status: 'MATERIAL_RESERVED' });
  await MaterialReservation.create({
    orderId: order._id, yarnLotId: lot._id, lotNumber: lot.lotNumber, reservedGrams: 850_000, issuedGrams,
    status: issuedGrams ? 'PARTIALLY_ISSUED' : 'ACTIVE', createdBy: MATRIX_ACTOR,
  });
  return { order, lot };
}

const MACHINE_VIEWERS = [ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN];
const MACHINE_OPERATORS = [ROLES.FLOOR_MANAGER, ROLES.ADMIN];
const newMachine = (overrides = {}) => {
  seq += 1;
  return Machine.create({ code: `M-${seq}`, name: `Matrix machine ${seq}`, type: 'WEAVING', ratedCmPerHour: 1500, ...overrides });
};
async function openProblem() {
  const machine = await newMachine();
  const event = await MachineEvent.create({
    machineId: machine._id, type: 'PROBLEM_REPORTED', fromStatus: 'AVAILABLE', toStatus: 'AVAILABLE',
    problem: { category: 'OTHER', severity: 'LOW', description: 'Matrix problem' }, actorId: MATRIX_ACTOR, actorRole: 'FLOOR_MANAGER',
  });
  return { machine, event };
}

const PRODUCTION_VIEWERS = [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN];
const FLOOR = [ROLES.FLOOR_MANAGER, ROLES.ADMIN];

/** A run in `status` on its own machine, for a reserved order with yarn on the floor. */
async function runIn(status, { rollCount = 0 } = {}) {
  const { order } = await reservedOrder({ issuedGrams: 100_000 });
  const machineStatus = { PLANNED: 'ASSIGNED', RUNNING: 'RUNNING', PAUSED: 'PAUSED' }[status] ?? 'AVAILABLE';
  const machine = await newMachine({ status: machineStatus });
  seq += 1;
  const run = await ProductionRun.create({
    runNumber: `RUN-MTX-${seq}`, orderId: order._id, orderNumber: order.orderNumber, machineId: machine._id, machineCode: machine.code,
    targetCm: 100_000, producedCm: rollCount * 1000, rollCount, status, supervisorId: MATRIX_ACTOR,
  });
  await Machine.updateOne({ _id: machine._id }, { $set: { currentRunId: run._id } });
  if (status !== 'PLANNED') await Order.updateOne({ _id: order._id }, { $set: { status: 'IN_PRODUCTION' } });
  return run;
}

/** A roll in `status` from a running run. */
async function rollIn(status = 'QC_PENDING') {
  const run = await runIn('RUNNING');
  seq += 1;
  return Roll.create({
    rollNumber: `ROLL-MTX-${seq}`, orderId: run.orderId, orderNumber: run.orderNumber, runId: run._id, runNumber: run.runNumber,
    machineId: run.machineId, machineCode: run.machineCode, lengthCm: 10_000, producedBy: MATRIX_ACTOR, status,
  });
}
const QC = [ROLES.QC_INSPECTOR, ROLES.ADMIN];
const QC_VIEWERS = [ROLES.QC_INSPECTOR, ROLES.FLOOR_MANAGER, ROLES.ADMIN];

/** A READY_FOR_DISPATCH order of the matrix buyer with one finished good in stock. */
async function readyGood() {
  const order = await newOrder();
  await Order.updateOne({ _id: order._id }, { $set: { status: 'READY_FOR_DISPATCH' } });
  seq += 1;
  const fg = await FinishedGood.create({
    rollId: new mongoose.Types.ObjectId(), rollNumber: `ROLL-FG-${seq}`, orderId: order._id, orderNumber: order.orderNumber, buyerId: matrixBuyer._id,
    buyerName: matrixBuyer.name, productName: 'Fabric', material: 'COTTON', colour: 'Navy', lengthCm: 10_000,
  });
  return { order, fg };
}
async function dispatchIn(status) {
  const { order, fg } = await readyGood();
  seq += 1;
  const dispatch = await Dispatch.create({
    dispatchNumber: `DSP-MTX-${seq}`, orderId: order._id, orderNumber: order.orderNumber, buyerId: matrixBuyer._id, buyerName: matrixBuyer.name,
    lines: [{ finishedGoodId: fg._id, rollNumber: fg.rollNumber, lengthCm: 10_000 }], totalLengthCm: 10_000, status, preparedBy: MATRIX_ACTOR,
  });
  await FinishedGood.updateOne({ _id: fg._id }, { $set: { status: status === 'CONFIRMED' ? 'DISPATCHED' : 'RESERVED_FOR_DISPATCH', dispatchId: dispatch._id } });
  return dispatch;
}
const STORE = [ROLES.STORE_KEEPER, ROLES.ADMIN];
const ALL_STAFF = [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN];

const MATRIX = [
  {
    name: 'GET /api/auth/me',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/auth/me' }),
  },
  {
    name: 'GET /api/users',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/users' }),
  },
  {
    name: 'POST /api/users',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return {
        path: '/api/users',
        body: { name: 'Matrix User', email: `matrix-${seq}@everest.test`, password: TEST_PASSWORD, role: ROLES.QC_INSPECTOR },
      };
    },
  },
  {
    name: 'PATCH /api/users/:id/status',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const target = await createTestUser();
      return { path: `/api/users/${target._id}/status`, body: { isActive: false } };
    },
  },
  // ── Phase 3: inventory ──
  {
    name: 'GET /api/yarn-lots',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: '/api/yarn-lots' }),
  },
  {
    name: 'POST /api/yarn-lots',
    method: 'post',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => ({ path: '/api/yarn-lots', body: receiptBody(), headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'GET /api/yarn-lots/:id',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/yarn-lots/${(await existingLot())._id}` }),
  },
  {
    name: 'GET /api/yarn-lots/:id/transactions',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/yarn-lots/${(await existingLot())._id}/transactions` }),
  },
  {
    name: 'POST /api/yarn-lots/:id/adjustments',
    method: 'post',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => ({
      path: `/api/yarn-lots/${(await existingLot())._id}/adjustments`,
      body: { deltaKg: 1, reason: 'Matrix recount' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'GET /api/inventory/yarn-summary',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: '/api/inventory/yarn-summary' }),
  },
  {
    name: 'GET /api/inventory/reconciliation',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/inventory/reconciliation' }),
  },
  // ── Phase 5: buyers, catalog, orders ──
  {
    name: 'GET /api/buyers',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/buyers' }),
  },
  {
    name: 'POST /api/buyers',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return { path: '/api/buyers', body: { code: `BUY-M${seq}`, name: 'Matrix Buyer Co' } };
    },
  },
  {
    name: 'GET /api/buyers/:id',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: `/api/buyers/${matrixBuyer._id}` }),
  },
  {
    name: 'GET /api/products',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/products' }),
  },
  {
    name: 'POST /api/products',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return {
        path: '/api/products',
        body: {
          code: `MTX-${seq}`, name: 'Matrix Fabric', material: 'COTTON', colour: 'Navy', weave: 'PLAIN',
          widthCm: 150, gsm: 110, yarnGramsPerMetre: 170, pricePerMetrePaise: 18000,
        },
      };
    },
  },
  {
    name: 'GET /api/products/:id',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: `/api/products/${matrixProduct._id}` }),
  },
  {
    name: 'GET /api/orders',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/orders' }),
  },
  {
    name: 'POST /api/orders',
    method: 'post',
    allowed: [ROLES.BUYER, ROLES.ADMIN],
    // Only an ADMIN names the buyer; a buyer's body must not contain buyerId.
    build: async (actor) => ({
      path: '/api/orders',
      body: {
        productId: String(matrixProduct._id),
        quantityMetres: 100,
        requiredBy: daysFromToday(20),
        ...(actor?.role === ROLES.ADMIN ? { buyerId: String(matrixBuyer._id) } : {}),
      },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'GET /api/orders/:id',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: `/api/orders/${(await newOrder())._id}` }),
  },
  // ── Edits: buyers, products, orders ──
  {
    name: 'PATCH /api/buyers/:id',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const buyer = await createTestBuyer();
      return { path: `/api/buyers/${buyer._id}`, body: { expectedUpdatedAt: buyer.updatedAt.toISOString(), name: 'Matrix Renamed Co' } };
    },
  },
  {
    name: 'PATCH /api/buyers/:id/status',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: `/api/buyers/${(await createTestBuyer())._id}/status`, body: { isActive: false } }),
  },
  {
    name: 'PATCH /api/products/:id',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const product = await createTestProduct();
      return { path: `/api/products/${product._id}`, body: { expectedUpdatedAt: product.updatedAt.toISOString(), pricePerMetrePaise: 19000 } };
    },
  },
  {
    name: 'PATCH /api/products/:id/status',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: `/api/products/${(await createTestProduct())._id}/status`, body: { isActive: false } }),
  },
  {
    name: 'PATCH /api/orders/:id',
    method: 'patch',
    allowed: [ROLES.BUYER, ROLES.ADMIN],
    build: async () => {
      const order = await newOrder();
      return {
        path: `/api/orders/${order._id}`,
        body: { expectedUpdatedAt: order.updatedAt.toISOString(), buyerNotes: 'Matrix edit' },
        headers: { 'Idempotency-Key': newKey() },
      };
    },
  },
  {
    name: 'PATCH /api/yarn-lots/:id',
    method: 'patch',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => {
      const lot = await existingLot();
      return { path: `/api/yarn-lots/${lot._id}`, body: { expectedUpdatedAt: lot.updatedAt.toISOString(), supplierName: 'Matrix Supplier Two' } };
    },
  },
  // ── Phase 4: material reservation ──
  {
    name: 'POST /api/orders/:id/reserve',
    method: 'post',
    allowed: [ROLES.FLOOR_MANAGER, ROLES.ADMIN],
    build: async () => {
      await existingLot({ totalGrams: 1_000_000 });
      const order = await createTestOrder({ buyer: matrixBuyer, product: matrixProduct, createdBy: MATRIX_ACTOR, status: 'CONFIRMED' });
      return { path: `/api/orders/${order._id}/reserve`, body: {}, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  {
    name: 'GET /api/orders/:id/reservations',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/orders/${(await newOrder())._id}/reservations` }),
  },
  {
    name: 'POST /api/orders/:id/issue',
    method: 'post',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => {
      const { order } = await reservedOrder();
      return { path: `/api/orders/${order._id}/issue`, body: { quantityKg: 10 }, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  {
    name: 'POST /api/orders/:id/return',
    method: 'post',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => {
      const { order } = await reservedOrder({ issuedGrams: 100_000 });
      return { path: `/api/orders/${order._id}/return`, body: { quantityKg: 10, reason: 'Matrix return' }, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  // ── Phase 7: machines ──
  { name: 'GET /api/machines', method: 'get', allowed: MACHINE_VIEWERS, build: async () => ({ path: '/api/machines' }) },
  {
    name: 'POST /api/machines',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => { seq += 1; return { path: '/api/machines', body: { code: `MX-${seq}`, name: 'Matrix loom', type: 'WEAVING', ratedMetresPerHour: 15 } }; },
  },
  { name: 'GET /api/machines/:id', method: 'get', allowed: MACHINE_VIEWERS, build: async () => ({ path: `/api/machines/${(await newMachine())._id}` }) },
  {
    name: 'PATCH /api/machines/:id',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => { const m = await newMachine(); return { path: `/api/machines/${m._id}`, body: { expectedUpdatedAt: m.updatedAt.toISOString(), name: 'Matrix renamed' } }; },
  },
  { name: 'PATCH /api/machines/:id/active', method: 'patch', allowed: [ROLES.ADMIN], build: async () => ({ path: `/api/machines/${(await newMachine())._id}/active`, body: { isActive: false } }) },
  { name: 'GET /api/machines/:id/events', method: 'get', allowed: MACHINE_VIEWERS, build: async () => ({ path: `/api/machines/${(await newMachine())._id}/events` }) },
  {
    name: 'POST /api/machines/:id/maintenance/start',
    method: 'post',
    allowed: MACHINE_OPERATORS,
    build: async () => ({ path: `/api/machines/${(await newMachine())._id}/maintenance/start`, body: {}, headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'POST /api/machines/:id/maintenance/end',
    method: 'post',
    allowed: MACHINE_OPERATORS,
    build: async () => ({ path: `/api/machines/${(await newMachine({ status: 'MAINTENANCE' }))._id}/maintenance/end`, body: {}, headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'POST /api/machines/:id/problems',
    method: 'post',
    allowed: MACHINE_OPERATORS,
    build: async () => ({
      path: `/api/machines/${(await newMachine())._id}/problems`,
      body: { category: 'MECHANICAL', severity: 'LOW', description: 'Matrix report' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'POST /api/machines/:id/problems/:eventId/resolve',
    method: 'post',
    allowed: MACHINE_OPERATORS,
    build: async () => {
      const { machine, event } = await openProblem();
      return { path: `/api/machines/${machine._id}/problems/${event._id}/resolve`, body: { resolution: 'Matrix fix' }, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  // ── Phase 8: production runs ──
  { name: 'GET /api/production-runs', method: 'get', allowed: PRODUCTION_VIEWERS, build: async () => ({ path: '/api/production-runs' }) },
  {
    name: 'POST /api/production-runs',
    method: 'post',
    allowed: FLOOR,
    build: async () => {
      const { order } = await reservedOrder({ issuedGrams: 100_000 });
      const machine = await newMachine();
      return { path: '/api/production-runs', body: { orderId: String(order._id), machineId: String(machine._id), targetMetres: 100 }, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  { name: 'GET /api/production-runs/:id', method: 'get', allowed: PRODUCTION_VIEWERS, build: async () => ({ path: `/api/production-runs/${(await runIn('PLANNED'))._id}` }) },
  ...[
    ['start', 'PLANNED', {}],
    ['pause', 'RUNNING', { reason: 'Matrix pause' }],
    ['resume', 'PAUSED', {}],
    ['complete', 'RUNNING', {}, { rollCount: 1 }],
    ['cancel', 'PLANNED', { reason: 'Matrix cancel' }],
    ['rolls', 'RUNNING', { lengthMetres: 10 }],
  ].map(([action, status, body, opts]) => ({
    name: `POST /api/production-runs/:id/${action}`,
    method: 'post',
    allowed: FLOOR,
    build: async () => ({ path: `/api/production-runs/${(await runIn(status, opts))._id}/${action}`, body, headers: { 'Idempotency-Key': newKey() } }),
  })),
  // ── Phases 9-10: rolls and QC ──
  { name: 'GET /api/rolls', method: 'get', allowed: PRODUCTION_VIEWERS, build: async () => ({ path: '/api/rolls' }) },
  { name: 'GET /api/rolls/:id', method: 'get', allowed: PRODUCTION_VIEWERS, build: async () => ({ path: `/api/rolls/${(await rollIn())._id}` }) },
  {
    name: 'POST /api/rolls/:id/inspections',
    method: 'post',
    allowed: QC,
    build: async () => ({ path: `/api/rolls/${(await rollIn())._id}/inspections`, body: { result: 'PASS', signature: SIGNED }, headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'POST /api/rolls/:id/rework-done',
    method: 'post',
    allowed: FLOOR,
    build: async () => ({ path: `/api/rolls/${(await rollIn('IN_REWORK'))._id}/rework-done`, body: {}, headers: { 'Idempotency-Key': newKey() } }),
  },
  { name: 'GET /api/qc/inspections', method: 'get', allowed: QC_VIEWERS, build: async () => ({ path: '/api/qc/inspections' }) },
  { name: 'GET /api/qc/summary', method: 'get', allowed: QC_VIEWERS, build: async () => ({ path: '/api/qc/summary' }) },
  // ── Phases 11-12: finished goods, dispatch, invoices ──
  { name: 'GET /api/finished-goods', method: 'get', allowed: ALL_STAFF, build: async () => ({ path: '/api/finished-goods' }) },
  {
    name: 'PATCH /api/finished-goods/:id/location',
    method: 'patch',
    allowed: STORE,
    build: async () => ({ path: `/api/finished-goods/${(await readyGood()).fg._id}/location`, body: { location: 'Rack A' }, headers: { 'Idempotency-Key': newKey() } }),
  },
  { name: 'GET /api/dispatches', method: 'get', allowed: [...ALL_STAFF, ROLES.BUYER], build: async () => ({ path: '/api/dispatches' }) },
  {
    name: 'POST /api/dispatches',
    method: 'post',
    allowed: STORE,
    build: async () => {
      const { order, fg } = await readyGood();
      return { path: '/api/dispatches', body: { orderId: String(order._id), finishedGoodIds: [String(fg._id)] }, headers: { 'Idempotency-Key': newKey() } };
    },
  },
  { name: 'GET /api/dispatches/:id', method: 'get', allowed: [...ALL_STAFF, ROLES.BUYER], build: async () => ({ path: `/api/dispatches/${(await dispatchIn('PREPARED'))._id}` }) },
  {
    name: 'POST /api/dispatches/:id/confirm',
    method: 'post',
    allowed: STORE,
    build: async () => ({ path: `/api/dispatches/${(await dispatchIn('PREPARED'))._id}/confirm`, body: { signature: SIGNED }, headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'POST /api/dispatches/:id/cancel',
    method: 'post',
    allowed: STORE,
    build: async () => ({ path: `/api/dispatches/${(await dispatchIn('PREPARED'))._id}/cancel`, body: { reason: 'Matrix cancel' }, headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'POST /api/dispatches/:id/invoice',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: `/api/dispatches/${(await dispatchIn('CONFIRMED'))._id}/invoice`, body: {}, headers: { 'Idempotency-Key': newKey() } }),
  },
  { name: 'GET /api/invoices', method: 'get', allowed: [ROLES.ADMIN, ROLES.BUYER], build: async () => ({ path: '/api/invoices' }) },
  {
    name: 'GET /api/invoices/:id',
    method: 'get',
    allowed: [ROLES.ADMIN, ROLES.BUYER],
    build: async () => {
      const dispatch = await dispatchIn('CONFIRMED');
      seq += 1;
      const invoice = await Invoice.create({
        invoiceNumber: `INV-MTX-${seq}`, orderId: dispatch.orderId, orderNumber: dispatch.orderNumber, dispatchId: dispatch._id, dispatchNumber: dispatch.dispatchNumber,
        buyerId: matrixBuyer._id, buyer: { code: matrixBuyer.code, name: matrixBuyer.name }, lines: [], subtotalPaise: 0, taxRateBasisPoints: 500, taxPaise: 0, totalPaise: 0, issuedBy: MATRIX_ACTOR,
      });
      return { path: `/api/invoices/${invoice._id}` };
    },
  },
  { name: 'GET /api/summary/fulfilment', method: 'get', allowed: ALL_STAFF, build: async () => ({ path: '/api/summary/fulfilment' }) },
  // ── Phase 17: intelligence ──
  { name: 'GET /api/intelligence/overview', method: 'get', allowed: [ROLES.ADMIN, ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER], build: async () => ({ path: '/api/intelligence/overview' }) },
  { name: 'GET /api/intelligence/orders/:id', method: 'get', allowed: [ROLES.ADMIN, ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER], build: async () => ({ path: `/api/intelligence/orders/${(await newOrder())._id}` }) },
  // ── Phase 15: offline sync ──
  {
    name: 'POST /api/sync/events',
    method: 'post',
    allowed: ALL_ROLES, // each event is checked against its own route's roles (sync.test.js)
    build: async () => ({
      path: '/api/sync/events',
      body: { deviceId: 'matrix-device-01', events: [{ eventId: randomUUID(), type: 'RUN_RESUME', payload: { runId: new mongoose.Types.ObjectId().toString() }, recordedAt: new Date().toISOString() }] },
    }),
  },
  { name: 'GET /api/sync/events', method: 'get', allowed: ALL_ROLES, build: async () => ({ path: '/api/sync/events' }) },
  // ── Phase 14: costing (owner only) ──
  { name: 'GET /api/costing/summary', method: 'get', allowed: [ROLES.ADMIN], build: async () => ({ path: '/api/costing/summary' }) },
  { name: 'GET /api/costing/overview', method: 'get', allowed: [ROLES.ADMIN], build: async () => ({ path: '/api/costing/overview' }) },
  { name: 'GET /api/costing/orders/:id', method: 'get', allowed: [ROLES.ADMIN], build: async () => ({ path: `/api/costing/orders/${(await newOrder())._id}` }) },
  { name: 'GET /api/costing/rates', method: 'get', allowed: [ROLES.ADMIN], build: async () => ({ path: '/api/costing/rates' }) },
  {
    name: 'POST /api/costing/rates',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => ({
      path: '/api/costing/rates',
      body: { labourPaisePerHour: 12_000, machinePaisePerHour: { SPINNING: 1, WEAVING: 1, DYEING: 1, FINISHING: 1 }, reworkPaisePerRoll: 0, overheadBasisPoints: 800, workingHoursPerDay: 16 },
    }),
  },
  // ── Phase 13 and buyer portal ──
  { name: 'GET /api/audit', method: 'get', allowed: ALL_ROLES, build: async () => ({ path: '/api/audit' }) },
  { name: 'GET /api/audit/actions', method: 'get', allowed: [ROLES.ADMIN], build: async () => ({ path: '/api/audit/actions' }) },
  {
    name: 'POST /api/audit/:id/corrections',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const { insertedId } = await AuditLog.collection.insertOne({ action: 'STOCK_ADJUSTED', actorId: new mongoose.Types.ObjectId(), actorRole: 'ADMIN', entityType: 'YarnLot', entityId: new mongoose.Types.ObjectId(), source: 'ONLINE', at: new Date() });
      return { path: `/api/audit/${insertedId}/corrections`, body: { note: 'Matrix correction' } };
    },
  },
  { name: 'GET /api/orders/:id/timeline', method: 'get', allowed: ALL_ROLES, build: async () => ({ path: `/api/orders/${(await newOrder())._id}/timeline` }) },
  // ── Phase 6: feasibility and confirmation ──
  {
    name: 'GET /api/orders/:id/feasibility',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/orders/${(await newOrder())._id}/feasibility` }),
  },
  {
    name: 'POST /api/orders/:id/confirm',
    method: 'post',
    allowed: [ROLES.ADMIN],
    // Enough Navy cotton for the order's 850 kg, so the allowed role passes feasibility.
    build: async () => {
      await existingLot({ totalGrams: 1_000_000 });
      return {
        path: `/api/orders/${(await newOrder())._id}/confirm`,
        body: {},
        headers: { 'Idempotency-Key': newKey() },
      };
    },
  },
  {
    name: 'POST /api/orders/:id/cancel',
    method: 'post',
    allowed: [ROLES.BUYER, ROLES.ADMIN],
    build: async () => ({
      path: `/api/orders/${(await newOrder())._id}/cancel`,
      body: { reason: 'Matrix cancellation' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'POST /api/orders/:id/reject',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => ({
      path: `/api/orders/${(await newOrder())._id}/reject`,
      body: { reason: 'Matrix rejection' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
];

const actorFor = (role) => createTestUser({ role, ...(role === ROLES.BUYER ? { buyerId: matrixBuyer._id } : {}) });

let app;
let logs;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
  await ensureInventoryCollections();
  await ensureCatalogCollections();
});

beforeEach(async () => {
  logs = captureLogs();
  app = createApp({ logger: logs.logger });
  matrixBuyer = await createTestBuyer();
  matrixProduct = await createTestProduct();
});

afterEach(async () => {
  await Machine.deleteMany({});
  await MachineEvent.collection.deleteMany({});
  await User.deleteMany({});
  await clearInventory();
  await clearCatalog();
});

afterAll(async () => {
  await resetLoginRateLimits();
  await disconnectDatabase();
});

async function call(route, actor) {
  const { path, body, headers = {} } = await route.build(actor);
  let req = request(app)[route.method](path);
  if (actor) req = req.set('Authorization', bearer(actor));
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return body === undefined ? req : req.send(body);
}

const cases = MATRIX.flatMap((route) =>
  ALL_ROLES.map((role) => [route.name, role, route.allowed.includes(role) ? 'allowed' : 'forbidden', route]),
);

describe('RBAC matrix', () => {
  it.each(MATRIX.map((route) => [route.name, route]))('%s returns 401 without a token', async (_name, route) => {
    const res = await call(route, null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(cases)('%s as %s is %s', async (_name, role, verdict, route) => {
    const actor = await actorFor(role);
    const res = await call(route, actor);

    if (verdict === 'allowed') {
      expect(res.status).toBeLessThan(400);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('credential leak sweep', () => {
  it('no response body or log line anywhere in the API contains a password or bcrypt hash', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN });
    const bodies = [];

    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: TEST_PASSWORD })).body);
    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: 'nope-nope-nope' })).body);
    for (const route of MATRIX) {
      for (const role of ALL_ROLES) {
        const actor = role === ROLES.ADMIN ? admin : await actorFor(role);
        bodies.push((await call(route, actor)).body);
      }
    }

    const hashes = (await User.find().select('+passwordHash').lean()).map((user) => user.passwordHash);
    const everything = [...bodies.map((body) => JSON.stringify(body)), ...logs.raw].join('\n');

    expect(everything).not.toContain(TEST_PASSWORD);
    expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/);
    for (const hash of hashes) expect(everything).not.toContain(hash);
  });
});
