import { Buyer } from '../models/Buyer.js';
import { Product } from '../models/Product.js';
import { searchAcross } from '../utils/search.js';

// ── Buyers ──────────────────────────────────────────────────────────────────────
export async function insertBuyer(data, session) {
  const [buyer] = await Buyer.create([data], { session });
  return buyer;
}

export function findBuyerById(id, { session } = {}) {
  return Buyer.findById(id).session(session ?? null).lean();
}

/**
 * $set on a document only if it still has the updatedAt we read (optimistic concurrency). Returns the
 * updated document, or null when someone else changed it first.
 */
function updateIfUnchanged(Model, id, updatedAt, set, session) {
  return Model.findOneAndUpdate({ _id: id, updatedAt }, { $set: set }, { returnDocument: 'after', session, lean: true });
}

export const updateBuyerIfUnchanged = (id, updatedAt, set, session) => updateIfUnchanged(Buyer, id, updatedAt, set, session);
export const updateProductIfUnchanged = (id, updatedAt, set, session) => updateIfUnchanged(Product, id, updatedAt, set, session);

export async function findBuyersPage({ isActive, q }, { page, limit }) {
  const filter = { ...searchAcross(['code', 'name'], q) };
  if (isActive !== undefined) filter.isActive = isActive;
  const [buyers, total] = await Promise.all([
    Buyer.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Buyer.countDocuments(filter),
  ]);
  return { buyers, total };
}

// ── Products ────────────────────────────────────────────────────────────────────
export async function insertProduct(data, session) {
  const [product] = await Product.create([data], { session });
  return product;
}

export function findProductById(id, { session } = {}) {
  return Product.findById(id).session(session ?? null).lean();
}

export async function findProductsPage({ material, colour, weave, q, isActive }, { page, limit }) {
  const filter = { ...searchAcross(['code', 'name'], q) };
  if (material) filter.material = material;
  if (colour) filter.colour = colour;
  if (weave) filter.weave = weave;
  if (isActive !== undefined) filter.isActive = isActive;
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ material: 1, colour: 1, code: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return { products, total };
}
