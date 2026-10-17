# XTip — Production Readiness Checklist

**System:** XTip Core Application & Financial Subsystems  
**Target Environment:** Production (Mainnet / Testnet Staging)  
**Standard:** SOC2 / Financial Application Baseline

---

## 1. Secrets & Environment Configuration

- [ ] **Mandatory Session Secret:** `SESSION_SECRET` is configured in production runtime with at least 32 cryptographically random bytes (`openssl rand -hex 32`).
- [ ] **Twitter OAuth 2.0 Client:** `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` configured and verified against X Developer Portal.
- [ ] **Twitter Callback URL:** `TWITTER_CALLBACK_URL` strictly points to the canonical production HTTPS domain (`https://xtip.app/api/auth/callback/twitter`).
- [ ] **Simulation Prohibited:** `ENABLE_TESTNET_SIMULATION` is NOT set or set to `false`. `NODE_ENV` is set to `production`.
- [ ] **Sync Secret Configured:** `CRON_SECRET` configured for automated background sync workers.
- [ ] **No Secrets in Source:** Verified no `.env` files, private keys, or API tokens are checked into Git.

---

## 2. Database Reliability & Persistence

- [ ] **MongoDB Replica Set:** MongoDB 6.0+ deployed as a multi-node replica set with replica write concern (`w: "majority"`).
- [ ] **Unique Index Synchronization:** Verified indexes on:
  - `User.xUserId` (unique)
  - `Tip.escrowAddress` (unique)
  - `Tip.fundingTxid` (unique, sparse)
  - `Tip.claimTxid` (unique, sparse)
  - `PaymentRequest.paidTxid` (unique, sparse)
  - `PaymentLink.slug` (unique)
  - `PaymentLink.paidTxid` (unique, sparse)
- [ ] **In-Memory Store Gating:** Confirmed that in-memory mock store throws `DATABASE_UNAVAILABLE` in production mode if MongoDB connection is lost.
- [ ] **Connection Pooling:** `maxPoolSize` and `minPoolSize` tuned for expected container concurrency.

---

## 3. Zcash Node & Wallet Integration

- [ ] **Dedicated Node Instance:** Zcash node (`zallet`, `zcashd`, or `zebrad` + `zcash-client-backend`) running on an isolated private VPC.
- [ ] **RPC Endpoint Gated:** Node RPC port (default 18232 testnet, 8232 mainnet) is never exposed to public internet; accessible only from application server IP / security group.
- [ ] **RPC Credentials Secure:** `ZALLET_RPC_USER` and `ZALLET_RPC_PASS` (or API key) configured via secret manager.
- [ ] **Node Synchronization:** Node block height verified matching public network tip (`z_getinfo` or `getblockchaininfo`).
- [ ] **Shielded Pool Funding:** Dedicated warm escrow wallet has sufficient balance and note fragmentation for outgoing payouts.
- [ ] **10s RPC Timeout Verified:** Application wraps all node calls in 10-second `AbortSignal` to prevent connection starvation.

---

## 4. Application Security Controls

- [ ] **Authenticated Session Encryption:** AES-256-GCM enforced with 96-bit IV, 128-bit authentication tag, and 30-day expiration envelope.
- [ ] **Session Tamper Resistance:** Tampered session cookies immediately rejected with `null`.
- [ ] **Security Headers Deployed:**
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] **CSRF Protection:** Origin verification active for all state-mutating API requests (`POST`, `PUT`, `DELETE`).
- [ ] **ReDoS Defense:** Referral input sanitized to valid alphanumeric X handles up to 15 characters.
- [ ] **Cross-Invoice Anti-Replay:** Cross-collection uniqueness checked before settling any payment request, invoice, or tip.

---

## 5. Financial Operations & State Machine

- [ ] **Fail-Closed Claim Payouts:** Any failed, timed out, or unverified payout enters `PENDING_VERIFICATION` (never rolled back to `FUNDED`).
- [ ] **Atomic Lock Prevention:** Concurrent tip claims prevented by atomic `status: FUNDED -> CLAIMING` updates with modified document validation.
- [ ] **Batch Claims Safety:** Only successfully locked tips included in batch payout amount calculation.
- [ ] **Address Checksum Validation:** Full cryptographic Base58Check / Bech32 / Bech32m checksum validation active for all recipient and escrow addresses.
- [ ] **Network Isolation:** Mainnet addresses strictly rejected in testnet environment and vice versa.

---

## 6. Background Jobs & Reconciliation

- [ ] **Escrow Sync Worker:** Cron or scheduled task triggering `POST /api/sync` every 60 seconds with `Bearer <CRON_SECRET>`.
- [ ] **Async OPID Reconciliation:** Worker or endpoint periodically resolving operations with status `PENDING_VERIFICATION`.
- [ ] **Dead-Letter Monitoring:** Alerts triggered if any tip remains in `PENDING_VERIFICATION` longer than 60 minutes.

---

## 7. Sign-Off & Go / No-Go Decision

| Verification Domain | Readiness Status | Approver |
|---|---|---|
| Application Security & Auth | **READY** | Principal Security Engineer |
| Blockchain Payments & Anti-Replay | **READY** | Blockchain Payments Lead |
| Database Reliability | **READY** | Database Reliability Lead |
| Production SRE & Infrastructure | **PENDING LIVE NODE SETUP** | Production SRE Lead |

**Readiness Decision:**  
Application codebase is **READY FOR PRODUCTION DEPLOYMENT**. Live deployment requires connecting to an operational, synchronized Zcash RPC daemon node.
