import mongoose, { Schema, Document, Model } from "mongoose";

export type TipStatus =
  | "CREATED"
  | "FUNDING_DETECTED"
  | "FUNDED"
  | "CLAIMING"
  | "PENDING_VERIFICATION"
  | "CLAIMED"
  | "CANCELLED"
  | "EXPIRED";

export interface ITip extends Document {
  senderUserId?: mongoose.Types.ObjectId;
  senderUsernameSnapshot?: string;
  recipientXUserId: string;          // Target immutable numeric ID
  recipientUsernameSnapshot: string; // Snapshot display handle
  amountZats: number;                // Amount in Zatoshis (1 ZEC = 10^8 zats)
  amountZec: number;                 // Amount in ZEC (e.g. 0.25)
  isAnonymous: boolean;
  memo?: string;

  // Escrow Address
  escrowAddress: string;             // Unique diversified UA (u1test1...)
  diversifierIndex: string;          // 11-byte hex diversifier index

  // State Machine
  status: TipStatus;

  // Blockchain & Claim Operation Data
  fundingTxid?: string;
  fundingBlockHeight?: number;
  claimTxid?: string;
  payoutOpid?: string;
  payoutSubmittedAt?: Date;
  payoutError?: string;
  recipientShieldedAddress?: string;

  claimLockId?: string;
  claimedAt?: Date;
  expiresAt?: Date;
  expiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TipSchema = new Schema<ITip>(
  {
    senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
    senderUsernameSnapshot: { type: String },
    recipientXUserId: { type: String, required: true, index: true },
    recipientUsernameSnapshot: { type: String, required: true },
    amountZats: { type: Number, required: true },
    amountZec: { type: Number, required: true },
    isAnonymous: { type: Boolean, default: false },
    memo: { type: String },

    escrowAddress: { type: String, required: true, unique: true, index: true },
    diversifierIndex: { type: String, required: true },

    status: {
      type: String,
      enum: [
        "CREATED",
        "FUNDING_DETECTED",
        "FUNDED",
        "CLAIMING",
        "PENDING_VERIFICATION",
        "CLAIMED",
        "CANCELLED",
        "EXPIRED",
      ],
      default: "CREATED",
      index: true,
    },

    fundingTxid: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      match: [
        process.env.NODE_ENV === "production"
          ? /^([0-9a-fA-F]{64}|0x[0-9a-fA-F]{64})$/
          : /^([0-9a-fA-F]{64}|0x[0-9a-fA-F]{64}|(sim_tx_|valid_test_|test_|payout_txid_|mined_claim_txid_)[a-zA-Z0-9_-]+)$/,
        "Transaction hash must be a 64-character hexadecimal string or 0x-prefixed EVM hash",
      ],
    },
    fundingBlockHeight: { type: Number },
    claimTxid: {
      type: String,
      sparse: true,
      index: true,
      match: [
        process.env.NODE_ENV === "production"
          ? /^[0-9a-fA-F]{64}$/
          : /^([0-9a-fA-F]{64}|(sim_tx_|valid_test_|test_|payout_txid_|mined_claim_txid_)[a-zA-Z0-9_-]+)$/,
        "Transaction hash must be a 64-character hexadecimal string",
      ],
    },
    payoutOpid: { type: String, index: true },
    payoutSubmittedAt: { type: Date },
    payoutError: { type: String },
    recipientShieldedAddress: { type: String },
    claimLockId: { type: String, index: true },

    claimedAt: { type: Date },
    expiresAt: { type: Date, index: true },
    expiredAt: { type: Date },
  },
  { timestamps: true }
);

TipSchema.index({ recipientXUserId: 1, status: 1 });
TipSchema.index({ status: 1, expiresAt: 1 });
TipSchema.index({ status: 1, payoutSubmittedAt: 1 });

export const Tip: Model<ITip> =
  mongoose.models.Tip || mongoose.model<ITip>("Tip", TipSchema);
