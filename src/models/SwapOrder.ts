import mongoose, { Schema, Document, Model } from "mongoose";
import { SupportedSwapToken } from "@/types/swap";

export type SwapOrderStatus =
  | "WAITING_DEPOSIT"
  | "DETECTED"
  | "CONVERTING"
  | "SETTLED"
  | "EXPIRED";

export interface ISwapOrder extends Document {
  orderId: string;
  tipId?: string;
  fromToken: SupportedSwapToken;
  zecAmount: number;
  depositAmount: number;
  depositAddress: string;
  targetZecAddress: string;
  estimatedMinutes: number;
  status: SwapOrderStatus;
  settlementZecTxid?: string;
  depositTxHash?: string;
  createdAtMs: number;
  expiresAtMs: number;
  createdAt: Date;
  updatedAt: Date;
}

const SwapOrderSchema = new Schema<ISwapOrder>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    tipId: { type: String, index: true },
    fromToken: {
      id: { type: String, required: true },
      symbol: { type: String, required: true },
      name: { type: String, required: true },
      network: { type: String, required: true },
      networkName: { type: String, required: true },
      chainId: { type: Number, required: true },
      decimals: { type: Number, required: true },
      contractAddress: { type: String },
      icon: { type: String },
    },
    zecAmount: { type: Number, required: true },
    depositAmount: { type: Number, required: true },
    depositAddress: { type: String, required: true },
    targetZecAddress: { type: String, required: true },
    estimatedMinutes: { type: Number, default: 2 },
    status: {
      type: String,
      enum: ["WAITING_DEPOSIT", "DETECTED", "CONVERTING", "SETTLED", "EXPIRED"],
      default: "WAITING_DEPOSIT",
      index: true,
    },
    settlementZecTxid: { type: String, index: true },
    depositTxHash: { type: String, index: true },
    createdAtMs: { type: Number, required: true },
    expiresAtMs: { type: Number, required: true, index: true },
  },
  { timestamps: true }
);

SwapOrderSchema.index({ tipId: 1, status: 1 });

export const SwapOrderModel: Model<ISwapOrder> =
  mongoose.models.SwapOrder ||
  mongoose.model<ISwapOrder>("SwapOrder", SwapOrderSchema);
