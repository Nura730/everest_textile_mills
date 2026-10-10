import { recordAudit } from '../audit/recordAudit.js';
import { ROLES } from '../constants/roles.js';
import { toPublicBuyer } from '../models/Buyer.js';
import { toPublicProduct } from '../models/Product.js';
import {
  findBuyerById,
  findBuyersPage,
  findProductById,
  findProductsPage,
  insertBuyer,
  insertProduct,
  updateBuyerIfUnchanged,
  updateProductIfUnchanged,
} from '../repositories/catalog.repository.js';
import { AppError } from '../utils/AppError.js';
import { diffFields, isStale, staleEditConflict } from '../utils/edits.js';
import { runInTransaction } from '../utils/transaction.js';

// ── Buyers (ADMIN only, enforced on the routes) ─────────────────────────────────

/** A duplicate code is rejected by the unique index (409 DUPLICATE_RESOURCE). */
export function createBuyer(input, context) {
  return runInTransaction(async (session) => {
    const buyer = await insertBuyer({ ...input, createdBy: context.actor.id }, session);
    await recordAudit(
      { action: 'BUYER_CREATED', entityType: 'Buyer', entityId: buyer._id, after: { code: buyer.code, name: buyer.name } },
      context,
      session,
    );
    return toPublicBuyer(buyer);
  });
}

export async function listBuyers({ isActive, q, page, limit }) {
  const { buyers, total } = await findBuyersPage({ isActive, q }, { page, limit });
  return { buyers: buyers.map(toPublicBuyer), meta: { page, limit, total } };
}

export async function getBuyer(id) {
  const buyer = await findBuyerById(id);
  if (!buyer) throw new AppError('NOT_FOUND', 'Buyer not found');
  return toPublicBuyer(buyer);
}

// ── Products ────────────────────────────────────────────────────────────────────

/** Business rule: the yarn consumption figure is internal manufacturing data, hidden from buyers. */
function canSeeYarnSpec(actor) {
  return actor.role !== ROLES.BUYER;
}

export function createProduct({ pricePerMetrePaise, ...input }, context) {
  return runInTransaction(async (session) => {
    const product = await insertProduct(
      { ...input, defaultPricePerMetrePaise: pricePerMetrePaise, createdBy: context.actor.id },
      session,
    );
    await recordAudit(
      {
        action: 'PRODUCT_CREATED',
        entityType: 'Product',
        entityId: product._id,
        after: {
          code: product.code,
          yarnGramsPerMetre: product.yarnGramsPerMetre,
          defaultPricePerMetrePaise: product.defaultPricePerMetrePaise,
        },
      },
      context,
      session,
    );
    return toPublicProduct(product, { includeSpec: true });
  });
}

/** Which product statuses a viewer may list: only an ADMIN ever sees retired products. */
function productStatusFilter(actor, { includeInactive, isActive }) {
  if (actor.role !== ROLES.ADMIN) return true;
  if (isActive !== undefined) return isActive;
  return includeInactive ? undefined : true;
}

export async function listProducts({ material, colour, weave, q, includeInactive, isActive, page, limit }, actor) {
  const { products, total } = await findProductsPage(
    { material, colour, weave, q, isActive: productStatusFilter(actor, { includeInactive, isActive }) },
    { page, limit },
  );
  const includeSpec = canSeeYarnSpec(actor);
  return { products: products.map((product) => toPublicProduct(product, { includeSpec })), meta: { page, limit, total } };
}

export async function getProduct(id, actor) {
  const product = await findProductById(id);
  if (!product || (!product.isActive && actor.role !== ROLES.ADMIN)) {
    throw new AppError('NOT_FOUND', 'Product not found');
  }
  return toPublicProduct(product, { includeSpec: canSeeYarnSpec(actor) });
}

// ── Edits (ADMIN only, enforced on the routes) ──────────────────────────────────

/**
 * Shared edit flow: load, diff, refuse a stale copy, guarded write, audit, all in one transaction.
 *  - Nothing actually changes -> the current record is returned with no write and no audit, which
 *    also makes a retried save (after a timeout) succeed instead of looking stale.
 *  - The client's updatedAt is older than the stored one -> 409 CONFLICT (someone else saved first).
 */
