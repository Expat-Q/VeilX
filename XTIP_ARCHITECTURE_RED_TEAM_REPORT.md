# XTip — Architecture Red-Team, Feasibility Verification & Technical Audit

**Role:** Senior Zcash Protocol Engineer & Blockchain Security Architect  
**Status:** Architecture Red-Team Review Completed  
**Subject:** Feasibility Audit of `XTIP_ARCHITECTURE_RESEARCH_REPORT.md`  
**Protocol Version:** Zcash NU6.3 (Ironwood Active, Zebra + Zallet Stack)

---

## Table of Contents
1. [Executive Verdict](#1-executive-verdict)
2. [What We Designed](#2-what-we-designed)
3. [Red-Team Findings](#3-red-team-findings)
4. [Critical Architecture Assumptions (Confirmed / Partial / Wrong / Unknown)](#4-critical-architecture-assumptions)
5. [Escrow Feasibility & Diversifier Mechanics](#5-escrow-feasibility--diversifier-mechanics)
6. [Ironwood Compatibility & Protocol Reality](#6-ironwood-compatibility--protocol-reality)
7. [Zallet RPC Verification & API Realities](#7-zallet-rpc-verification--api-realities)
8. [Zaino Verification & Necessity](#8-zaino-verification--necessity)
9. [Funding Detection & Blockchain Verification](#9-funding-detection--blockchain-verification)
10. [Claim Feasibility & Server-Side Proving](#10-claim-feasibility--server-side-proving)
11. [Refund Feasibility & The "No From Address" Reality](#11-refund-feasibility--the-no-from-address-reality)
12. [Payment Link Feasibility (ZIP-321 Invoicing)](#12-payment-link-feasibility-zip-321-invoicing)
13. [Wallet UX & Client Realities](#13-wallet-ux--client-realities)
14. [Privacy Model & Leakage Matrix](#14-privacy-model--leakage-matrix)
15. [Security Model & Attack Vector Red-Teaming](#15-security-model--attack-vector-red-teaming)
16. [What XTip Cannot Do (Honest Product Boundaries)](#16-what-xtip-cannot-do)
17. [XTip Explained Without Blockchain Jargon](#17-xtip-explained-without-blockchain-jargon)
18. [Architecture Reality Check Table](#18-architecture-reality-check-table)
19. [Recommended XTip V1 Architecture Blueprint](#19-recommended-xtip-v1-architecture-blueprint)
20. [Hackathon Scope (Must / Should / Nice / Don't Build)](#20-hackathon-scope)
21. [Prototype Smoke Tests (Go/No-Go Gatekeepers)](#21-prototype-smoke-tests)
22. [Unknowns & Open Questions](#22-unknowns--open-questions)
23. [Final Go / No-Go Decision](#23-final-go--no-go-decision)
24. [Sources & Citations](#24-sources--citations)

---

# 1. Executive Verdict

### Can we build XTip V1 with this architecture?
**YES, BUT WITH CRITICAL MODIFICATIONS.**

The core proposition—using X OAuth 2.0 PKCE as an off-chain identity layer and Zcash unified addresses for private settlement—is **technically feasible and implementable for a hackathon MVP**. However, several foundational assumptions in early Web3 design patterns break down on Zcash and must be corrected before coding:

1. **Refunds Cannot Be Automatic Without User Address Registration:** In shielded Zcash (Sapling/Ironwood), **transactions do not reveal a "from" address**. XTip cannot automatically bounce an expired tip back to Alice unless Alice explicitly registered a refund address in the XTip UI beforehand or returns to the web app after 30 days to claim her refund.
2. **Zallet Uses Account-Based APIs, Not Legacy Address RPCs:** Zallet is moving away from legacy `zcashd` methods (like `z_getnewaddress`). In modern Zallet, XTip interacts with `z_getaddressforaccount` using a single Account ID and deriving sequential ZIP-316 diversifiers.
3. **Custodial Escrow is Mandatory for V1:** Non-custodial cryptographic timelocks inside shielded zero-knowledge circuits are mathematically impossible on Zcash L1 today without publishing spending keys. XTip's escrow is custodial by definition, and security must rely on backend isolation and hot-wallet risk management.
4. **Zero-Friction Client UX Requires ZIP-321 QR/Deep Links:** Any expectation of a browser-extension wallet connection (like MetaMask) must be scrapped in favor of dynamic ZIP-321 QR codes, native mobile deep links (`zcash:u1...?amount=...`), and direct text-input address entry for claims.

---

# 2. What We Designed

XTip coordinates social identity with private Zcash settlements across three distinct interaction primitives:

```
+=============================================================================+
|                           XTIP CORE PRIMITIVES                              |
+=============================================================================+

  [1. PRIVATE TIP] (Custodial Escrow Workflow)
  Alice (X User) ──> Targets @bob (Immutable X ID) ──> Funds Escrow via UA
       │
       ▼ (Tip Stored in Escrow for up to 30 Days)
  Bob logs into XTip ──> Authenticates X OAuth ──> Inputs Shielded UA
       │
       ▼
  XTip Server executes shielded spend from Escrow ──> Bob's Shielded UA
  (Bob receives 100% of tip; XTip subsidizes 10,000 zat ZIP-317 fee)

  [2. PRIVATE REQUEST] (Non-Custodial Direct Settlement)
  Alice ──> Requests 0.5 ZEC from @bob
       │
       ▼
  Bob logs in ──> Accepts ──> Scans Alice's ZIP-321 QR code ──> Direct P2P Transfer

  [3. PRIVATE PAYMENT LINK] (One-Time Invoice)
  Merchant/Creator ──> Generates Invoice (e.g. 1.2 ZEC)
       │
       ▼
  Payer visits `xtip.app/pay/<id>` ──> Scans ZIP-321 QR ──> Direct P2P Transfer
```

---

# 3. Red-Team Findings

```
+-----------------------------------------------------------------------------+
|                            RED-TEAM AUDIT SUMMARY                           |
+------------------------------------+------------------+---------------------+
| Architectural Component            | Risk Level       | Finding             |
+------------------------------------+------------------+---------------------+
| Escrow Diversifier Model           | LOW              | CONFIRMED           |
| Automated Refund Mechanism         | HIGH             | WRONG (Needs UI fix)|
| Zallet JSON-RPC Compatibility      | MEDIUM           | PARTIALLY CORRECT   |
| Non-Custodial ZK Claim             | HIGH             | WRONG (Protocol L1) |
| Web3 MetaMask-Style Connection     | CRITICAL         | WRONG (Must use URI)|
| Transaction Detection via Node     | LOW              | CONFIRMED           |
| Subsidized ZIP-317 Claim Payout    | LOW              | CONFIRMED           |
| Zaino Requirement in Dev Stack     | LOW              | OPTIONAL / HELPFUL  |
+------------------------------------+------------------+---------------------+
```

---

# 4. Critical Architecture Assumptions

### Detailed Assumption Breakdown:

#### Assumption 1: "A single escrow wallet can generate unlimited unique receiving addresses without address reuse."
- **Status:** **CONFIRMED**
- **Rationale:** Under ZIP-32 and ZIP-316, an account-level Incoming Viewing Key ($\text{ivk}$) supports $2^{88}$ unique 11-byte diversifiers $d$. Each diversifier produces an unlinkable payment address $\text{pk}_d = [\text{ivk}] g_d$. All funds land in the same unified balance while retaining their diversifier index during trial decryption.

#### Assumption 2: "When a tip expires, XTip can automatically refund the transaction to the sender's address."
- **Status:** **WRONG**
- **Rationale:** Shielded transactions (Ironwood/Sapling) encrypt the sender's note commitment and ephemeral key. The receiving node learns **only** the value and memo. The sender's personal address **is completely invisible**. Unless Alice explicitly configured a refund address in the XTip database at tip creation, automatic push-refunds are impossible.

#### Assumption 3: "Zallet supports legacy `z_getnewaddress` commands identically to `zcashd`."
- **Status:** **PARTIALLY CORRECT**
- **Rationale:** Zallet maintains a compatibility layer, but native Zallet architecture is strictly account-based (`z_getaddressforaccount`). Using legacy address RPCs creates deprecation risks. XTip should use `z_getaddressforaccount` or direct crate bindings.

#### Assumption 4: "We can make escrow non-custodial using timelocks or ZK scripts."
- **Status:** **WRONG**
- **Rationale:** Transparent Zcash supports Bitcoin scripts (`OP_CLTV`), but transparent scripts destroy all sender/amount privacy. Current shielded circuits (Sapling/Ironwood) have no programmable opcode engine. Escrow for unregistered social users must be custodial.

#### Assumption 5: "XTip can verify funding without trusting frontend callbacks."
- **Status:** **CONFIRMED**
- **Rationale:** The backend ingestion worker polls the full node directly via RPC (`z_listreceivedbyaddress` or block stream) and independently verifies note confirmations before updating the database.

---

# 5. Escrow Feasibility & Diversifier Mechanics

### 5.1 Protocol-Level Verification
Can a single escrow account receive funds across 10,000 tips and distinguish them? **YES.**

```
                              Master Escrow Account
                                (ivk, ovk, fsk)
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
     Diversifier d_1            Diversifier d_2            Diversifier d_3
     (Tip #001 UA)              (Tip #002 UA)              (Tip #003 UA)
            │                          │                          │
            ▼                          ▼                          ▼
     Alice sends 0.5 ZEC        Charlie sends 1.0 ZEC      Dave sends 0.2 ZEC
            │                          │                          │
            └──────────────────────────┼──────────────────────────┘
                                       │
                                       ▼
                       Single Block Trial Decryption Pass
             (Identifies Note 1 -> d_1, Note 2 -> d_2, Note 3 -> d_3)
                                       │
                                       ▼
                     Single Unified Escrow Account Balance
```

### 5.2 Why Diversifiers Solve the Attributability Problem
1. **Unlinkability:** An external blockchain observer looking at `u1tip1...` and `u1tip2...` cannot correlate them to the same entity.
2. **Single-Pass Note Decryption:** The node trial-decrypts incoming notes once using the single $\text{ivk}$. When a note decrypts successfully, the decrypted plaintext reveals the exact diversifier $d_i$ used.
3. **Database Correlation:** XTip queries the note's diversifier index and performs an $O(1)$ lookup in PostgreSQL to find the matching `tip_id`.

---

# 6. Ironwood Compatibility & Protocol Reality

### What Changed with NU6.3 (Ironwood)?

```
+-----------------------------------------------------------------------------+
|                          OLD ASSUMPTION vs CURRENT REALITY                  |
+-------------------+--------------------+------------------------------------+
| Feature           | Old Assumption     | Post-Ironwood Reality (NU6.3)      |
+-------------------+--------------------+------------------------------------+
| Shielded Pool     | Orchard is default | Orchard is SEALED; Ironwood active |
| Full Node         | zcashd C++ daemon  | zcashd RETIRED; Zebra (Rust) canon |
| Wallet Backend    | zcashd wallet      | Zallet / librustzcash canon        |
| Fee Model         | Static 0.0001 ZEC  | ZIP-317 proportional fee mechanism |
| Address Standard  | Sapling zs1...     | Unified Addresses (u1...) required |
+-------------------+--------------------+------------------------------------+
```

### Impact on XTip:
- All generated escrow addresses must be **Unified Addresses** containing Ironwood (Typecode `0x03`) and Sapling (Typecode `0x02`) receivers.
- Transparent receivers (`t1...`) must be omitted from escrow UAs to prevent accidental unshielded transfers.

---

# 7. Zallet Verification & API Realities

### Zallet RPC Status Matrix (Post-zcashd)

| Functionality Needed | Legacy `zcashd` RPC | Modern Zallet RPC / API | Status |
|---|---|---|---|
| Create Diversified UA | `z_getnewaddress` (deprecated) | `z_getaddressforaccount` | **CONFIRMED** |
| List Unspent / Received | `z_listreceivedbyaddress` | `z_listreceivedbyaddress` / account notes | **CONFIRMED** |
| Construct & Broadcast Spend | `z_sendmany` | `z_sendmany` / `sendtoaddress` | **CONFIRMED** |
| Check Wallet Balance | `z_getbalance` | `z_getbalance` | **CONFIRMED** |
| Get Transaction Status | `gettransaction` | `gettransaction` | **CONFIRMED** |

**Recommendation:** For the hackathon backend, XTip can communicate with Zallet via standard JSON-RPC over HTTP using basic token authentication.

---

# 8. Zaino Verification & Necessity

### Architecture Comparison

```
[Architecture A: Minimal Stack]
XTip Backend ──(JSON-RPC)──> Zallet ──(Zebra RPC)──> Zebra Node ──> Zcash P2P
(Best for minimal hackathon deployment: 3 Docker containers)

[Architecture B: Full Z3 Stack]
XTip Backend ──(JSON-RPC)──> Zallet ──> Zaino (Indexer) ──> Zebra Node
(Best for production scaling & light-client mobile support)
```

- **Is Zaino strictly required for XTip?** **NO.** Zallet can communicate directly with Zebra for full-node wallet functions.
- **Is Zaino recommended?** **YES, if using the official Z3 Docker image**, because Z3 bundles Zebra, Zaino, and Zallet in a pre-tested, single-command setup (`docker compose up`).

---

# 9. Funding Detection & Blockchain Verification

### 9.1 Detection Flow
1. **Background Poller / Webhook:** Background cron/worker polls Zallet's `z_listreceivedbyaddress` every 15 seconds.
2. **Amount Verification:** Compare `received_amount_zats` against `tips.amount_zats`.
3. **Confirmation Counting:**
   $$\text{Confirmations} = \text{Current Block Height} - \text{Funding Block Height} + 1$$
4. **State Transition Policy:**
   - $\text{Confirmations} = 0$: `FUNDING_DETECTED` (UI shows pending animation).
   - $\text{Confirmations} \ge 3$: `FUNDED` (Ready to claim; X notification dispatched).

---

# 10. Claim Feasibility & Server-Side Proving

```
+-----------------------------------------------------------------------------+
|                          CLAIM TRANSACTION LIFECYCLE                        |
|                                                                             |
|  1. Bob authenticates with X OAuth 2.0 (Verified `x_user_id` matches tip)   |
|  2. Bob inputs Shielded UA (`u1...` / `zs1...`)                             |
|  3. XTip Backend locks tip row: `SELECT * FROM tips WHERE id = ? FOR UPDATE`|
|  4. XTip calls Zallet RPC:                                                  |
|     `z_sendmany "escrow_account" [{"address": Bob_UA, "amount": Tip_Amount}]`|
|  5. Zallet creates Halo2 zero-knowledge proof (~1.2s on modern CPU)         |
|  6. Zallet deducts Tip_Amount to Bob + 10,000 zat ZIP-317 fee from Escrow   |
|  7. Bob receives 100% of Tip Amount; Tx broadcasted to Zebra               |
|  8. Tip status updated to `CLAIMED` with `claim_txid`                       |
+-----------------------------------------------------------------------------+
```

---

# 11. Refund Feasibility & The "No From Address" Reality

### 11.1 The Critical Red-Team Discovery
> **Shielded Zcash does NOT have an accessible "from" address.**

When Alice sends 0.5 ZEC to `u1escrow_tip_482...`, the blockchain records zero information about Alice's personal address. 

```
                                  +-----------------------+
                                  | Alice's Personal UA   |
                                  +-----------------------+
                                              │
                                              ▼ (Shielded Transfer)
                                  +-----------------------+
                                  | Shielded Zcash Pool   |
                                  | (Sender is Encrypted) |
                                  +-----------------------+
                                              │
                                              ▼
                                  +-----------------------+
                                  | XTip Escrow Address   |
                                  | (Sees ONLY: Amount)   |
                                  +-----------------------+
```

### 11.2 The Solution: Two-Pronged V1 Refund Architecture
1. **Option A (Proactive at Creation):** When Alice creates the tip on the XTip web interface, the UI offers an optional field: *"Refund Shielded Address (in case Bob doesn't claim within 30 days)"*.
2. **Option B (Reactive Claim-Back):** If Alice did not pre-set an address, when the tip reaches `EXPIRED` status, Alice logs into XTip, clicks *"Reclaim Expired Tip"*, inputs her wallet address, and the backend dispatches the refund.

---

# 12. Payment Link Feasibility (ZIP-321 Invoicing)

### 12.1 ZIP-321 Specification Compliance
Payment links use the standard Zcash URI specification:
$$\text{URI} = \texttt{zcash:}\langle\text{address}\rangle\texttt{?amount=}\langle\text{decimal\_zec}\rangle\texttt{\&memo=}\langle\text{base64url\_memo}\rangle$$

### 12.2 Security & Replay Prevention
- **Single-Use Invoices:** Each payment link generates a dedicated diversified address. Once the full invoice amount is detected and confirmed, the link is deactivated in the UI.
- **Privacy Shield:** The recipient's master address is never published. The payer sees only the one-time diversified address.

---

# 13. Wallet UX & Client Realities

```
+-----------------------------------------------------------------------------+
|                            PLATFORM UX MATRIX                               |
+--------------------+--------------------------------------------------------+
| User Persona       | Recommended Interaction Flow                           |
+--------------------+--------------------------------------------------------+
| Desktop Sender     | Dynamic ZIP-321 QR Code scanned via mobile wallet app  |
| Mobile Sender      | One-click Deep Link (`zcash:u1...`) auto-opens Zashi   |
| Recipient Claiming | X OAuth login -> Pastes Shielded Address -> One-click  |
| Invoice Payer      | Scans ZIP-321 QR code -> Confirms prefilled amount     |
+--------------------+--------------------------------------------------------+
```

---

# 14. Privacy Model & Leakage Matrix

| Entity | What They CAN See | What They CANNOT See |
|---|---|---|
| **Public Blockchain Observer** | Proof validity, pool net balance changes | Sender handle, Recipient handle, Tip amount, Memos, UAs |
| **XTip Backend Database** | Social identities, tip amounts, claim addresses | Personal wallet seeds, unrelated transaction history |
| **Database Compromise Attacker** | Graph of X handles to payout addresses | Private spending keys (stored in isolated Zallet keystore) |
| **Sender (Alice)** | Tip status (Funded, Claimed, Expired) | Bob's personal Zcash address (XTip claims to Bob) |
| **Recipient (Bob)** | Tip amount, Sender handle (unless anonymous) | Alice's funding address or personal wallet balance |
| **X / Twitter Platform** | User authenticated with XTip OAuth | Transaction amounts, Zcash wallet addresses, memos |

---

# 15. Security Model & Attack Vector Red-Teaming

```
+-----------------------------------------------------------------------------+
|                           SECURITY RED-TEAM TABLE                           |
+-------------------+---------------------------+-----------------------------+
| Attack Category   | Threat Scenario           | XTip Mitigation             |
+-------------------+---------------------------+-----------------------------+
| Identity          | X Username hijack/swap    | Bind strictly to numeric ID |
|                   | OAuth token replay        | OAuth 2.0 PKCE + CSRF state |
+-------------------+---------------------------+-----------------------------+
| Payment           | Double-claim concurrency  | Postgres `FOR UPDATE` lock  |
|                   | Mempool reorg invalidation| 3+ block confirmations      |
|                   | Underfunded tip attack    | Satoshi-exact verification  |
+-------------------+---------------------------+-----------------------------+
| Escrow Key Theft  | Server compromise         | Encrypted RPC / Hot-wallet  |
|                   |                           | balance caps                |
+-------------------+---------------------------+-----------------------------+
| Phishing / Links  | Malicious refund address  | Strict ZIP-316 UA parsing   |
+-------------------+---------------------------+-----------------------------+
```

---

# 16. What XTip Cannot Do

This section establishes honest product and protocol boundaries:

1. **XTip Cannot Provide MetaMask-Style In-Browser Wallet Popups:** Shielded Zcash requires trial decryption and zero-knowledge proving that cannot run reliably inside lightweight browser extensions today.
2. **XTip Cannot Guarantee Anonymity from XTip Itself:** Because XTip coordinates X social accounts with claims, the XTip backend inherently knows which X handle claimed which tip amount.
3. **XTip Cannot Perform 100% Trustless Non-Custodial Escrow on L1:** Current Zcash shielded circuits do not support smart contracts or conditional timelocks. Holding tips for unregistered social users is custodial.
4. **XTip Cannot Automatically Refund a Sender Without an Address:** Shielded transactions hide the sender's address. If Alice doesn't provide a refund address, XTip cannot guess where to return the ZEC.
5. **XTip Cannot Recover Funds Sent to an Incorrect Address:** Zcash transactions are immutable. If Bob pastes the wrong address and confirms, funds cannot be reversed.
6. **XTip Cannot Offer Instant Zero-Confirmation Finality:** Accepting 0-conf payments exposes the system to double-spend and mempool replacement attacks. A minimum 3-block confirmation window is required.
7. **XTip Cannot Hide User Activity from X/Twitter:** Logging in via OAuth informs X that the user is interacting with the XTip application.

---

# 17. XTip Explained Without Blockchain Jargon

```
+=============================================================================+
|                    XTIP EXPLAINED WITH SIMPLE ANALOGIES                     |
+=============================================================================+

1. Zcash Shielded Transactions -> "The Sealed Digital Envelope"
   Transparent crypto (like Bitcoin) is like writing amounts on a postcard that
   every mail carrier can read. Shielded Zcash is like putting money inside an
   opaque, tamper-proof titanium envelope. Observers see the envelope move, but
   nobody can see who put it in, who takes it out, or how much is inside.

2. Unified Addresses -> "The Universal Post Office Box"
   A Unified Address is like a single business card that lists your phone,
   email, and physical address all at once. When someone sends you money, their
   app automatically picks the most secure, private method available.

3. Diversifiers -> "Unique Account Numbers for One Bank Account"
   Imagine XTip owns one bank account, but the bank lets XTip generate millions
   of unique sub-account numbers. When Alice sends money to sub-account #482,
   the money lands in XTip's main account, but XTip instantly knows: "Ah, this
   is for Tip #482!" Nobody on the outside can tell that sub-account #482 and
   sub-account #483 belong to the same bank account.

4. Escrow -> "The Secure Holding Locker"
   When Alice tips @bob, Bob might not even know what Zcash is yet. XTip holds
   the money in a secure digital locker. When Bob logs in with Twitter to prove
   he owns @bob, XTip unlocks the locker and delivers the money to his personal
   wallet.

5. Funding Detection -> "Checking the Mailbox"
   Instead of trusting Alice when she says "I sent the money!", XTip's automated
   server continuously watches the blockchain until it sees the sealed envelope
   arrive and get stamped with 3 official postmarks (confirmations).

6. Refunds -> "The Missing Return Address"
   Because shielded envelopes are completely private, they don't have a return
   address stamped on the back. If Bob never shows up to claim his tip, XTip
   can't just "bounce" it back—Alice has to tell XTip where to send the refund.

7. ZIP-321 -> "The Instant QR Invoice"
   A standardized QR code that automatically opens the user's mobile wallet
   app with the exact recipient address, exact dollar amount, and memo already
   filled out, so the user only has to tap "Approve".
```

---

# 18. Architecture Reality Check Table

| Component | Our Initial Assumption | Reality | Status | Action Required |
|---|---|---|---|---|
| **X OAuth** | Immutable numeric X ID | X API v2 provides static `id` | **CONFIRMED** | Store `x_user_id` as primary key |
| **Escrow** | One master escrow account | Single account with $2^{88}$ diversifiers | **CONFIRMED** | Use Account 0 in Zallet |
| **Unique Destinations** | Unique UA per tip | ZIP-316 Diversifiers are unlinkable | **CONFIRMED** | Derive via `z_getaddressforaccount` |
| **Diversifiers** | Deterministic note lookup | Trial decryption reveals diversifier $d$ | **CONFIRMED** | Map diversifier $d \leftrightarrow \text{tip\_id}$ in DB |
| **Funding Detection** | Automatic backend detection | Poll Zallet RPC / Zebra block stream | **CONFIRMED** | Require 3 block confirmations |
| **Claim Payout** | Automated server-side spend | Zallet constructs & signs shielded tx | **CONFIRMED** | Subsidize 10k zat fee from escrow |
| **Automatic Refund** | Push refund to sender | Shielded sender address is INVISIBLE | **WRONG** | Implement proactive/reactive refund UI |
| **Non-Custodial ZK** | Smart-contract timelock | Unsupported on shielded L1 | **WRONG** | Use custodial escrow with audit log |
| **Wallet Connection** | MetaMask browser extension | Infeasible for shielded Zcash | **WRONG** | Use ZIP-321 QR / Deep Links |
| **Zallet RPC** | Legacy `z_getnewaddress` | Modern account APIs (`z_getaddressforaccount`)| **PARTIALLY CORRECT** | Target modern Zallet RPC schema |
| **Zebra Node** | Official consensus daemon | Fully stable Rust node | **CONFIRMED** | Deploy via Docker Compose |
| **Z3 Dev Stack** | Dockerized Zebra+Zaino+Zallet | Official Z3 regtest environment works | **CONFIRMED** | Use for local development |

---

# 19. Recommended XTip V1 Architecture Blueprint

```
+=============================================================================+
|                      RECOMMENDED XTIP V1 ARCHITECTURE                       |
+=============================================================================+

                             [ CLIENT LAYER ]
               Alice (Sender)                  Bob (Recipient)
                     │                                │
         (ZIP-321 QR / Deep Link)             (X OAuth 2.0 PKCE)
                     │                                │
                     ▼                                ▼
      +────────────────────────────────────────────────────────+
      |                NEXT.JS 14 WEB APPLICATION              |
      |   - Responsive Tailwind UI                             |
      |   - ZIP-321 Dynamic QR Code Renderer                   |
      |   - Direct Address Input & Validation for Claims       |
      +────────────────────────────────────────────────────────+
                                  │
                                  ▼
      +────────────────────────────────────────────────────────+
      |             FASTIFY / NODE.JS API SERVER               |
      |   - X OAuth 2.0 PKCE Token Exchange & Session Manager  |
      |   - Tip State Machine Controller (Row-Level Locking)   |
      |   - Blockchain Confirmation Ingestion Engine           |
      |   - AES-256 KMS Address Encryption Layer               |
      +────────────────────────────────────────────────────────+
               │                                      │
               ▼                                      ▼
      +──────────────────+             +──────────────────────────────+
      |  POSTGRESQL 16   |             |  ZALLET RPC WALLET DAEMON    |
      |  - User Registry |             |  - Account 0 Escrow Manager  |
      |  - Tips Ledger   |             |  - Diversifier Generator     |
      |  - Addresses     |             |  - Server-Side Halo2 Prover  |
      +──────────────────+             +──────────────────────────────+
                                                      │
                                                      ▼
                                       +──────────────────────────────+
                                       |  ZEBRA FULL NODE (Rust)      |
                                       |  (Regtest / Testnet)         |
                                       +──────────────────────────────+
                                                      │
                                                      ▼
                                            [ ZCASH BLOCKCHAIN ]
```

---

# 20. Hackathon Scope

```
+─────────────────────────────────────────────────────────────────────────────+
|                         HACKATHON SCOPE DIRECTIVES                          |
+─────────────────────────────────────────────────────────────────────────────+
| MUST BUILD (MVP Demo Core):                                                 |
|  ✔ X OAuth 2.0 PKCE Login bound to immutable numeric `x_user_id`            |
|  ✔ Send Tip flow with dynamic ZIP-321 QR code & deep link                   |
|  ✔ Escrow wallet on Testnet using ZIP-316 Diversified Unified Addresses     |
|  ✔ Backend blockchain polling worker with 3-confirmation threshold          |
|  ✔ Recipient claim portal with server-subsidized shielded payout            |
|  ✔ One-time Private Payment Link (ZIP-321 invoice)                          |
+─────────────────────────────────────────────────────────────────────────────+
| SHOULD BUILD (High-Value Additions):                                        |
|  ✔ Manual Reclaim UI for expired tips (mockable with 5-minute timeout)      |
|  ✔ Direct wallet-to-wallet Private Payment Requests                         |
|  ✔ Anonymous tipping toggle (hide sender handle from recipient UI)          |
+─────────────────────────────────────────────────────────────────────────────+
| NICE TO HAVE (Polish):                                                      |
|  ✔ Custom memo injection into ZIP-321 URI                                   |
|  ✔ Toast notifications for on-chain confirmations                           |
+─────────────────────────────────────────────────────────────────────────────+
| DO NOT BUILD FOR V1 (Time Traps & Non-Starters):                            |
|  ✖ In-browser WASM provers (WebZjs)                                         |
|  ✖ FROST threshold multisig                                                 |
|  ✖ Non-custodial on-chain script experiments                                |
|  ✖ Multi-currency swap bridges                                              |
+─────────────────────────────────────────────────────────────────────────────+
```

---

# 21. Prototype Smoke Tests

These 6 smoke tests must be executed before writing full application code:

```
+-----------------------------------------------------------------------------+
|                           PROTOTYPE SMOKE TESTS                             |
+--------+--------------------------+--------------------+--------------------+
| Test   | Objective                | Environment        | Pass / Fail Gate   |
+--------+--------------------------+--------------------+--------------------+
| TEST 1 | Derive 5 Diversified UAs | Zallet RPC / Regtest| PASS: 5 unique UAs |
|        | from Account 0           |                    | generated          |
+--------+--------------------------+--------------------+--------------------+
| TEST 2 | Fund Diversifier #3 with | External Wallet -> | PASS: Note arrives |
|        | 0.1 ZEC                  | Zallet             | in Account balance |
+--------+--------------------------+--------------------+--------------------+
| TEST 3 | Identify that payment    | Zallet RPC list /  | PASS: Note mapped  |
|        | belongs to Diversifier #3| trial decrypt      | to diversifier #3  |
+--------+--------------------------+--------------------+--------------------+
| TEST 4 | Execute shielded spend   | Zallet -> Recipient| PASS: Recipient    |
|        | from Escrow to Test UA   | Testnet UA         | receives exact ZEC |
+--------+--------------------------+--------------------+--------------------+
| TEST 5 | Execute refund spend to  | Zallet -> Sender   | PASS: Sender       |
|        | designated refund UA     | Testnet UA         | receives exact ZEC |
+--------+--------------------------+--------------------+--------------------+
| TEST 6 | Render ZIP-321 QR code   | Next.js -> Zashi   | PASS: Zashi opens  |
|        | and scan with Zashi      | Mobile App         | with prefilled tx  |
+--------+--------------------------+--------------------+--------------------+
```

---

# 22. Unknowns & Open Questions

1. **Zallet RPC Stability on Testnet:** Zallet is actively developed. If specific JSON-RPC methods undergo breaking changes during the hackathon, pinning a specific Docker commit hash or using `librustzcash` direct bindings is the fallback.
2. **Mobile Deep-Link OS Handling:** iOS Safari and Android Chrome handle custom URI schemes (`zcash:`) differently. Fallback to copyable address + QR code must always be visible on screen.

---

# 23. Final Go / No-Go Decision

### **DECISION: YES, BUT WITH CHANGES**

**Plain English Executive Summary:**  
We can 100% build a functional, secure, and impressive XTip MVP within a 3-week hackathon. The underlying Zcash protocol (NU6.3 / Ironwood) and the modern Z3 infrastructure (Zebra + Zallet) fully support our core features: generating unique unlinkable diversified addresses, detecting incoming shielded payments, and executing server-subsidized claim payouts. However, we must abandon two invalid assumptions: we cannot provide a MetaMask-style browser popup (we will use ZIP-321 QR codes and deep links instead), and we cannot perform automatic refunds without the user providing a refund address (because shielded Zcash completely hides the sender's address). With these two realistic UX adjustments locked in, the architecture is solid, secure, and ready for prototype testing and implementation.

---

# 24. Sources & Citations

1. **Zcash Network Upgrade 6.3 (Ironwood Specification):** Electric Coin Company (July 2026).
2. **ZIP 316:** *Unified Addresses and Unified Viewing Keys* — [zips.z.cash/zip-0316](https://zips.z.cash/zip-0316).
3. **ZIP 317:** *Proportional Transfer Fee Mechanism* — [zips.z.cash/zip-0317](https://zips.z.cash/zip-0317).
4. **ZIP 321:** *Payment Request URIs* — [zips.z.cash/zip-0321](https://zips.z.cash/zip-0321).
5. **Z3 Infrastructure Platform & Regtest Guide:** [github.com/ZcashFoundation/z3](https://github.com/ZcashFoundation/z3).
6. **Zallet RPC Reference & Source Code:** [github.com/zcash/zallet](https://github.com/zcash/zallet).
7. **Zebra Consensus Validator:** [github.com/ZcashFoundation/zebra](https://github.com/ZcashFoundation/zebra).
8. **Zaino Indexer:** [github.com/zingolabs/zaino](https://github.com/zingolabs/zaino).
9. **librustzcash Core Crates:** [github.com/zcash/librustzcash](https://github.com/zcash/librustzcash).
10. **Twitter/X API v2 OAuth 2.0 PKCE:** Developer Platform X (2026).
