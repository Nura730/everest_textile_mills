import mongoose from 'mongoose';
import { MACHINE_TYPES, WEAVES } from '../constants/production.js';
import { YARN_MATERIALS } from './YarnLot.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * A catalog fabric. yarnGramsPerMetre is the planning figure that turns "5,000 m" into
 * "850 kg of Navy Cotton yarn" (D2). It includes standard process waste.
 */
const productSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    material: { type: String, required: true, enum: YARN_MATERIALS },
    colour: { type: String, required: true, trim: true, maxlength: 50 },
    weave: { type: String, required: true, enum: WEAVES },
    widthCm: { type: Number, required: true, min: 1, validate: integer },
    gsm: { type: Number, required: true, min: 1, validate: integer },
    yarnGramsPerMetre: { type: Number, required: true, min: 1, validate: integer },
    machineType: { type: String, required: true, enum: MACHINE_TYPES, default: 'WEAVING' },
    defaultPricePerMetrePaise: { type: Number, required: true, min: 1, validate: integer },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Catalog browsing: active products by material and colour (same pattern as the yarn catalog).
productSchema.index({ isActive: 1, material: 1, colour: 1 });

/**
 * includeSpec: the yarn consumption figure is internal manufacturing data, not shown to buyers.
 */
export function toPublicProduct(product, { includeSpec }) {
  const publicProduct = {
    id: String(product._id),
    code: product.code,
    name: product.name,
    material: product.material,
    colour: product.colour,
    weave: product.weave,
    widthCm: product.widthCm,
    gsm: product.gsm,
    machineType: product.machineType,
    pricePerMetrePaise: product.defaultPricePerMetrePaise,
    isActive: product.isActive,
    createdAt: product.createdAt,
  };
  if (includeSpec) publicProduct.yarnGramsPerMetre = product.yarnGramsPerMetre;
  return publicProduct;
}

export const Product = mongoose.model('Product', productSchema);
