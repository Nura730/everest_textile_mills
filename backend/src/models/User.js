import mongoose from 'mongoose';
import { ALL_ROLES } from '../constants/roles.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    // Stored lowercased so "Arun@X.com" and "arun@x.com" are one account (and one unique key).
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      unique: true,
    },
    // Never loaded unless a query explicitly asks for it with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ALL_ROLES },
    // Deactivate, never delete: audit history must keep pointing at a real user.
    isActive: { type: Boolean, default: true },
    // Every token carries the version it was issued with; bumping this revokes them all.
    tokenVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: null },
    // Who granted this access. null for accounts created by the seed/bootstrap scripts.
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // The buyer COMPANY a BUYER account belongs to (ownership checks). Required for role BUYER,
    // enforced when accounts are created (user.service), not here: accounts created before this
    // field existed stay valid and simply fail closed (no orders visible) until linked.
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // Second line of defence if a document is ever serialized directly.
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

/**
 * The only user shape the API returns. An allowlist: a field added to the schema
 * later stays private until someone deliberately adds it here.
 * Works on documents and on .lean() objects.
 */
export function toPublicUser(user) {
  return {
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    buyerId: user.buyerId ? String(user.buyerId) : null,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

export const User = mongoose.model('User', userSchema);