function editRecord({ id, expectedUpdatedAt, changes, load, write, check, audit, toPublic, what }, context) {
  return runInTransaction(async (session) => {
    const current = await load(id, { session });
    if (!current) throw new AppError('NOT_FOUND', `${what[0].toUpperCase()}${what.slice(1)} not found`);
    const diff = diffFields(current, changes);
    if (!diff) return toPublic(current);
    if (isStale(current, expectedUpdatedAt)) throw staleEditConflict(what);
    check?.(current, diff.after);

    const updated = await write(current._id, current.updatedAt, diff.after, session);
    if (!updated) throw staleEditConflict(what);
    await recordAudit({ action: audit, entityType: what === 'buyer' ? 'Buyer' : 'Product', entityId: current._id, ...diff }, context, session);
    return toPublic(updated);
  });
}

/** Contact details of a buyer company. Its code, users and orders are untouched. */
export function updateBuyer(id, { expectedUpdatedAt, ...changes }, context) {
  return editRecord(
    { id, expectedUpdatedAt, changes, load: findBuyerById, write: updateBuyerIfUnchanged, audit: 'BUYER_UPDATED', toPublic: toPublicBuyer, what: 'buyer' },
    context,
  );
}

/**
 * Name, price and yarn consumption of a catalog fabric. Applies to orders placed from now on:
 * existing orders keep the price and yarn figure copied onto them.
 */
export function updateProduct(id, { expectedUpdatedAt, pricePerMetrePaise, ...changes }, context) {
  return editRecord(
    {
      id,
      expectedUpdatedAt,
      changes: { ...changes, defaultPricePerMetrePaise: pricePerMetrePaise },
      load: findProductById,
      write: updateProductIfUnchanged,
      // Same rule as creation: yarn consumed per metre can't be less than the fabric's own weight.
      check: (product, after) => {
        if (after.yarnGramsPerMetre === undefined) return;
        const fabricGramsPerMetre = Math.floor((product.gsm * product.widthCm) / 100);
        if (after.yarnGramsPerMetre < fabricGramsPerMetre) {
          throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
            details: [{
              location: 'body',
              path: 'yarnGramsPerMetre',
              message: `must be at least ${fabricGramsPerMetre} (the fabric's own weight per metre: gsm × width)`,
            }],
          });
        }
      },
      audit: 'PRODUCT_UPDATED',
      toPublic: (product) => toPublicProduct(product, { includeSpec: true }),
      what: 'product',
    },
    context,
  );
}

/**
 * Activate or deactivate (records are never deleted). An inactive buyer cannot place orders and an
 * inactive product cannot be ordered; existing orders continue unchanged. Same status again: no-op.
 */
function setStatus({ id, isActive, load, write, audit, toPublic, what }, context) {
  return runInTransaction(async (session) => {
    const current = await load(id, { session });
    if (!current) throw new AppError('NOT_FOUND', `${what[0].toUpperCase()}${what.slice(1)} not found`);
    if (current.isActive === isActive) return toPublic(current);
    const updated = await write(current._id, current.updatedAt, { isActive }, session);
    if (!updated) throw staleEditConflict(what);
    await recordAudit(
      { action: audit, entityType: what === 'buyer' ? 'Buyer' : 'Product', entityId: current._id, before: { isActive: current.isActive }, after: { isActive } },
      context,
      session,
    );
    return toPublic(updated);
  });
}

export const setBuyerStatus = (id, { isActive }, context) =>
  setStatus({ id, isActive, load: findBuyerById, write: updateBuyerIfUnchanged, audit: 'BUYER_STATUS_CHANGED', toPublic: toPublicBuyer, what: 'buyer' }, context);

export const setProductStatus = (id, { isActive }, context) =>
  setStatus(
    {
      id,
      isActive,
      load: findProductById,
      write: updateProductIfUnchanged,
      audit: 'PRODUCT_STATUS_CHANGED',
      toPublic: (product) => toPublicProduct(product, { includeSpec: true }),
      what: 'product',
    },
    context,
  );
