import { connectToDatabase } from "@/lib/mongodb";
import mongoose from "mongoose";
import { Tip, ITip } from "@/models/Tip";
import { PaymentRequest, IPaymentRequest } from "@/models/PaymentRequest";
import { PaymentLink, IPaymentLink } from "@/models/PaymentLink";
import { generateValidZcashAddress, validateZcashAddress, zallet, ALLOW_PAYMENT_SIMULATION } from "@/lib/zcash";
import { checkPayoutCircuitBreaker } from "@/lib/payout-controls";
import crypto from "crypto";

// In-memory persistent fallback store for development when MongoDB is offline
interface InMemoryStore {
  tips: any[];
  requests: any[];
  paylinks: any[];
  usedTxids: Set<string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __memoryStore: InMemoryStore | undefined;
}

if (!global.__memoryStore) {
  global.__memoryStore = {
    tips: [],
    requests: [],
    paylinks: [],
    usedTxids: new Set<string>(),
  };
}

const memoryStore = global.__memoryStore;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Checks across all collections if a txid has already been used for settlement
 */
async function isTxidAlreadyUsed(txid: string, excludeId?: string): Promise<boolean> {
  const cleanTxid = txid.trim();
  if (memoryStore.usedTxids.has(cleanTxid)) {
    return true;
  }

  try {
    await connectToDatabase();
    const isObjId = !!(excludeId && mongoose.Types.ObjectId.isValid(excludeId));
    const [existingReq, existingLink, existingTip] = await Promise.all([
      PaymentRequest.findOne({ paidTxid: cleanTxid, ...(isObjId ? { _id: { $ne: excludeId } } : {}) }).lean(),
      PaymentLink.findOne({ paidTxid: cleanTxid, ...(excludeId ? { slug: { $ne: excludeId } } : {}) }).lean(),
      Tip.findOne({ $or: [{ claimTxid: cleanTxid }, { fundingTxid: cleanTxid }], ...(isObjId ? { _id: { $ne: excludeId } } : {}) }).lean(),
    ]);

    if (existingReq || existingLink || existingTip) {
      return true;
    }
  } catch (e) {
    if (IS_PRODUCTION) {
      throw new Error("DATABASE_UNAVAILABLE: Cannot verify transaction uniqueness.");
    }
  }

  return false;
}

