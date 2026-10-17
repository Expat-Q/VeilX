import mongoose, { Schema, Document, Model } from "mongoose";

export type InvoiceStatus = "UNPAID" | "SETTLING" | "PAID" | "FORWARD_PENDING" | "EXPIRED";

export interface IPaymentLink extends Document {
  creatorUserId: mongoose.Types.ObjectId;
  creatorUsernameSnapshot: string;
  slug: string; // Unique random id for public URL (e.g. inv_8Kx9a)
  title: string;
  amountZec: number;
  recipientShieldedUa: string;
  escrowDepositAddress: string;
  diversifierIndex?: string;
  status: InvoiceStatus;
  paidAt?: Date;
  paidTxid?: string;
  forwardTxid?: string;
  forwardOpid?: string;
  payoutError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentLinkSchema = new Schema<IPaymentLink>(
  {
    creatorUserId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    creatorUsernameSnapshot: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    amountZec: { type: Number, required: true },
    recipientShieldedUa: { type: String, required: true },
    escrowDepositAddress: { type: String, required: true, index: true },
    diversifierIndex: { type: String },
    status: {
      type: String,
      enum: ["UNPAID", "SETTLING", "PAID", "FORWARD_PENDING", "EXPIRED"],
      default: "UNPAID",
      index: true,
    },
    paidAt: { type: Date },
    forwardOpid: { type: String, index: true },
    payoutError: { type: String },
    paidTxid: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      match: [
        process.env.NODE_ENV === "production"
          ? /^[0-9a-fA-F]{64}$/
          : /^([0-9a-fA-F]{64}|(sim_tx_|valid_test_|test_|forward_txid_)[a-zA-Z0-9_-]+)$/,
        "Transaction hash must be a 64-character hexadecimal string",
      ],
    },
    forwardTxid: {
      type: String,
      sparse: true,
      index: true,
      match: [
        process.env.NODE_ENV === "production"
          ? /^([0-9a-fA-F]{64}|opid-[a-zA-Z0-9_-]+)$/
          : /^([0-9a-fA-F]{64}|opid-[a-zA-Z0-9_-]+|(sim_tx_|valid_test_|test_|forward_txid_)[a-zA-Z0-9_-]+)$/,
        "Transaction hash or operation ID must be valid",
      ],
    },
  },
  { timestamps: true }
);

PaymentLinkSchema.index({ creatorUsernameSnapshot: 1, status: 1 });
PaymentLinkSchema.index({ escrowDepositAddress: 1, status: 1 });

export const PaymentLink: Model<IPaymentLink> =
  mongoose.models.PaymentLink ||
  mongoose.model<IPaymentLink>("PaymentLink", PaymentLinkSchema);
