import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  xUserId: string;          // Immutable numeric ID from X API v2 (e.g. "14829104829")
  xUsername: string;        // Snapshot display handle (e.g. "bob")
  xDisplayName?: string;
  profileImageUrl?: string;
  defaultShieldedAddress?: string;
  referredBy?: string;      // Handle or xUserId of referring user
  referralCount: number;    // Total users invited who signed up
  referralRewardsZec: number; // Accrued rewards in ZEC
  referralPoints: number;   // Loyalty reward points
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    xUserId: { type: String, required: true, unique: true, index: true },
    xUsername: { type: String, required: true, index: true },
    xDisplayName: { type: String },
    profileImageUrl: { type: String },
    defaultShieldedAddress: { type: String },
    referredBy: { type: String, index: true },
    referralCount: { type: Number, default: 0 },
    referralRewardsZec: { type: Number, default: 0 },
    referralPoints: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
