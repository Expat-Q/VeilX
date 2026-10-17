# XTip V1 — Practical Implementation Blueprint & System Architecture

**Status:** Final Implementation Blueprint Locked  
**Target Environment:** Zcash Testnet (NU6.3 / Ironwood)  
**Target Delivery Window:** 3-Week Hackathon MVP  
**Core Stack:** Next.js 14 (TypeScript / App Router) + PostgreSQL + Zallet (JSON-RPC) + Zebra Node

---

## Table of Contents
1. [Executive Architecture Overview](#1-executive-architecture-overview)
2. [Technology Stack & Architectural Rationale](#2-technology-stack--architectural-rationale)
3. [X/Twitter Identity Layer (OAuth 2.0 PKCE)](#3-xtwitter-identity-layer-oauth-20-pkce)
4. [Wallet Interaction Architecture (Noir Extension + Zodl Mobile)](#4-wallet-interaction-architecture-noir-extension--zodl-mobile)
5. [Feature Specification 1: Private Tip (Escrow Lifecycle)](#5-feature-specification-1-private-tip-escrow-lifecycle)
6. [Feature Specification 2: Private Request (Direct Settlement)](#6-feature-specification-2-private-request-direct-settlement)
7. [Feature Specification 3: Private Payment Link (ZIP-321 Invoicing)](#7-feature-specification-3-private-payment-link-zip-321-invoicing)
8. [Blockchain Ingestion & Payment Detection Worker](#8-blockchain-ingestion--payment-detection-worker)
9. [Server-Subsidized Claim Execution Engine](#9-server-subsidized-claim-execution-engine)
10. [Database Architecture & Complete Prisma DDL Schema](#10-database-architecture--complete-prisma-ddl-schema)
11. [Security, Privacy & Key Isolation Model](#11-security-privacy--key-isolation-model)
12. [Local & Testnet Docker Compose Environment](#12-local--testnet-docker-compose-environment)
13. [Step-by-Step 3-Week Implementation Roadmap](#13-step-by-step-3-week-implementation-roadmap)

---

# 1. Executive Architecture Overview

XTip serves as the private coordination and settlement bridge between **Web2 social identity** (X/Twitter) and **shielded Zcash** (Ironwood).

```
+=============================================================================+
|                          XTIP SYSTEM ARCHITECTURE                           |
+=============================================================================+

  [ SENDER CLIENTS ]                                   [ RECIPIENT CLIENTS ]
  Desktop (Noir Ext / QR)                              X User (@bob)
  Mobile (Zodl Deep Link)                              OAuth 2.0 PKCE
         │                                                    │
         ▼                                                    ▼
  +──────────────────────────────────────────────────────────────────────────+
  |                       XTIP FULLSTACK APP (Next.js 14)                    |
  |  - Web UI (Tailwind CSS + Lucide + QR Renderer)                          |
  |  - Auth Layer (X OAuth 2.0 PKCE Session Engine)                          |
  |  - API Route Handlers (/api/tips, /api/claims, /api/requests, /api/pay)  |
  |  - Dynamic ZIP-321 URI Generator (`@zcash/zip321`)                       |
  +──────────────────────────────────────────────────────────────────────────+
         │                                      │
         ▼ (Data Persistence)                   ▼ (Escrow & Settlement Commands)
  +──────────────────────+             +─────────────────────────────────────+
  |  POSTGRESQL 16       |             |  ZALLET WALLET DAEMON               |
  |  - Users Registry    |             |  - Account 0 Master Escrow Pool     |
  |  - Tips Ledger       |             |  - ZIP-316 Diversifier Derivations  |
  |  - Row-Level Locks   |             |  - Automated Server Prover (Halo2)  |
  +──────────────────────+             +─────────────────────────────────────+
                                                        │
                                                        ▼ (Zcash P2P & Blocks)
                                       +─────────────────────────────────────+
                                       |  ZEBRA FULL NODE (Rust)             |
                                       |  (Zcash Testnet / NU6.3 Active)     |
                                       +─────────────────────────────────────+
                                                        │
                                                        ▼
                                            [ ZCASH TESTNET NETWORK ]
```

---

# 2. Technology Stack & Design System

### Why Next.js 14 Fullstack + TypeScript is the Best Choice
1. **Single Monorepo & Zero CORS Friction:** Frontend UI and backend API route handlers live in one unified codebase with end-to-end type safety.
2. **Rapid OAuth & State Handlers:** Next.js Route Handlers (`/app/api/...`) effortlessly handle X OAuth 2.0 PKCE redirects, cookie sessions, and encrypted payload parsing.
3. **Seamless JSON-RPC Client:** Communicating with Zallet is as simple as making authenticated internal `fetch()` calls to `http://zallet:18232`.
4. **Fast Prototyping:** Allows building all 3 payment primitives within the 3-week hackathon timeline without managing multiple microservice deployments.

### Official UI Design Theme: Warm Cream, Espresso Brown & Zcash Gold

```
+=============================================================================+
|                          XTIP DESIGN COLOR PALETTE                          |
+=============================================================================+

  [ COLOR TOKENS ]
  ├── Background (Primary Canvas):   Warm Cream / Ivory       `#FAF7F2`
  ├── Surface / Cards:               Elevated Pearl Cream     `#FFFFFF` (border: `#EFE8DC`)
  ├── Text (Headings / Primary):     Deep Espresso Brown      `#1E1315`
  ├── Text (Secondary / Subtitles):  Muted Warm Sepia         `#6B5B5E`
  ├── Accent / Gold Buttons:         Radiant Zcash Gold       `#F4B728` (hover: `#E5A81A`)
  ├── Secondary Buttons / Badges:    Espresso Dark Brown      `#2A1A1E` (text: `#FAF7F2`)
  └── Success / Shielded Glow:       Emerald & Amber Glow     `#10B981` / `#F4B728`
```

### Tailwind CSS Configuration Tokens:
```javascript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#FAF7F2', // Primary App Background
          200: '#F4ECE0',
          300: '#EAE0D0',
        },
        espresso: {
          900: '#1E1315', // Primary Text & Deep Elements
          800: '#2A1A1E', // Secondary Buttons
          700: '#3D282D',
          500: '#6B5B5E', // Muted Text
        },
        gold: {
          400: '#FCD34D',
          500: '#F4B728', // Official Zcash Gold Accent & Primary CTA
          600: '#E5A81A',
          700: '#B8820E',
        }
      }
    }
  }
}
```

```
+-----------------------------------------------------------------------------+
|                                TECH STACK                                   |
+-------------------+---------------------------------------------------------+
| Frontend Layer    | Next.js 14 (App Router), React, Tailwind CSS, Lucide    |
| Payment Encoding  | `@zcash/zip321`, `qrcode.react`                         |
| Backend API       | Next.js Route Handlers + TypeScript                     |
| Database & ORM    | PostgreSQL 16 + Prisma ORM                              |
| Background Sync   | Node.js Polling Worker / BullMQ (10s block poll)        |
| Zcash Wallet      | Zallet (JSON-RPC) on Account 0 Escrow                   |
| Zcash Consensus   | Zebra Node (`zebrad`) running Zcash Testnet             |
+-------------------+---------------------------------------------------------+
```

---

# 3. X/Twitter Identity Layer (OAuth 2.0 PKCE & Target Lookup)

### Target Selection: Live Search & Verified Profile Card
To prevent tippers from accidentally sending funds to the wrong person or misspelling handles:
1. Tipper types a handle (e.g. `@zooko`) into the search input.
2. XTip queries the X API v2 endpoint: `GET /2/users/by/username/:username?user.fields=profile_image_url,description,name,verified,public_metrics`.
3. XTip renders an interactive **Visual Confirmation Card**:
   - High-resolution avatar & display name
   - Verification badge (Blue / Gold checkmark)
   - Profile biography snippet
   - Follower count and account creation age
   - Visual confirmation message: *"You are tipping @zooko (ID: 14829104829)"*
4. The tipper clicks **"Confirm Recipient"** before the escrow payment address is generated.

### Amount Selection & Fiat Price Estimates
- **Presets:** Quick buttons for `0.1 ZEC`, `0.5 ZEC`, `1.0 ZEC`, and `Custom Amount`.
- **Live Fiat Converter:** Fetches real-time ZEC/USD price from CoinGecko public API (`/api/v3/simple/price?ids=zcash&vs_currencies=usd`) to display live equivalent (e.g., `0.5 ZEC (~$22.40 USD)`).

### Strict Private Dashboard
- In alignment with privacy-first principles, there is **NO public global feed** of tips on the landing page.
- Tip history and activity are strictly visible only to the authenticated sender and recipient in their private dashboard views.

---

# 4. Wallet Interaction Architecture (Noir Extension + Zodl Mobile)

XTip supports both desktop extension popups and native mobile wallets without friction.

```
+-----------------------------------------------------------------------------+
|                      MULTI-MODAL WALLET SELECTION MODAL                     |
+-----------------------------------------------------------------------------+

  [ Modal Displayed on Tip / Payment Link ]

  Option 1: Desktop Browser Extension (Noir Wallet)
  ┌────────────────────────────────────────────────────────────────────────┐
  │ [ 🦊 Pay with Noir Extension ]                                         │
  │ -> Triggers window.zcash.sendTransaction popup                         │
  │ -> Auto-approves prefilled amount and unified destination              │
  └────────────────────────────────────────────────────────────────────────┘

  Option 2: Native Mobile Wallet (Zodl / Ywallet)
  ┌────────────────────────────────────────────────────────────────────────┐
  │ [ 📱 Scan with Zodl / Mobile Wallet ]                                  │
  │ -> Renders dynamic ZIP-321 QR Code                                     │
  │ -> On Mobile Web: One-click deep link opens Zodl directly              │
  └────────────────────────────────────────────────────────────────────────┘

  Option 3: Manual Fallback
  ┌────────────────────────────────────────────────────────────────────────┐
  │ [ 📋 Copy Shielded Unified Address (u1...) ]                           │
  └────────────────────────────────────────────────────────────────────────┘
```

---

# 5. Feature Specification 1: Private Tip (Escrow Lifecycle)

```
               +--------------------+
               |      CREATED       | <- Alice sets amount, target @bob, & optional memo
               +--------------------+
                         │
                         ▼ (Alice scans QR / approves Noir tx)
               +--------------------+
               |  FUNDING_DETECTED  | <- Seen in mempool / 0-conf
               +--------------------+
                         │
                         ▼ (3 On-chain Confirmations)
               +--------------------+
               |       FUNDED       | <- Tip ready! "Share on X" & Copy Link buttons active
               +--------------------+
                         │
                         ▼ (Bob logs in & inputs Shielded UA)
               +--------------------+
               |      CLAIMING      | <- DB row-locked; Zallet builds tx
               +--------------------+
                         │
                         ▼ (Tx broadcasted to Zebra)
               +--------------------+
               |      CLAIMED       | <- Bob receives 100% of tip
               +--------------------+
```

### Post-Funding Social Sharing:
Once a tip reaches `FUNDED` status, the Alice UI generates:
1. **"Share on X" Intent Button:** Opens Twitter Web Intent:
   `https://twitter.com/intent/tweet?text=Hey%20%40bob%2C%20I%20just%20sent%20you%20a%20private%20Zcash%20tip%20on%20%40XTipApp%21%20Claim%20your%20ZEC%20here%3A%20https%3A%2F%2Fxtip.app`
2. **"Copy Claim Link" Button:** Copies clean claim invitation URL to clipboard for DMs.

### Anonymous Tipping Rules:
- If `isAnonymous == true`:
  - The API endpoint querying tip details for Bob explicitly strips Alice's `xUserId`, `xUsername`, and profile image.
  - Recipient UI displays: `🛡️ Anonymous Supporter` + Alice's custom private memo.

---

# 6. Feature Specification 2: Private Request (Direct Settlement)

Private requests are **100% non-custodial**. XTip acts purely as the coordination and notification layer.

```
1. Alice logs in via X OAuth.
2. Alice enters: Request 0.5 ZEC from @bob with memo "Art Commission".
3. Alice enters her personal Shielded UA (stored encrypted in MongoDB).
4. Request record created with status `PENDING`.
5. Alice receives a shareable direct link: `https://xtip.app/request/<requestId>` to send to Bob in DMs.
6. When Bob logs into XTip (or visits the direct link):
   - Sees request: "@alice requested 0.5 ZEC for 'Art Commission'".
7. Bob clicks "Accept & Pay":
   - XTip renders dynamic ZIP-321 QR code / Deep Link / Noir popup with Alice's address:
     `zcash:u1alice...?amount=0.5&memo=REQ-ArtCommission`
8. Bob pays directly from his personal Zodl or Noir wallet.
9. Zero escrow custody. Funds transfer directly wallet-to-wallet.
```

---

# 7. Feature Specification 3: Private Payment Link (ZIP-321 Invoicing)

```
1. Freelancer Alice creates Payment Link: 1.25 ZEC ("Website Design").
2. Alice inputs her Shielded UA.
3. XTip generates unique public link: `https://xtip.app/pay/inv_9a8f2c3d`
4. Client/Payer visits URL (No login or X account required).
5. Payer sees invoice summary:
   - Recipient: Alice
   - Item: Website Design
   - Amount: 1.25 ZEC
6. Payer scans ZIP-321 QR code or clicks "Pay with Noir".
7. Payment settles directly to Alice. Link is marked `PAID`.
```

---

# 8. Blockchain Ingestion & Payment Detection Worker

A dedicated background polling service runs continuously inside the Next.js process or as a lightweight companion worker.

```typescript
// Core Polling Loop (Runs every 10 seconds)
async function syncBlockchainNotes() {
  // 1. Get received notes for Account 0 from Zallet
  const receivedNotes = await zalletRpc.call("z_listreceivedbyaddress", []);

  for (const note of receivedNotes) {
    // 2. Find matching tip in DB by diversified escrow address
    const tip = await prisma.tip.findFirst({
      where: {
        escrowAddress: note.address,
        status: { in: ["CREATED", "FUNDING_DETECTED"] }
      }
    });

    if (tip && note.amount >= tip.amountZats) {
      if (note.confirmations >= 3) {
        // 3. Mark as FUNDED and ready for claim
        await prisma.tip.update({
          where: { id: tip.id },
          data: {
            status: "FUNDED",
            fundingTxid: note.txid,
            fundingBlockHeight: note.blockHeight
          }
        });
      } else if (tip.status === "CREATED") {
        // Mark as detecting (mempool / 1-2 conf)
        await prisma.tip.update({
          where: { id: tip.id },
          data: { status: "FUNDING_DETECTED", fundingTxid: note.txid }
        });
      }
    }
  }
}
```

---

# 9. Server-Subsidized Claim Execution Engine

When Bob clicks **"Claim Tip"**, XTip executes an atomic server-side payout:

```typescript
export async function executeClaimPayout(tipId: string, recipientUserId: string, recipientUa: string) {
  return await prisma.$transaction(async (tx) => {
    // 1. Acquire exclusive row-level lock
    const tip = await tx.$queryRaw`
      SELECT * FROM "Tip" WHERE id = ${tipId}::uuid FOR UPDATE
    `;

    if (!tip || tip.status !== "FUNDED") {
      throw new Error("Tip is not in claimable state");
    }

    if (tip.recipientXUserId !== recipientUserId) {
      throw new Error("Unauthorized: Identity mismatch");
    }

    // 2. Transition state to CLAIMING to prevent race conditions
    await tx.tip.update({
      where: { id: tipId },
      data: { status: "CLAIMING" }
    });

    // 3. Call Zallet to build, prove (Halo2), and broadcast the spend
    // Bob receives 100% of tip; 10,000 zat ZIP-317 fee absorbed by Escrow Account
    const spendResult = await zalletRpc.call("z_sendmany", [
      "account_0",
      [{ address: recipientUa, amount: tip.amountZec }],
      1, // minconf
      0.0001 // ZIP-317 marginal fee
    ]);

    // 4. Update status to CLAIMED with TxID
    return await tx.tip.update({
      where: { id: tipId },
      data: {
        status: "CLAIMED",
        claimTxid: spendResult.txid,
        claimedAt: new Date()
      }
    });
  });
}
```

---

# 10. Database Architecture & Complete MongoDB Schema

### Atomic Claim Concurrency in MongoDB
In MongoDB, race conditions are prevented using atomic document updates (`findOneAndUpdate`):
```typescript
// Atomically claim the tip — guarantees only ONE concurrent request can transition FUNDED -> CLAIMING
const tip = await Tip.findOneAndUpdate(
  { _id: tipId, status: "FUNDED", recipientXUserId: authenticatedXUserId },
  { $set: { status: "CLAIMING" } },
  { new: true }
);

if (!tip) {
  throw new Error("Tip already being claimed or unauthorized");
}
```

### Complete Mongoose / MongoDB Schema Models

```typescript
import mongoose, { Schema, Document } from "mongoose";

// --- 1. USER SCHEMA ---
export interface IUser extends Document {
  xUserId: string;          // Immutable numeric ID from X API v2 (e.g. "14829104829")
  xUsername: string;        // Snapshot display handle (e.g. "bob")
  xDisplayName?: string;
  profileImageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = new Schema<IUser>({
  xUserId: { type: String, required: true, unique: true, index: true },
  xUsername: { type: String, required: true },
  xDisplayName: { type: String },
  profileImageUrl: { type: String },
}, { timestamps: true });

// --- 2. TIP SCHEMA (Core Escrow Ledger) ---
export type TipStatus = "CREATED" | "FUNDING_DETECTED" | "FUNDED" | "CLAIMING" | "CLAIMED";

export interface ITip extends Document {
  senderUserId?: mongoose.Types.ObjectId;
  recipientXUserId: string;          // Target immutable numeric ID
  recipientUsernameSnapshot: string; // Snapshot display handle
  amountZats: number;                // Amount in Zatoshis (1 ZEC = 10^8 zats)
  amountZec: number;                 // Amount in ZEC (e.g. 0.5)
  isAnonymous: boolean;
  memo?: string;
  
  // Escrow Address Info
  escrowAddress: string;             // Unique diversified UA (u1test1...)
  diversifierIndex: string;          // 11-byte hex diversifier index
  
  // State Machine
  status: TipStatus;
  
  // Blockchain Data
  fundingTxid?: string;
  fundingBlockHeight?: number;
  claimTxid?: string;
  
  claimedAt?: Date;
  createdAt: Date;
}

export const TipSchema = new Schema<ITip>({
  senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
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
    enum: ["CREATED", "FUNDING_DETECTED", "FUNDED", "CLAIMING", "CLAIMED"], 
    default: "CREATED",
    index: true 
  },
  
  fundingTxid: { type: String },
  fundingBlockHeight: { type: Number },
  claimTxid: { type: String },
  claimedAt: { type: Date }
}, { timestamps: true });

// --- 3. PAYMENT REQUEST SCHEMA (Direct Settlement) ---
export type RequestStatus = "PENDING" | "ACCEPTED" | "CANCELLED" | "FULFILLED";

export interface IPaymentRequest extends Document {
  requesterUserId: mongoose.Types.ObjectId;
  targetXUserId: string;
  targetUsernameSnapshot: string;
  amountZec: number;
  memo?: string;
  recipientShieldedUa: string;
  status: RequestStatus;
  createdAt: Date;
}

export const PaymentRequestSchema = new Schema<IPaymentRequest>({
  requesterUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  targetXUserId: { type: String, required: true, index: true },
  targetUsernameSnapshot: { type: String, required: true },
  amountZec: { type: Number, required: true },
  memo: { type: String },
  recipientShieldedUa: { type: String, required: true },
  status: { 
    type: String, 
    enum: ["PENDING", "ACCEPTED", "CANCELLED", "FULFILLED"], 
    default: "PENDING",
    index: true 
  }
}, { timestamps: true });

// --- 4. PAYMENT LINK SCHEMA (One-Time Invoices) ---
export type InvoiceStatus = "UNPAID" | "PAID" | "EXPIRED";

export interface IPaymentLink extends Document {
  creatorUserId: mongoose.Types.ObjectId;
  title: string;
  amountZec: number;
  recipientShieldedUa: string;
  status: InvoiceStatus;
  paidAt?: Date;
  createdAt: Date;
}

export const PaymentLinkSchema = new Schema<IPaymentLink>({
  creatorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  amountZec: { type: Number, required: true },
  recipientShieldedUa: { type: String, required: true },
  status: { 
    type: String, 
    enum: ["UNPAID", "PAID", "EXPIRED"], 
    default: "UNPAID",
    index: true 
  },
  paidAt: { type: Date }
}, { timestamps: true });
```

---

# 11. Security, Privacy & Key Isolation Model

```
+-----------------------------------------------------------------------------+
|                          SECURITY & PRIVACY BOUNDARIES                      |
+-----------------------------------------------------------------------------+

  1. HOT-WALLET BUFFER ISOLATION
     - Escrow hot wallet maintains a maximum buffer (e.g. 10 ZEC for testnet).
     - Private spending keys reside ONLY in the Zallet container keystore.
     - Web server / Next.js code never handles raw mnemonic seeds or spend keys.

  2. DATA MINIMIZATION
     - All user-supplied recipient addresses for claims are consumed immediately
       for transaction broadcast and never exposed publicly.
     - Anonymous tipping strips sender information from the recipient UI.

  3. SHIELDED-ONLY ENFORCEMENT
     - The address validator strictly rejects transparent (`t1...`) addresses for
       claims, guaranteeing all payouts land in the Ironwood or Sapling pool.
```

---

# 12. Local & Testnet Docker Compose Environment

Create this single `docker-compose.yml` to run the entire backend infrastructure:

```yaml
version: '3.8'

services:
  # 1. Zebra Consensus Node on Zcash Testnet
  zebra:
    image: zfnd/zebra:latest
    container_name: xtip-zebra
    environment:
      - ZEBRA_CONF_NETWORK=Testnet
    volumes:
      - zebra-testnet-data:/var/lib/zebrad
    ports:
      - "18233:18233"
    restart: unless-stopped

  # 2. Zallet Wallet Service (JSON-RPC)
  zallet:
    image: zcash/zallet:latest
    container_name: xtip-zallet
    depends_on:
      - zebra
    ports:
      - "18232:18232"
    environment:
      - ZALLET_RPC_USER=xtip_user
      - ZALLET_RPC_PASS=xtip_password_123
      - ZALLET_ZEBRA_RPC=http://zebra:18233
    restart: unless-stopped

  # 3. PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: xtip-postgres
    environment:
      - POSTGRES_DB=xtip
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    ports:
      - "5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  zebra-testnet-data:
  pg-data:
```

---

# 13. Step-by-Step 3-Week Implementation Roadmap

```
+=============================================================================+
|                      3-WEEK HACKATHON EXECUTION TIMELINE                    |
+=============================================================================+

  [ WEEK 1: Infrastructure & Authentication Foundation ]
  Day 1-2: Spin up Docker (Zebra Testnet + Zallet RPC + Postgres).
  Day 3-4: Implement X OAuth 2.0 PKCE authentication flow in Next.js.
  Day 5-7: Run Prototype Smoke Tests: verify `z_getaddressforaccount` & transfers.

  [ WEEK 2: Core Primitives & Blockchain Ingestion ]
  Day 8-10: Build Private Tip creation + dynamic ZIP-321 QR code generator.
  Day 11-12: Implement background blockchain polling worker for 3-conf funding.
  Day 13-14: Build Claim portal + server-side subsidized `z_sendmany` execution.

  [ WEEK 3: Requests, Links & UI Polish ]
  Day 15-16: Implement Private Requests (P2P direct settlement flow).
  Day 17-18: Implement Private Payment Link (one-time dynamic invoices).
  Day 19-20: Multi-modal wallet UI (Noir extension hook + Zodl deep link modal).
  Day 21:    End-to-end demo video recording and testnet polish.
```
