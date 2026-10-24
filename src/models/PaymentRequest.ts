import mongoose, { Schema, Document, Model } from "mongoose";

export type RequestStatus = "PENDING" | "ACCEPTED" | "CANCELLED" | "SETTLING" | "FORWARD_PENDING" | "FULFILLED" | "SETTLED" | "FAILED";

export interface IPaymentRequest extends Document {
  requesterUserId: mongoose.Types.ObjectId;
  requesterUsernameSnapshot: string;
  targetXUserId: string;
  targetUsernameSnapshot: string;
  amountZec: number;
  memo?: string;
  recipientShieldedUa: string; // Requester's destination
  escrowDepositAddress: string;
  shieldedEscrowAddress?: string;
  diversifierIndex?: string;
  status: RequestStatus;
  paidTxid?: string;
  forwardTxid?: string;
  forwardOpid?: string;
  forwardAttemptAt?: Date;
  claimAttemptAt?: Date;
  payoutError?: string;
  paidAt?: Date;
  cancelledByRole?: "target" | "requester";
  cancelledByUsername?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentRequestSchema = new Schema<IPaymentRequest>(
  {
    requesterUserId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    requesterUsernameSnapshot: { type: String, required: true },
    targetXUserId: { type: String, required: true, index: true },
    targetUsernameSnapshot: { type: String, required: true },
    amountZec: { type: Number, required: true },
    memo: { type: String },
    recipientShieldedUa: { type: String, required: true },
    escrowDepositAddress: { type: String, required: true, index: true },
    shieldedEscrowAddress: { type: String },
    diversifierIndex: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "CANCELLED", "SETTLING", "FORWARD_PENDING", "FULFILLED", "SETTLED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    forwardOpid: { type: String, index: true },
    forwardAttemptAt: { type: Date },
    claimAttemptAt: { type: Date },
    payoutError: { type: String },
    paidTxid: {
      type: String,
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
      unique: true,
      sparse: true,
      index: true,
      match: [
        process.env.NODE_ENV === "production"
          ? /^([0-9a-fA-F]{64}|opid-[a-zA-Z0-9_-]+)$/
          : /^([0-9a-fA-F]{64}|opid-[a-zA-Z0-9_-]+|(sim_tx_|valid_test_|test_|forward_txid_)[a-zA-Z0-9_-]+)$/,
        "Transaction hash or operation ID must be valid",
      ],
    },
    paidAt: { type: Date },
    cancelledByRole: { type: String, enum: ["target", "requester"] },
    cancelledByUsername: { type: String },
  },
  { timestamps: true }
);

PaymentRequestSchema.index({ targetUsernameSnapshot: 1, status: 1 });
PaymentRequestSchema.index({ requesterUsernameSnapshot: 1, status: 1 });
PaymentRequestSchema.index({ targetXUserId: 1, status: 1 });

export const PaymentRequest: Model<IPaymentRequest> =
  mongoose.models.PaymentRequest ||
  mongoose.model<IPaymentRequest>("PaymentRequest", PaymentRequestSchema);
