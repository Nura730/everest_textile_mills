import mongoose from 'mongoose';

/** Named sequences for human-readable numbers, e.g. { _id: 'order:2026', seq: 104 }. */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter = mongoose.model('Counter', counterSchema);
