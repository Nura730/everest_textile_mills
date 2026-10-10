import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A buyer COMPANY. Several BUYER user accounts can belong to one company (users.buyerId). */
const buyerSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    contactName: { type: String, trim: true, maxlength: 100, default: null },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    phone: { type: String, trim: true, maxlength: 20, default: null },
    address: { type: String, trim: true, maxlength: 300, default: null },
    // Deactivate, never delete: orders keep pointing at the company.
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Admin list: active companies by name.
buyerSchema.index({ isActive: 1, name: 1 });

export function toPublicBuyer(buyer) {
  return {
    id: String(buyer._id),
    code: buyer.code,
    name: buyer.name,
    contactName: buyer.contactName ?? null,
    email: buyer.email ?? null,
    phone: buyer.phone ?? null,
    address: buyer.address ?? null,
    isActive: buyer.isActive,
    createdAt: buyer.createdAt,
    updatedAt: buyer.updatedAt,
  };
}

export const Buyer = mongoose.model('Buyer', buyerSchema);
