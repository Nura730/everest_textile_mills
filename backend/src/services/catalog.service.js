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
} from '../repositories/catalog.repository.js';
import { AppError } from '../utils/AppError.js';
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

export async function listBuyers({ isActive, page, limit }) {
  const { buyers, total } = await findBuyersPage({ isActive }, { page, limit });
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

export async function listProducts({ material, colour, includeInactive, page, limit }, actor) {
  // Only an ADMIN can see retired products; everyone else browses what can be ordered today.
  const isActive = actor.role === ROLES.ADMIN && includeInactive ? undefined : true;
  const { products, total } = await findProductsPage({ material, colour, isActive }, { page, limit });
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
