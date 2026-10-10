import { Buyer } from '../models/Buyer.js';
import { Product } from '../models/Product.js';

// ── Buyers ──────────────────────────────────────────────────────────────────────
export async function insertBuyer(data, session) {
  const [buyer] = await Buyer.create([data], { session });
  return buyer;
}

export function findBuyerById(id, { session } = {}) {
  return Buyer.findById(id).session(session ?? null).lean();
}

export async function findBuyersPage({ isActive }, { page, limit }) {
  const filter = {};
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

export async function findProductsPage({ material, colour, isActive }, { page, limit }) {
  const filter = {};
  if (material) filter.material = material;
  if (colour) filter.colour = colour;
  if (isActive !== undefined) filter.isActive = isActive;
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ material: 1, colour: 1, code: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return { products, total };
}