export const dbService = {
  // --- TIPS ---
  async getTips(username?: string, userId?: string, includeUnfunded = false) {
    try {
      await connectToDatabase();
      const filter: any = {};
      if (!includeUnfunded) {
        filter.status = { $in: ["FUNDED", "CLAIMING", "CLAIMED", "PENDING_VERIFICATION"] };
      }
      if (userId || username) {
        filter.$or = [
          ...(userId ? [{ senderUserId: userId }] : []),
          ...(username ? [
            { recipientUsernameSnapshot: username.replace("@", "") },
            { senderUsernameSnapshot: username.replace("@", "") },
          ] : []),
        ];
      }
      const tips = await Tip.find(filter).sort({ createdAt: -1 }).limit(50).lean();
      return tips || [];
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving tips.");
      }
    }

    if (IS_PRODUCTION) {
      return [];
    }

    // In-memory development fallback (only reached if MongoDB is unreachable)
    const validStatuses = new Set(["FUNDED", "CLAIMING", "CLAIMED", "PENDING_VERIFICATION"]);
    if (username) {
      const clean = username.replace("@", "");
      return memoryStore.tips.filter(
        (t) =>
          (includeUnfunded || validStatuses.has(t.status)) &&
          (t.recipientUsernameSnapshot === clean || t.senderUsernameSnapshot === clean)
      );
    }
    return includeUnfunded ? memoryStore.tips : memoryStore.tips.filter((t) => validStatuses.has(t.status));
  },

  async confirmTipFunding(tipId: string, fundingTxid: string, blockHeight?: number) {
    if (!fundingTxid || !fundingTxid.trim()) {
      throw new Error("TRANSACTION_HASH_REQUIRED: A valid on-chain transaction hash is required.");
    }
    const cleanTxid = fundingTxid.trim();

    // 1. Fetch tip to check state and expected params
    const tip = await this.getTipById(tipId);
    if (!tip) {
      throw new Error("TIP_NOT_FOUND: Could not locate tip record to confirm funding.");
    }
    if (tip.status === "FUNDED") {
      if (tip.fundingTxid === cleanTxid) return tip; // Idempotent
      throw new Error("TIP_ALREADY_FUNDED: This tip has already been funded with another transaction.");
    }
    if (tip.status !== "CREATED" && tip.status !== "FUNDING_DETECTED") {
      throw new Error(`TIP_CANNOT_BE_FUNDED: Tip status is '${tip.status}' and cannot be transitioned to FUNDED.`);
    }

    // 2. Uniqueness check: reject if txid was already used for another tip or invoice
    const alreadyUsed = await isTxidAlreadyUsed(cleanTxid, tipId);
    if (alreadyUsed) {
      throw new Error("DUPLICATE_TXID_REUSE: This transaction ID has already been used for settlement.");
    }

    // 3. Server-side payment verification (allow 0-conf mempool detection)
    const verification = await zallet.verifyPaymentTransaction({
      txid: cleanTxid,
      expectedAddress: tip.escrowAddress,
      expectedAmountZec: tip.amountZec,
      minConfirmations: 0,
    });

    if (!verification.verified) {
      throw new Error(`PAYMENT_VERIFICATION_FAILED: ${verification.reason || "Transaction could not be verified on-chain."}`);
    }

    const isMempool = verification.confirmations === 0 || verification.detectedInMempool === true;
    const targetStatus = isMempool ? "FUNDING_DETECTED" : "FUNDED";

    const finalizedAmountZec = (verification.actualAmountZec && verification.actualAmountZec > 0)
      ? Math.min(tip.amountZec, verification.actualAmountZec)
      : tip.amountZec;

    // 4. Update status to FUNDED (if confirmed) or FUNDING_DETECTED (if in mempool)
    try {
      await connectToDatabase();
      const updated = await Tip.findByIdAndUpdate(
        tipId,
        {
          $set: {
            status: targetStatus,
            amountZec: finalizedAmountZec,
            amountZats: Math.round(finalizedAmountZec * 100000000),
            fundingTxid: cleanTxid,
            fundingBlockHeight: blockHeight || verification.blockHeight,
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (updated) {
        memoryStore.usedTxids.add(cleanTxid);
        return updated;
      }
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database error while confirming tip funding.");
      }
    }

    if (IS_PRODUCTION) {
      throw new Error("DATABASE_ERROR: Could not confirm tip funding in primary database.");
    }

    const inMem = memoryStore.tips.find((t) => t._id === tipId || t.id === tipId);
    if (inMem) {
      inMem.status = targetStatus;
      inMem.amountZec = finalizedAmountZec;
      inMem.amountZats = Math.round(finalizedAmountZec * 100000000);
      inMem.fundingTxid = cleanTxid;
      inMem.fundingBlockHeight = blockHeight || verification.blockHeight;
      inMem.updatedAt = new Date();
      memoryStore.usedTxids.add(cleanTxid);
      return inMem;
    }

    throw new Error("TIP_NOT_FOUND: Could not locate tip record to confirm funding.");
  },

  async getTipById(tipId: string) {
    try {
      await connectToDatabase();
      const tip = await Tip.findById(tipId).lean();
      if (tip) return tip;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving tip.");
      }
    }

    if (IS_PRODUCTION) return null;
    return memoryStore.tips.find((t) => t._id === tipId || t.id === tipId) || null;
  },

  async createTip(params: {
    senderUserId?: string;
    senderUsername?: string;
    recipientXUserId: string;
    recipientUsername: string;
    amountZec: number;
    isAnonymous?: boolean;
    memo?: string;
  }) {
    const escrow = await zallet.getNewEscrowAddress();
    const amountZats = Math.round(params.amountZec * 100000000);

    const tipPayload = {
      senderUserId: params.senderUserId,
      senderUsernameSnapshot: params.senderUsername,
      recipientXUserId: params.recipientXUserId,
      recipientUsernameSnapshot: params.recipientUsername.replace("@", ""),
      amountZats,
      amountZec: params.amountZec,
      isAnonymous: params.isAnonymous ?? true,
      memo: params.memo,
      escrowAddress: escrow.unifiedAddress,
      diversifierIndex: escrow.diversifierIndex,
      status: "CREATED" as const,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await connectToDatabase();
      const created = await Tip.create(tipPayload);
      return created.toObject();
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error: failed to persist tip record.");
      }

      // Store in memory fallback (dev only)
      const inMemTip = {
        _id: `tip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        id: `tip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...tipPayload,
      };
      memoryStore.tips.unshift(inMemTip);
      return inMemTip;
    }
  },

  /**
   * Concurrency-safe durable tip claim flow with Crash-Safe intermediate states
   * Enforces:
   * 1. Claimant owns the tip's recipientXUserId
   * 2. Tip status is strictly FUNDED
   * 3. Atomically sets status to CLAIMING to prevent duplicate concurrent payouts
   * 4. Dispatches payout to Zcash node (handling async opid or direct txid)
   * 5. If outcome is uncertain or fails unexpectedly: enters PENDING_VERIFICATION (never blindly resetting to FUNDED)
   * 6. If payout succeeds: finalizes status to CLAIMED with claimTxid
   */
  async claimTip(params: {
    tipId: string;
    recipientShieldedAddress: string;
    claimantXUserId: string;
    claimantUsername?: string;
  }) {
    const { tipId, recipientShieldedAddress, claimantXUserId } = params;

    if (!validateZcashAddress(recipientShieldedAddress)) {
      throw new Error("INVALID_RECIPIENT_ADDRESS: Provided address is not a valid Zcash shielded or transparent address.");
    }

    // Verify emergency circuit breaker before any state mutation or locking
    checkPayoutCircuitBreaker();

    const MINING_FEE_ZEC = 0.0001;
    const singleLockId = "lock_" + crypto.randomUUID();
    let isMongo = false;
    let tipDoc: any = null;

    try {
      await connectToDatabase();
      isMongo = true;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_UNAVAILABLE: Cannot process financial claim while database is offline.");
      }
    }

    if (isMongo) {
      const tip = await Tip.findById(tipId);
      if (!tip) {
        throw new Error("TIP_NOT_FOUND: The requested tip does not exist.");
      }

      const claimantHandle = (params.claimantUsername || "").replace("@", "").toLowerCase();
      const isIdMatch = tip.recipientXUserId === claimantXUserId;
      const isHandleMatch = claimantHandle && (
        tip.recipientXUserId.toLowerCase() === claimantHandle ||
        (tip.recipientUsernameSnapshot && tip.recipientUsernameSnapshot.toLowerCase() === claimantHandle)
      );

      if (!isIdMatch && !isHandleMatch) {
        throw new Error("UNAUTHORIZED_CLAIMANT: Authenticated 𝕏 user does not match the tip recipient.");
      }

      if (tip.status === "CLAIMED") {
        throw new Error("TIP_ALREADY_CLAIMED: This tip has already been claimed and paid out.");
      }

      if (tip.status === "EXPIRED" || (tip.expiresAt && Date.now() > new Date(tip.expiresAt).getTime())) {
        throw new Error("TIP_EXPIRED: The 30-day claim window for this tip has expired. Unclaimed funds cannot be claimed.");
      }

      if (tip.status === "CLAIMING" || tip.status === "PENDING_VERIFICATION") {
        throw new Error("TIP_CLAIM_IN_PROGRESS: A claim for this tip is currently being processed or pending verification.");
      }

      if (tip.status !== "FUNDED") {
        throw new Error(`TIP_NOT_FUNDED: Tip cannot be claimed because its current status is '${tip.status}'.`);
      }

      if (tip.fundingTxid && tip.fundingTxid.startsWith("sim_tx_")) {
        if (IS_PRODUCTION || process.env.NEXT_PUBLIC_ZCASH_NETWORK === "mainnet") {
          throw new Error("CANNOT_CLAIM_SIMULATED_TIP: Simulated test tips cannot be claimed for real funds on Mainnet.");
        }
      }

      if (tip.amountZec <= MINING_FEE_ZEC) {
        throw new Error(`AMOUNT_TOO_SMALL: Tip amount (${tip.amountZec} ZEC) must exceed the mining fee of ${MINING_FEE_ZEC} ZEC.`);
      }

      // Atomic Lock: transition status from FUNDED -> CLAIMING with claimLockId
      const lockedTip = await Tip.findOneAndUpdate(
        { _id: tipId, status: "FUNDED" },
        { $set: { status: "CLAIMING", claimLockId: singleLockId, recipientXUserId: claimantXUserId, payoutSubmittedAt: new Date() } },
        { new: true }
      );

      if (!lockedTip) {
        throw new Error("CONCURRENT_CLAIM_PREVENTED: Tip state changed during claim initialization.");
      }

      tipDoc = lockedTip;
    } else {
      const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
      if (inMemIndex === -1) {
        throw new Error("TIP_NOT_FOUND: The requested tip does not exist.");
      }

      const inMemTip = memoryStore.tips[inMemIndex];
      const claimantHandle = (params.claimantUsername || "").replace("@", "").toLowerCase();
      const isIdMatch = inMemTip.recipientXUserId === claimantXUserId;
      const isHandleMatch = claimantHandle && (
        inMemTip.recipientXUserId.toLowerCase() === claimantHandle ||
        (inMemTip.recipientUsernameSnapshot && inMemTip.recipientUsernameSnapshot.toLowerCase() === claimantHandle)
      );

      if (!isIdMatch && !isHandleMatch) {
        throw new Error("UNAUTHORIZED_CLAIMANT: Authenticated 𝕏 user does not match the tip recipient.");
      }

      if (inMemTip.status === "CLAIMED") {
        throw new Error("TIP_ALREADY_CLAIMED: This tip has already been claimed.");
      }

      if (inMemTip.status === "EXPIRED" || (inMemTip.expiresAt && Date.now() > new Date(inMemTip.expiresAt).getTime())) {
        throw new Error("TIP_EXPIRED: The 30-day claim window for this tip has expired. Unclaimed funds cannot be claimed.");
      }

      if (inMemTip.status === "CLAIMING" || inMemTip.status === "PENDING_VERIFICATION") {
        throw new Error("TIP_CLAIM_IN_PROGRESS: A claim for this tip is currently being processed or pending verification.");
      }

      if (inMemTip.status !== "FUNDED") {
        throw new Error(`TIP_NOT_FUNDED: Tip cannot be claimed because its current status is '${inMemTip.status}'.`);
      }

      if (inMemTip.amountZec <= MINING_FEE_ZEC) {
        throw new Error(`AMOUNT_TOO_SMALL: Tip amount (${inMemTip.amountZec} ZEC) must exceed the mining fee of ${MINING_FEE_ZEC} ZEC.`);
      }

      inMemTip.status = "CLAIMING";
      inMemTip.claimLockId = singleLockId;
      inMemTip.recipientXUserId = claimantXUserId;
      inMemTip.payoutSubmittedAt = new Date();
      tipDoc = inMemTip;
    }

    const netPayoutZec = Math.round((tipDoc.amountZec - MINING_FEE_ZEC) * 100000000) / 100000000;

    // Dispatch Shielded Payout
    try {
      const payoutResult = await zallet.sendShieldedPayout(
        recipientShieldedAddress,
        netPayoutZec,
        tipDoc.memo || "VeilX Shielded Claim"
      );

      if (payoutResult.isAsync && payoutResult.opid) {
        // Asynchronous operation on node: transition to PENDING_VERIFICATION with durable opid
        if (isMongo) {
          await Tip.findByIdAndUpdate(tipId, {
            $set: {
              status: "PENDING_VERIFICATION",
              payoutOpid: payoutResult.opid,
              recipientShieldedAddress,
            },
          });
        } else {
          const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
          memoryStore.tips[inMemIndex].status = "PENDING_VERIFICATION";
          memoryStore.tips[inMemIndex].payoutOpid = payoutResult.opid;
          memoryStore.tips[inMemIndex].recipientShieldedAddress = recipientShieldedAddress;
        }

        return {
          success: true,
          status: "PENDING_VERIFICATION",
          payoutOpid: payoutResult.opid,
          message: "Payout submitted to Zcash node and is pending verification.",
        };
      }

      const payoutTxid = payoutResult.txid!;

      // Finalize State to CLAIMED
      if (isMongo) {
        const finalized = await Tip.findByIdAndUpdate(
          tipId,
          {
            $set: {
              status: "CLAIMED",
              recipientShieldedAddress,
              claimTxid: payoutTxid,
              claimedAt: new Date(),
            },
          },
          { new: true }
        ).lean();

        memoryStore.usedTxids.add(payoutTxid);
        return { success: true, tip: finalized, claimTxid: payoutTxid };
      } else {
        const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
        memoryStore.tips[inMemIndex].status = "CLAIMED";
        memoryStore.tips[inMemIndex].recipientShieldedAddress = recipientShieldedAddress;
        memoryStore.tips[inMemIndex].claimTxid = payoutTxid;
        memoryStore.tips[inMemIndex].claimedAt = new Date();
        memoryStore.usedTxids.add(payoutTxid);

        return { success: true, tip: memoryStore.tips[inMemIndex], claimTxid: payoutTxid };
      }
    } catch (payoutError: any) {
      // Safe Handling on Payout Error:
      // Mark as PENDING_VERIFICATION with error message to prevent blind double-payouts
      if (isMongo) {
        await Tip.findByIdAndUpdate(tipId, {
          $set: {
            status: "PENDING_VERIFICATION",
            payoutError: payoutError.message || "Payout dispatch error",
          },
        });
      } else {
        const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
        if (inMemIndex !== -1) {
          memoryStore.tips[inMemIndex].status = "PENDING_VERIFICATION";
          memoryStore.tips[inMemIndex].payoutError = payoutError.message || "Payout dispatch error";
        }
      }

      throw new Error(`PAYOUT_DISPATCH_UNCERTAIN: ${payoutError.message || "Transaction outcome is uncertain. Tip marked PENDING_VERIFICATION for safety."}`);
    }
  },

  /**
   * Concurrency-safe durable batch claim for all funded tips of a creator.
   * Dispatches a single shielded payout to recipientShieldedAddress for sum(amountZec) - 0.0001 miner fee,
   * and updates all tips atomically to CLAIMED referencing the same claimTxid.
   */
  async claimAllTips(params: {
    claimantXUserId: string;
    recipientShieldedAddress: string;
    claimantUsername?: string;
  }) {
    const { claimantXUserId, recipientShieldedAddress } = params;

    // Verify circuit breaker before any operations
    checkPayoutCircuitBreaker();

    if (!validateZcashAddress(recipientShieldedAddress)) {
      throw new Error("INVALID_RECIPIENT_ADDRESS: Provided address is not a valid Zcash shielded or transparent address.");
    }

    let isMongo = false;
    try {
      await connectToDatabase();
      isMongo = true;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_UNAVAILABLE: Cannot process financial claim while database is offline.");
      }
    }

    const claimantHandle = (params.claimantUsername || "").replace("@", "").toLowerCase();
    const now = new Date();
    let targetTips: any[] = [];

    // 1. Find all eligible, non-expired FUNDED tips for this claimant (matching xUserId or handle)
    if (isMongo) {
      const recipientConditions: any[] = [{ recipientXUserId: claimantXUserId }];
      if (claimantHandle) {
        const escapedHandle = claimantHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        recipientConditions.push({ recipientXUserId: claimantHandle });
        recipientConditions.push({ recipientUsernameSnapshot: new RegExp(`^${escapedHandle}$`, "i") });
      }

      const tipFilter: any = {
        $or: recipientConditions,
        status: "FUNDED",
        $and: [
          { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
        ],
      };

      if (IS_PRODUCTION || process.env.NEXT_PUBLIC_ZCASH_NETWORK === "mainnet") {
        tipFilter.fundingTxid = { $not: /^sim_tx_/ };
      }

      targetTips = await Tip.find(tipFilter).lean();
    } else {
      targetTips = memoryStore.tips.filter((t) => {
        const isMatch =
          t.recipientXUserId === claimantXUserId ||
          (claimantHandle && (
            t.recipientXUserId.toLowerCase() === claimantHandle ||
            (t.recipientUsernameSnapshot && t.recipientUsernameSnapshot.toLowerCase() === claimantHandle)
          ));
        const notSimulated =
          !(IS_PRODUCTION || process.env.NEXT_PUBLIC_ZCASH_NETWORK === "mainnet") ||
          !t.fundingTxid?.startsWith("sim_tx_");
        return isMatch && t.status === "FUNDED" && notSimulated && (!t.expiresAt || new Date(t.expiresAt) > now);
      });
    }

    if (!targetTips.length) {
      throw new Error("NO_CLAIMABLE_TIPS: You do not have any pending funded tips to claim.");
    }

    const tipIds = targetTips.map((t) => t._id || t.id);
    const batchLockId = "lock_" + crypto.randomUUID();

    // 2. Atomic Lock: Transition all target tips to CLAIMING tagged with unique batchLockId
    let lockedTipIds: (string | any)[] = [];
    if (isMongo) {
      const lockRes = await Tip.updateMany(
        { _id: { $in: tipIds }, status: "FUNDED" },
        { $set: { status: "CLAIMING", claimLockId: batchLockId, recipientXUserId: claimantXUserId, payoutSubmittedAt: new Date() } }
      );
      if (lockRes.modifiedCount === 0) {
        throw new Error("NO_CLAIMABLE_TIPS: Tips were claimed or locked concurrently.");
      }
      // Re-fetch only the tips successfully locked with our specific batchLockId
      const lockedDocs = await Tip.find({ _id: { $in: tipIds }, claimLockId: batchLockId, status: "CLAIMING" }).lean();
      targetTips = lockedDocs;
      lockedTipIds = lockedDocs.map((t) => t._id);
    } else {
      memoryStore.tips.forEach((t) => {
        if (tipIds.includes(t._id || t.id) && t.status === "FUNDED") {
          t.status = "CLAIMING";
          t.claimLockId = batchLockId;
          t.recipientXUserId = claimantXUserId;
          t.payoutSubmittedAt = new Date();
          lockedTipIds.push(t._id || t.id);
        }
      });
      if (lockedTipIds.length === 0) {
        throw new Error("NO_CLAIMABLE_TIPS: Tips were claimed or locked concurrently.");
      }
      targetTips = memoryStore.tips.filter((t) => lockedTipIds.includes(t._id || t.id));
    }

    const totalZec = targetTips.reduce((sum, t) => sum + (t.amountZec || 0), 0);
    const MINING_FEE_ZEC = 0.0001;
    if (totalZec <= MINING_FEE_ZEC) {
      throw new Error(`AMOUNT_TOO_SMALL: Total tips amount (${totalZec} ZEC) must exceed the batch mining fee of ${MINING_FEE_ZEC} ZEC.`);
    }

    // Option A: Single 0.0001 ZEC mining fee deducted across the aggregate bundle
    const netBatchTotalZec = Math.round((totalZec - MINING_FEE_ZEC) * 100000000) / 100000000;

    // 3. Dispatch Single Shielded Payout from Escrow Pool
    try {
      const memo = `VeilX Shielded Batch Claim (${targetTips.length} tips)`;
      const payoutResult = await zallet.sendShieldedPayout(
        recipientShieldedAddress,
        netBatchTotalZec,
        memo
      );

      if (payoutResult.isAsync && payoutResult.opid) {
        if (isMongo) {
          await Tip.updateMany(
            { _id: { $in: lockedTipIds } },
            {
              $set: {
                status: "PENDING_VERIFICATION",
                payoutOpid: payoutResult.opid,
                recipientShieldedAddress,
              },
            }
          );
        } else {
          memoryStore.tips.forEach((t) => {
            if (lockedTipIds.includes(t._id || t.id)) {
              t.status = "PENDING_VERIFICATION";
              t.payoutOpid = payoutResult.opid;
              t.recipientShieldedAddress = recipientShieldedAddress;
            }
          });
        }

        return {
          success: true,
          status: "PENDING_VERIFICATION",
          count: targetTips.length,
          totalAmountZec: netBatchTotalZec,
          payoutOpid: payoutResult.opid,
          message: "Batch payout submitted to Zcash node and is pending verification.",
        };
      }

      const payoutTxid = payoutResult.txid!;

      // 4. Finalize all tips to CLAIMED
      if (isMongo) {
        await Tip.updateMany(
          { _id: { $in: lockedTipIds } },
          {
            $set: {
              status: "CLAIMED",
              recipientShieldedAddress,
              claimTxid: payoutTxid,
              claimedAt: new Date(),
            },
          }
        );
        memoryStore.usedTxids.add(payoutTxid);
        const updatedTips = await Tip.find({ _id: { $in: lockedTipIds } }).lean();
        return {
          success: true,
          count: targetTips.length,
          totalAmountZec: netBatchTotalZec,
          claimTxid: payoutTxid,
          tips: updatedTips,
        };
      } else {
        memoryStore.tips.forEach((t) => {
          if (lockedTipIds.includes(t._id || t.id)) {
            t.status = "CLAIMED";
            t.recipientShieldedAddress = recipientShieldedAddress;
            t.claimTxid = payoutTxid;
            t.claimedAt = new Date();
          }
        });
        memoryStore.usedTxids.add(payoutTxid);
        const updatedTips = memoryStore.tips.filter((t) => lockedTipIds.includes(t._id || t.id));
        return {
          success: true,
          count: targetTips.length,
          totalAmountZec: netBatchTotalZec,
          claimTxid: payoutTxid,
          tips: updatedTips,
        };
      }
    } catch (payoutError: any) {
      if (isMongo) {
        await Tip.updateMany(
          { _id: { $in: lockedTipIds } },
          {
            $set: {
              status: "PENDING_VERIFICATION",
              payoutError: payoutError.message || "Batch payout dispatch error",
            },
          }
        );
      } else {
        memoryStore.tips.forEach((t) => {
          if (lockedTipIds.includes(t._id || t.id)) {
            t.status = "PENDING_VERIFICATION";
            t.payoutError = payoutError.message || "Batch payout dispatch error";
          }
        });
      }

      throw new Error(`BATCH_PAYOUT_UNCERTAIN: ${payoutError.message || "Batch payout outcome is uncertain. Tips marked PENDING_VERIFICATION for safety."}`);
    }
  },

  /**
   * Reconciles a tip in CLAIMING or PENDING_VERIFICATION state
   */
  async reconcileTipClaim(tipId: string) {
    const tip = await this.getTipById(tipId);
    if (!tip) throw new Error("TIP_NOT_FOUND");
    if (tip.status !== "CLAIMING" && tip.status !== "PENDING_VERIFICATION") {
      return { status: tip.status, tip };
    }

    let isMongo = false;
    try {
      await connectToDatabase();
      isMongo = true;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_UNAVAILABLE");
      }
    }

    if (tip.payoutOpid) {
      const opStatus = await zallet.pollOperationStatus(tip.payoutOpid, 1, 0);
      if (opStatus.status === "success" && opStatus.txid) {
        // Success: finalize to CLAIMED
        if (isMongo) {
          const updated = await Tip.findByIdAndUpdate(
            tipId,
            { $set: { status: "CLAIMED", claimTxid: opStatus.txid, claimedAt: new Date() } },
            { new: true }
          ).lean();
          return { status: "CLAIMED", claimTxid: opStatus.txid, tip: updated };
        } else {
          const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
          if (inMemIndex !== -1) {
            memoryStore.tips[inMemIndex].status = "CLAIMED";
            memoryStore.tips[inMemIndex].claimTxid = opStatus.txid;
            memoryStore.tips[inMemIndex].claimedAt = new Date();
            return { status: "CLAIMED", claimTxid: opStatus.txid, tip: memoryStore.tips[inMemIndex] };
          }
        }
      }

      if (opStatus.status === "failed") {
        // Definitively failed: safe to transition back to FUNDED
        if (isMongo) {
          const updated = await Tip.findByIdAndUpdate(
            tipId,
            { $set: { status: "FUNDED", claimLockId: undefined, payoutError: opStatus.error, payoutOpid: undefined } },
            { new: true }
          ).lean();
          return { status: "FUNDED", error: opStatus.error, tip: updated };
        } else {
          const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
          if (inMemIndex !== -1) {
            memoryStore.tips[inMemIndex].status = "FUNDED";
            memoryStore.tips[inMemIndex].claimLockId = undefined;
            memoryStore.tips[inMemIndex].payoutError = opStatus.error;
            memoryStore.tips[inMemIndex].payoutOpid = undefined;
            return { status: "FUNDED", error: opStatus.error, tip: memoryStore.tips[inMemIndex] };
          }
        }
      }
    } else {
      // If no payoutOpid was recorded yet, check if claim is still in-flight within proof generation grace period (5 mins)
      const CLAIM_GRACE_PERIOD_MS = 5 * 60 * 1000;
      const lockedAt = tip.payoutSubmittedAt
        ? new Date(tip.payoutSubmittedAt).getTime()
        : (tip.updatedAt ? new Date(tip.updatedAt).getTime() : 0);
      const isStale = (Date.now() - lockedAt) > CLAIM_GRACE_PERIOD_MS;

      if (!isStale) {
        return { status: tip.status, message: "Claim still in-flight within proof generation grace period", tip };
      }

      // Truly stale/interrupted before dispatch - roll back to FUNDED
      if (isMongo) {
        const updated = await Tip.findByIdAndUpdate(
          tipId,
          { $set: { status: "FUNDED", claimLockId: undefined, payoutError: "Interrupted before dispatch (timed out)" } },
          { new: true }
        ).lean();
        return { status: "FUNDED", message: "Rolled back to FUNDED due to missing opid after grace period", tip: updated };
      } else {
        const inMemIndex = memoryStore.tips.findIndex((t) => t._id === tipId || t.id === tipId);
        if (inMemIndex !== -1) {
          memoryStore.tips[inMemIndex].status = "FUNDED";
          memoryStore.tips[inMemIndex].claimLockId = undefined;
          memoryStore.tips[inMemIndex].payoutError = "Interrupted before dispatch (timed out)";
          return { status: "FUNDED", message: "Rolled back to FUNDED due to missing opid after grace period", tip: memoryStore.tips[inMemIndex] };
        }
      }
    }

    return { status: tip.status, message: "Reconciliation still pending", tip };
  },

  /**
   * Scans and reconciles all pending tip payouts across the system
   */
  async reconcilePendingTips() {
    let pendingTips: any[] = [];
    let isMongo = false;
    try {
      await connectToDatabase();
      isMongo = true;
      pendingTips = await Tip.find({
        status: { $in: ["CLAIMING", "PENDING_VERIFICATION"] },
      }).limit(50).lean();
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_UNAVAILABLE: Cannot query pending tips for reconciliation.");
      }
    }

    if (!isMongo) {
      pendingTips = memoryStore.tips.filter(
        (t) => t.status === "CLAIMING" || t.status === "PENDING_VERIFICATION"
      );
    }

    const results = [];
    for (const tip of pendingTips) {
      const id = (tip._id || tip.id).toString();
      try {
        const res = await this.reconcileTipClaim(id);
        results.push({ tipId: id, ...res });
      } catch (err: any) {
        results.push({ tipId: id, status: tip.status, error: err.message });
      }
    }
    return results;
  },

  // --- PAYMENT REQUESTS ---
  async getRequests(username?: string) {
    try {
      await connectToDatabase();
      const filter: any = {};
      if (username) {
        filter.$or = [
          { requesterUsernameSnapshot: username.replace("@", "") },
          { targetUsernameSnapshot: username.replace("@", "") },
        ];
      }
      const requests = await PaymentRequest.find(filter).sort({ createdAt: -1 }).limit(50).lean();
      return requests || [];
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving payment requests.");
      }
    }
    return IS_PRODUCTION ? [] : memoryStore.requests;
  },

  async getRequestById(id: string) {
    try {
      await connectToDatabase();
      const req = await PaymentRequest.findById(id).lean();
      if (req) return req;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving request.");
      }
    }

    if (IS_PRODUCTION) return null;
    return memoryStore.requests.find((r) => r._id === id || r.id === id) || null;
  },

  async createRequest(params: {
    requesterUserId?: string;
    requesterUsername: string;
    targetXUserId?: string;
    targetUsername: string;
    amountZec: number;
    memo?: string;
    recipientShieldedUa: string;
  }) {
    if (typeof params.amountZec !== "number" || isNaN(params.amountZec) || !isFinite(params.amountZec) || params.amountZec <= 0.0001) {
      throw new Error("INVALID_AMOUNT: Amount must be a positive number greater than the 0.0001 ZEC network miner fee.");
    }

    if (!validateZcashAddress(params.recipientShieldedUa)) {
      throw new Error("INVALID_RECIPIENT_ADDRESS: Destination address is not a valid Zcash address.");
    }

    const escrow = await zallet.getNewEscrowAddress();

    const payload = {
      requesterUserId: params.requesterUserId,
      requesterUsernameSnapshot: params.requesterUsername.replace("@", ""),
      targetXUserId: params.targetXUserId || `mock_${params.targetUsername.replace("@", "")}`,
      targetUsernameSnapshot: params.targetUsername.replace("@", ""),
      amountZec: params.amountZec,
      memo: params.memo,
      recipientShieldedUa: params.recipientShieldedUa,
      escrowDepositAddress: escrow.unifiedAddress,
      diversifierIndex: escrow.diversifierIndex,
      status: "PENDING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await connectToDatabase();
      const created = await PaymentRequest.create(payload);
      return created.toObject();
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error: failed to persist payment request.");
      }
      const inMem = {
        _id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...payload,
      };
      memoryStore.requests.unshift(inMem);
      return inMem;
    }
  },

  /**
   * Settles a payment request after verifying on-chain evidence and uniqueness
   */
  async settleRequest(params: { id: string; paidTxid: string; payerUsername?: string }) {
    const { id, paidTxid } = params;
    const cleanTxid = paidTxid?.trim();

    if (!cleanTxid) {
      throw new Error("INVALID_TXID: A valid transaction hash is required to settle payment.");
    }

    // 1. Get request to check expected parameters
    const request = await this.getRequestById(id);
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status === "FULFILLED" || request.forwardTxid) return request; // Idempotent
    if (request.status !== "PENDING" && request.status !== "SETTLING") {
      throw new Error(`REQUEST_CANNOT_BE_SETTLED: Current status is '${request.status}'`);
    }

    if (params.payerUsername && request.targetUsernameSnapshot) {
      const cleanPayer = params.payerUsername.replace("@", "").toLowerCase();
      const cleanTarget = request.targetUsernameSnapshot.toLowerCase();
      if (cleanPayer !== cleanTarget) {
        throw new Error("UNAUTHORIZED_SETTLER: Only the designated recipient can settle this payment request.");
      }
    }

    // 2. Uniqueness check: reject if txid was already used for another invoice
    const alreadyUsed = await isTxidAlreadyUsed(cleanTxid, id);
    if (alreadyUsed) {
      throw new Error("DUPLICATE_TXID_REUSE: This transaction ID has already settled another invoice.");
    }

    if (!request.escrowDepositAddress) {
      throw new Error("INVALID_ESCROW_ADDRESS: Payment request does not have an escrow deposit address.");
    }

    // 3. Server-Side On-Chain Verification (allow 0-conf mempool detection)
    const verification = await zallet.verifyPaymentTransaction({
      txid: cleanTxid,
      expectedAddress: request.escrowDepositAddress,
      expectedAmountZec: request.amountZec,
      minConfirmations: 0,
    });

    if (!verification.verified) {
      throw new Error(`PAYMENT_VERIFICATION_FAILED: ${verification.reason || "Transaction could not be verified on-chain."}`);
    }

    const isMempool = verification.confirmations === 0 || verification.detectedInMempool === true;

    // 4. ATOMIC LOCK: Transition status to SETTLING with paidTxid
    let isMongo = false;
    try {
      await connectToDatabase();
      isMongo = true;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error: cannot settle request while database is offline.");
      }
    }

    let lockedRequest: any;
    if (isMongo) {
      lockedRequest = await PaymentRequest.findOneAndUpdate(
        { _id: id, status: { $in: ["PENDING", "SETTLING"] } },
        { $set: { status: "SETTLING", paidTxid: cleanTxid, paidAt: request.paidAt || new Date() } },
        { new: true }
      ).lean();

      if (!lockedRequest) {
        const existing = await PaymentRequest.findById(id).lean();
        if (existing?.status === "FULFILLED" || existing?.status === "FORWARD_PENDING") return existing;
        throw new Error("CONCURRENT_SETTLEMENT_CONFLICT: Request is currently being settled by another worker.");
      }
      memoryStore.usedTxids.add(cleanTxid);
    } else {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_ERROR: Could not settle payment request in primary database.");
      }
      const inMem = memoryStore.requests.find((r) => r._id === id || r.id === id);
      if (!inMem) throw new Error("REQUEST_NOT_FOUND");
      if (inMem.status !== "PENDING" && inMem.status !== "SETTLING") {
        if (inMem.status === "FULFILLED" || inMem.status === "FORWARD_PENDING") return inMem;
        throw new Error("CONCURRENT_SETTLEMENT_CONFLICT");
      }
      inMem.status = "SETTLING";
      inMem.paidTxid = cleanTxid;
      inMem.paidAt = inMem.paidAt || new Date();
      lockedRequest = inMem;
      memoryStore.usedTxids.add(cleanTxid);
    }

    // If transaction has 0 confirmations (in mempool), stop here and return SETTLING status.
    // The client or background worker will finalize to FULFILLED once block 1 is mined!
    if (isMempool) {
      return lockedRequest;
    }

    // 5. Calculate net payout based on min(nominal, actualReceived) to prevent underpayment deficit (HIGH-01)
    const MINING_FEE_ZEC = 0.0001;
    const actualReceived = typeof verification.actualAmountZec === "number"
      ? Math.min(request.amountZec, verification.actualAmountZec)
      : request.amountZec;
    const netPayoutAmount = Math.max(0, Math.round((actualReceived - MINING_FEE_ZEC) * 100000000) / 100000000);

    let finalStatus: "FULFILLED" | "FORWARD_PENDING" = "FULFILLED";
    let forwardTxid: string | undefined;
    let forwardOpid: string | undefined;
    let payoutError: string | undefined;

    if (netPayoutAmount > 0) {
      checkPayoutCircuitBreaker();
      try {
        const forwardResult = await zallet.sendShieldedPayout(
          request.recipientShieldedUa,
          netPayoutAmount,
          request.memo || "VeilX Payment Request Fulfilled"
        );
        if (forwardResult.txid && !forwardResult.opid) {
          forwardTxid = forwardResult.txid;
          finalStatus = "FULFILLED";
        } else if (forwardResult.opid) {
          forwardOpid = forwardResult.opid;
          finalStatus = "FORWARD_PENDING";
        } else if (forwardResult.txid) {
          forwardTxid = forwardResult.txid;
          finalStatus = "FULFILLED";
        }
      } catch (err: any) {
        console.warn(`[Request Forwarder] Payout forwarding deferred to background queue for request ${id}:`, err?.message || err);
        finalStatus = "FORWARD_PENDING";
        payoutError = (err?.message || String(err)).replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
      }
    }

    // 6. Transition to final status (FULFILLED or FORWARD_PENDING)
    if (isMongo) {
      const finalized = await PaymentRequest.findByIdAndUpdate(
        id,
        {
          $set: {
            status: finalStatus,
            forwardTxid,
            forwardOpid,
            payoutError,
          },
        },
        { new: true }
      ).lean();
      memoryStore.usedTxids.add(cleanTxid);
      return finalized;
    } else {
      lockedRequest.status = finalStatus;
      lockedRequest.forwardTxid = forwardTxid;
      lockedRequest.forwardOpid = forwardOpid;
      lockedRequest.payoutError = payoutError;
      memoryStore.usedTxids.add(cleanTxid);
      return lockedRequest;
    }
  },

  // --- PAYMENT LINKS ---
  async getPayLinks(username?: string) {
    try {
      await connectToDatabase();
      const filter: any = {};
      if (username) {
        filter.creatorUsernameSnapshot = username.replace("@", "");
      }
      const links = await PaymentLink.find(filter).sort({ createdAt: -1 }).limit(50).lean();
      return links || [];
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving PayLinks.");
      }
    }
    return IS_PRODUCTION ? [] : memoryStore.paylinks;
  },

  async getPayLinkBySlug(slug: string) {
    try {
      await connectToDatabase();
      const link = await PaymentLink.findOne({ slug }).lean();
      if (link) return link;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error while retrieving PayLink.");
      }
    }
    if (IS_PRODUCTION) return null;
    return memoryStore.paylinks.find((l) => l.slug === slug) || null;
  },

  async createPayLink(params: {
    creatorUserId?: string;
    creatorUsername: string;
    title: string;
    amountZec: number;
    recipientShieldedUa: string;
  }) {
    if (typeof params.amountZec !== "number" || isNaN(params.amountZec) || !isFinite(params.amountZec) || params.amountZec <= 0.0001) {
      throw new Error("INVALID_AMOUNT: Amount must be a positive number greater than the 0.0001 ZEC network miner fee.");
    }

    if (!validateZcashAddress(params.recipientShieldedUa)) {
      throw new Error("INVALID_RECIPIENT_ADDRESS: Destination address is not a valid Zcash address.");
    }

    const escrow = await zallet.getNewEscrowAddress();
    const slug = `inv_${crypto.randomBytes(4).toString("hex")}`;
    const payload = {
      creatorUserId: params.creatorUserId,
      creatorUsernameSnapshot: params.creatorUsername.replace("@", ""),
      slug,
      title: params.title,
      amountZec: params.amountZec,
      recipientShieldedUa: params.recipientShieldedUa,
      escrowDepositAddress: escrow.unifiedAddress,
      diversifierIndex: escrow.diversifierIndex,
      status: "UNPAID" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await connectToDatabase();
      const created = await PaymentLink.create(payload);
      return created.toObject();
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error: failed to persist PayLink.");
      }
      const inMem = {
        _id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...payload,
      };
      memoryStore.paylinks.unshift(inMem);
      return inMem;
    }
  },

  /**
   * Settles a PayLink invoice after verifying on-chain evidence and uniqueness
   */
  async settlePayLink(params: { slug: string; paidTxid: string; payerUsername?: string }) {
    const { slug, paidTxid } = params;
    const cleanTxid = paidTxid?.trim();

    if (!cleanTxid) {
      throw new Error("INVALID_TXID: A valid transaction hash is required to settle invoice.");
    }

    // 1. Get paylink
    const link = await this.getPayLinkBySlug(slug);
    if (!link) throw new Error("PAYLINK_NOT_FOUND");
    if (link.status === "PAID" || link.forwardTxid) return link; // Idempotent
    if (link.status !== "UNPAID" && link.status !== "SETTLING") {
      throw new Error(`PAYLINK_CANNOT_BE_SETTLED: Current status is '${link.status}'`);
    }

    // 2. Uniqueness check: reject if txid was already used for another invoice
    const alreadyUsed = await isTxidAlreadyUsed(cleanTxid, slug);
    if (alreadyUsed) {
      throw new Error("DUPLICATE_TXID_REUSE: This transaction ID has already settled another invoice.");
    }

    if (!link.escrowDepositAddress) {
      throw new Error("INVALID_ESCROW_ADDRESS: Payment link does not have an escrow deposit address.");
    }

    // 3. Server-Side On-Chain Verification (allow 0-conf mempool detection)
    const verification = await zallet.verifyPaymentTransaction({
      txid: cleanTxid,
      expectedAddress: link.escrowDepositAddress,
      expectedAmountZec: link.amountZec,
      minConfirmations: 0,
    });

    if (!verification.verified) {
      throw new Error(`PAYMENT_VERIFICATION_FAILED: ${verification.reason || "Transaction could not be verified on-chain."}`);
    }

    const isMempool = verification.confirmations === 0 || verification.detectedInMempool === true;

    // 4. ATOMIC LOCK: Transition status to SETTLING with paidTxid
    let isMongo = false;
    try {
      await connectToDatabase();
      isMongo = true;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database connection error: cannot settle invoice while database is offline.");
      }
    }

    let lockedLink: any;
    if (isMongo) {
      lockedLink = await PaymentLink.findOneAndUpdate(
        { slug, status: { $in: ["UNPAID", "SETTLING"] } },
        { $set: { status: "SETTLING", paidTxid: cleanTxid, paidAt: link.paidAt || new Date() } },
        { new: true }
      ).lean();

      if (!lockedLink) {
        const existing = await PaymentLink.findOne({ slug }).lean();
        if (existing?.status === "PAID" || existing?.status === "FORWARD_PENDING") return existing;
        throw new Error("CONCURRENT_SETTLEMENT_CONFLICT: PayLink is currently being settled by another worker.");
      }
      memoryStore.usedTxids.add(cleanTxid);
    } else {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_ERROR: Could not settle PayLink invoice in primary database.");
      }
      const inMem = memoryStore.paylinks.find((l) => l.slug === slug);
      if (!inMem) throw new Error("PAYLINK_NOT_FOUND");
      if (inMem.status !== "UNPAID" && inMem.status !== "SETTLING") {
        if (inMem.status === "PAID" || inMem.status === "FORWARD_PENDING") return inMem;
        throw new Error("CONCURRENT_SETTLEMENT_CONFLICT");
      }
      inMem.status = "SETTLING";
      inMem.paidTxid = cleanTxid;
      inMem.paidAt = inMem.paidAt || new Date();
      lockedLink = inMem;
      memoryStore.usedTxids.add(cleanTxid);
    }

    // If transaction has 0 confirmations (in mempool), stop here and return SETTLING status.
    // The client or background worker will finalize to PAID once block 1 is mined!
    if (isMempool) {
      return lockedLink;
    }

    // 5. Calculate net funds from Escrow to creator's personal shielded address (deficit-protected)
    const MINING_FEE_ZEC = 0.0001;
    const actualReceived = typeof verification.actualAmountZec === "number"
      ? Math.min(link.amountZec, verification.actualAmountZec)
      : link.amountZec;
    const netPayoutAmount = Math.max(0, Math.round((actualReceived - MINING_FEE_ZEC) * 100000000) / 100000000);

    let finalStatus: "PAID" | "FORWARD_PENDING" = "PAID";
    let forwardTxid: string | undefined;
    let forwardOpid: string | undefined;
    let payoutError: string | undefined;

    if (netPayoutAmount > 0) {
      checkPayoutCircuitBreaker();
      try {
        const forwardResult = await zallet.sendShieldedPayout(
          link.recipientShieldedUa,
          netPayoutAmount,
          `VeilX Invoice: ${link.title || link.slug}`
        );
        if (forwardResult.txid && !forwardResult.opid) {
          forwardTxid = forwardResult.txid;
          finalStatus = "PAID";
        } else if (forwardResult.opid) {
          forwardOpid = forwardResult.opid;
          finalStatus = "FORWARD_PENDING";
        } else if (forwardResult.txid) {
          forwardTxid = forwardResult.txid;
          finalStatus = "PAID";
        }
      } catch (err: any) {
        console.warn(`[Invoice Forwarder] Payout forwarding deferred to background queue for paylink ${slug}:`, err?.message || err);
        finalStatus = "FORWARD_PENDING";
        payoutError = (err?.message || String(err)).replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
      }
    }

    // 6. Transition to final status (PAID or FORWARD_PENDING)
    if (isMongo) {
      const finalized = await PaymentLink.findOneAndUpdate(
        { slug },
        {
          $set: {
            status: finalStatus,
            forwardTxid,
            forwardOpid,
            payoutError,
          },
        },
        { new: true }
      ).lean();
      memoryStore.usedTxids.add(cleanTxid);
      return finalized;
    } else {
      lockedLink.status = finalStatus;
      lockedLink.forwardTxid = forwardTxid;
      lockedLink.forwardOpid = forwardOpid;
      lockedLink.payoutError = payoutError;
      memoryStore.usedTxids.add(cleanTxid);
      return lockedLink;
    }
  },

  /**
   * Expire tips that have exceeded the 30-day claim period.
   * Under V1 policy:
   * 1. No automatic refund is made.
   * 2. Status transitions atomically from FUNDED -> EXPIRED.
   * 3. Idempotent and concurrency-safe against ongoing claims.
   */
  async expireOldTips(): Promise<{ expiredCount: number }> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    let expiredCount = 0;

    try {
      await connectToDatabase();
      const res = await Tip.updateMany(
        {
          status: "FUNDED",
          $or: [
            { createdAt: { $lte: thirtyDaysAgo } },
            { expiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "EXPIRED",
            expiredAt: now,
            updatedAt: now,
          },
        }
      );
      expiredCount = res.modifiedCount;
      return { expiredCount };
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database error while expiring old tips.");
      }
    }

    memoryStore.tips.forEach((t) => {
      if (t.status === "FUNDED") {
        const isPastExpiry =
          (t.expiresAt && new Date(t.expiresAt) <= now) ||
          (t.createdAt && new Date(t.createdAt) <= thirtyDaysAgo);
        if (isPastExpiry) {
          t.status = "EXPIRED";
          t.expiredAt = now;
          expiredCount++;
        }
      }
    });

    return { expiredCount };
  },

  /**
   * Rejects/cancels a payment request.
   * Enforces that only the target recipient or requester can cancel the request.
   */
  async rejectRequest(params: { id: string; userXUserId?: string; userUsername?: string }) {
    const { id, userXUserId, userUsername } = params;
    const request = await this.getRequestById(id);
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status === "CANCELLED") return request;
    if (request.status !== "PENDING") {
      throw new Error(`REQUEST_CANNOT_BE_REJECTED: Current status is '${request.status}'`);
    }

    const cleanUser = userUsername?.replace("@", "").toLowerCase();
    const cleanTarget = request.targetUsernameSnapshot?.toLowerCase();
    const cleanRequester = request.requesterUsernameSnapshot?.toLowerCase();

    const isAuthorized =
      (userXUserId && (userXUserId === request.targetXUserId || userXUserId === request.requesterUserId?.toString())) ||
      (cleanUser && (cleanUser === cleanTarget || cleanUser === cleanRequester));

    if (!isAuthorized) {
      throw new Error("UNAUTHORIZED: Only the target recipient or requester can reject this payment request.");
    }

    const isTarget =
      (cleanUser && cleanUser === cleanTarget) ||
      (userXUserId && userXUserId === request.targetXUserId);
    const cancelledByRole: "target" | "requester" = isTarget ? "target" : "requester";
    const cancelledByUsername = cleanUser || userUsername || (isTarget ? request.targetUsernameSnapshot : request.requesterUsernameSnapshot);

    try {
      await connectToDatabase();
      const updated = await PaymentRequest.findByIdAndUpdate(
        id,
        {
          $set: {
            status: "CANCELLED",
            cancelledByRole,
            cancelledByUsername,
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();
      if (updated) return updated;
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("Database error while rejecting request.");
      }
    }

    const inMem = memoryStore.requests.find((r) => r._id === id || r.id === id);
    if (inMem) {
      inMem.status = "CANCELLED";
      inMem.cancelledByRole = cancelledByRole;
      inMem.cancelledByUsername = cancelledByUsername;
      inMem.updatedAt = new Date();
      return inMem;
    }
    throw new Error("REQUEST_NOT_FOUND");
  },

  /**
   * Finalizes an invoice forward after on-chain dispatch/verification
   */
  async finalizePayLinkForward(slug: string, forwardTxid: string) {
    try {
      await connectToDatabase();
      const updated = await PaymentLink.findOneAndUpdate(
        { slug },
        {
          $set: {
            status: "PAID",
            forwardTxid,
            forwardOpid: undefined,
            payoutError: undefined,
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();
      if (updated) return updated;
    } catch (e) {
      if (IS_PRODUCTION) throw e;
    }
    const inMem = memoryStore.paylinks.find((l) => l.slug === slug);
    if (inMem) {
      inMem.status = "PAID";
      inMem.forwardTxid = forwardTxid;
      inMem.forwardOpid = undefined;
      inMem.payoutError = undefined;
      return inMem;
    }
    throw new Error("PAYLINK_NOT_FOUND");
  },

  /**
   * Finalizes a payment request forward after on-chain dispatch/verification
   */
  async finalizeRequestForward(id: string, forwardTxid: string) {
    try {
      await connectToDatabase();
      const updated = await PaymentRequest.findByIdAndUpdate(
        id,
        {
          $set: {
            status: "FULFILLED",
            forwardTxid,
            forwardOpid: undefined,
            payoutError: undefined,
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();
      if (updated) return updated;
    } catch (e) {
      if (IS_PRODUCTION) throw e;
    }
    const inMem = memoryStore.requests.find((r) => r._id === id || r.id === id);
    if (inMem) {
      inMem.status = "FULFILLED";
      inMem.forwardTxid = forwardTxid;
      inMem.forwardOpid = undefined;
      inMem.payoutError = undefined;
      return inMem;
    }
    throw new Error("REQUEST_NOT_FOUND");
  },

  /**
   * Manual or background retry for PayLink invoice payout forwarding
   */
  async retryForwardPayLink(slug: string, requestedByUsername?: string) {
    const link = await this.getPayLinkBySlug(slug);
    if (!link) throw new Error("PAYLINK_NOT_FOUND");

    if (requestedByUsername) {
      const cleanUser = requestedByUsername.replace("@", "").toLowerCase();
      const cleanCreator = (link.creatorUsernameSnapshot || "").toLowerCase();
      if (cleanUser !== cleanCreator) {
        throw new Error("UNAUTHORIZED: Only the invoice creator can trigger payout retries.");
      }
    }

    if (link.status === "PAID" && link.forwardTxid) {
      return { success: true, message: "Invoice payout already settled.", forwardTxid: link.forwardTxid, link };
    }

    if (link.status !== "FORWARD_PENDING" && link.status !== "SETTLING") {
      throw new Error(`CANNOT_RETRY_PAYOUT: Invoice status is '${link.status}' (expected 'FORWARD_PENDING').`);
    }

    // 1. If opid is present, poll it first
    if (link.forwardOpid) {
      try {
        const opStatus = await zallet.pollOperationStatus(link.forwardOpid, 1, 0);
        if (opStatus.status === "success" && opStatus.txid) {
          const updated = await this.finalizePayLinkForward(slug, opStatus.txid);
          return { success: true, status: "PAID", forwardTxid: opStatus.txid, link: updated };
        }
      } catch (e) {
        // Continue to fresh attempt if op failed or expired
      }
    }

    // 2. If status is SETTLING, verify that the payer's transaction has at least 1 confirmation
    if (link.status === "SETTLING" && link.paidTxid) {
      const verification = await zallet.verifyPaymentTransaction({
        txid: link.paidTxid,
        expectedAddress: link.escrowDepositAddress,
        expectedAmountZec: link.amountZec,
        minConfirmations: 1,
      });
      if (!verification.verified || (verification.confirmations || 0) < 1) {
        return { success: false, status: "SETTLING", message: "Transaction still in mempool awaiting block confirmation." };
      }
    }

    // 3. Fresh payout attempt
    const MINING_FEE_ZEC = 0.0001;
    const netPayoutAmount = Math.max(0, Math.round((link.amountZec - MINING_FEE_ZEC) * 100000000) / 100000000);
    checkPayoutCircuitBreaker();

    try {
      const forwardResult = await zallet.sendShieldedPayout(
        link.recipientShieldedUa,
        netPayoutAmount,
        `VeilX Invoice: ${link.title || link.slug}`
      );
      if (forwardResult.txid && !forwardResult.opid) {
        const updated = await this.finalizePayLinkForward(slug, forwardResult.txid);
        return { success: true, status: "PAID", forwardTxid: forwardResult.txid, link: updated };
      } else if (forwardResult.opid) {
        await connectToDatabase().catch(() => {});
        await PaymentLink.findOneAndUpdate(
          { slug },
          { $set: { status: "FORWARD_PENDING", forwardOpid: forwardResult.opid, payoutError: undefined } }
        ).catch(() => {});
        return { success: true, status: "FORWARD_PENDING", forwardOpid: forwardResult.opid, link };
      } else if (forwardResult.txid) {
        const updated = await this.finalizePayLinkForward(slug, forwardResult.txid);
        return { success: true, status: "PAID", forwardTxid: forwardResult.txid, link: updated };
      }
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      const errMsg = rawMsg.replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
      await connectToDatabase().catch(() => {});
      await PaymentLink.findOneAndUpdate(
        { slug },
        { $set: { status: "FORWARD_PENDING", payoutError: errMsg, updatedAt: new Date() } }
      ).catch(() => {});
      throw new Error(`PAYOUT_RETRY_FAILED: ${errMsg}`);
    }
  },

  /**
   * Manual or background retry for direct payment request payout forwarding
   */
  async retryForwardRequest(id: string, requestedByUsername?: string) {
    const request = await this.getRequestById(id);
    if (!request) throw new Error("REQUEST_NOT_FOUND");

    if (requestedByUsername) {
      const cleanUser = requestedByUsername.replace("@", "").toLowerCase();
      const cleanRequester = (request.requesterUsernameSnapshot || "").toLowerCase();
      if (cleanUser !== cleanRequester) {
        throw new Error("UNAUTHORIZED: Only the request creator can trigger payout retries.");
      }
    }

    if (request.status === "FULFILLED" && request.forwardTxid) {
      return { success: true, message: "Payment request payout already settled.", forwardTxid: request.forwardTxid, request };
    }

    if (request.status !== "FORWARD_PENDING" && request.status !== "SETTLING") {
      throw new Error(`CANNOT_RETRY_PAYOUT: Request status is '${request.status}' (expected 'FORWARD_PENDING').`);
    }

    // 1. If opid is present, poll it first
    if (request.forwardOpid) {
      try {
        const opStatus = await zallet.pollOperationStatus(request.forwardOpid, 1, 0);
        if (opStatus.status === "success" && opStatus.txid) {
          const updated = await this.finalizeRequestForward(id, opStatus.txid);
          return { success: true, status: "FULFILLED", forwardTxid: opStatus.txid, request: updated };
        }
      } catch (e) {
        // Continue to fresh attempt
      }
    }

    // 2. If status is SETTLING, verify that the payer's transaction has at least 1 confirmation
    if (request.status === "SETTLING" && request.paidTxid) {
      const verification = await zallet.verifyPaymentTransaction({
        txid: request.paidTxid,
        expectedAddress: request.escrowDepositAddress,
        expectedAmountZec: request.amountZec,
        minConfirmations: 1,
      });
      if (!verification.verified || (verification.confirmations || 0) < 1) {
        return { success: false, status: "SETTLING", message: "Transaction still in mempool awaiting block confirmation." };
      }
    }

    // 3. Fresh payout attempt
    const MINING_FEE_ZEC = 0.0001;
    const netPayoutAmount = Math.max(0, Math.round((request.amountZec - MINING_FEE_ZEC) * 100000000) / 100000000);
    checkPayoutCircuitBreaker();

    try {
      const forwardResult = await zallet.sendShieldedPayout(
        request.recipientShieldedUa,
        netPayoutAmount,
        request.memo || "VeilX Payment Request Fulfilled"
      );
      if (forwardResult.txid && !forwardResult.opid) {
        const updated = await this.finalizeRequestForward(id, forwardResult.txid);
        return { success: true, status: "FULFILLED", forwardTxid: forwardResult.txid, request: updated };
      } else if (forwardResult.opid) {
        await connectToDatabase().catch(() => {});
        await PaymentRequest.findByIdAndUpdate(
          id,
          { $set: { status: "FORWARD_PENDING", forwardOpid: forwardResult.opid, payoutError: undefined } }
        ).catch(() => {});
        return { success: true, status: "FORWARD_PENDING", forwardOpid: forwardResult.opid, request };
      } else if (forwardResult.txid) {
        const updated = await this.finalizeRequestForward(id, forwardResult.txid);
        return { success: true, status: "FULFILLED", forwardTxid: forwardResult.txid, request: updated };
      }
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      const errMsg = rawMsg.replace(/t1[a-zA-Z0-9]{33}/g, "shielded escrow vault");
      await connectToDatabase().catch(() => {});
      await PaymentRequest.findByIdAndUpdate(
        id,
        { $set: { status: "FORWARD_PENDING", payoutError: errMsg, updatedAt: new Date() } }
      ).catch(() => {});
      throw new Error(`PAYOUT_RETRY_FAILED: ${errMsg}`);
    }
  },

  /**
   * Reconciles all pending invoice and request payouts across the system (Robot queue)
   */
  async reconcilePendingForwards() {
    let pendingLinks: any[] = [];
    let pendingRequests: any[] = [];
    let isMongo = false;

    try {
      await connectToDatabase();
      isMongo = true;
      const [links, reqs] = await Promise.all([
        PaymentLink.find({ status: { $in: ["FORWARD_PENDING", "SETTLING"] } }).limit(50).lean(),
        PaymentRequest.find({ status: { $in: ["FORWARD_PENDING", "SETTLING"] } }).limit(50).lean(),
      ]);
      pendingLinks = links || [];
      pendingRequests = reqs || [];
    } catch (e) {
      if (IS_PRODUCTION) {
        throw new Error("DATABASE_UNAVAILABLE: Cannot query pending forwards for reconciliation.");
      }
    }

    if (!isMongo) {
      pendingLinks = memoryStore.paylinks.filter(
        (l) => l.status === "FORWARD_PENDING" || l.status === "SETTLING"
      );
      pendingRequests = memoryStore.requests.filter(
        (r) => r.status === "FORWARD_PENDING" || r.status === "SETTLING"
      );
    }

    const results: any[] = [];

    // Process PayLinks
    for (const link of pendingLinks) {
      try {
        const res = await this.retryForwardPayLink(link.slug);
        results.push({ type: "paylink", slug: link.slug, ...res });
      } catch (err: any) {
        results.push({ type: "paylink", slug: link.slug, status: "FORWARD_PENDING", error: err.message });
      }
    }

    // Process Requests
    for (const req of pendingRequests) {
      const id = (req._id || req.id).toString();
      try {
        const res = await this.retryForwardRequest(id);
        results.push({ type: "request", id, ...res });
      } catch (err: any) {
        results.push({ type: "request", id, status: "FORWARD_PENDING", error: err.message });
      }
    }

    return results;
  },
};
