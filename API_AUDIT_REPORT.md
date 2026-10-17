# XTip — Production API Audit Report

**Date:** October 12, 2026  
**Auditor:** Principal Backend & Security Engineering Team  
**System:** XTip Shielded Micro-Tipping & Payment API  
**Status:** Complete  

---

## 1. Complete API Route Inventory

The XTip backend exposes 21 endpoints under `src/app/api`. Every route was audited for authentication, parameter validation, error handling, rate limiting, and fail-closed security properties.

| Route | Method | Auth Required | Purpose | Rate Limit / Protection | Fail-Closed Behavior |
|---|---|---|---|---|---|
| `/api/auth/twitter` | GET | Public | Initiates X OAuth 2.0 PKCE flow | Standard IP Limiting | Generates secure PKCE state & verifier cookies. |
| `/api/auth/callback/twitter` | GET | Public | Exchanges PKCE code for tokens | Strict sanitization | Sanitizes referral cookie to alphanumeric; rejects invalid tokens. |
| `/api/auth/logout` | POST | Public | Clears session cookies | Standard IP Limiting | Deletes encrypted session cookies. |
| `/api/auth/me` | GET | Session | Returns current authenticated user state | CSRF / Session Check | Zeroes out stats when DB is offline; never returns fake balances. |
| `/api/health` | GET | Public / Monitoring | System diagnostics (DB, Node, Circuit Breaker) | Standard IP Limiting | Returns 503 if DB or node unreachable in production. |
| `/api/prices` | GET | Public | Fetches real-time ZEC/USD/EVM price feeds | In-memory cache | Returns cached prices; falls back to conservative static rates. |
| `/api/users/lookup` | GET | Public | Resolves X profile metadata & avatars | Cache / Debounced | Fails cleanly with 404/fallback avatar if X API unreachable. |
| `/api/tips` | GET | Session / Query | Lists incoming tips for recipient username | Session Check | Returns empty list or user's tips; fails closed on DB error. |
| `/api/tips` | POST | Public (Escrow creation) | Generates new tip escrow deposit address | Rate Limited | Validates amount bounds; derives valid Zcash UA. |
| `/api/tips/[id]/fund` | POST | Public / Payer | Confirms tip funding via on-chain txid | Origin Header Check | Requires verified on-chain payment and checks anti-replay. |
| `/api/tips/[id]/claim` | POST | Session | Dispatches shielded payout to recipient address | Session Check & CSRF | Verifies recipient ownership, validates address, enforces circuit breaker. |
| `/api/tips/claim-all` | POST | Session | Batch dispatches single payout for all funded tips | Session Check & CSRF | Atomic document lock, circuit breaker check, bounded sum. |
| `/api/requests` | GET | Session | Lists payment requests created by user | Session Check | Requires authentication; returns 401 if unauthenticated. |
| `/api/requests` | POST | Session | Creates new payment request | Session Check | Requires authentication; validates amount and UA address. |
| `/api/requests/[id]` | GET | Public | Fetches invoice details for payer view | Standard IP Limiting | Returns public invoice details; masks internal secrets. |
| `/api/requests/[id]/reject` | POST | Session | Cancels/rejects a pending payment request | Session Check | Enforces that only requester or target recipient can reject. |
| `/api/requests/[id]/settle` | POST | Public / Payer | Confirms on-chain payment for invoice | Origin Header Check | Verifies txid on-chain; checks cross-feature anti-replay. |
| `/api/paylinks` | GET | Session | Lists reusable payment links created by user | Session Check | Requires authentication; returns 401 if unauthenticated. |
| `/api/paylinks` | POST | Session | Creates reusable payment link | Session Check | Requires authentication; validates title, amount, and recipient UA. |
| `/api/paylinks/[slug]` | GET | Public | Fetches public paylink metadata for payer | Standard IP Limiting | Returns public metadata; returns 404 if slug not found. |
| `/api/paylinks/[slug]/settle`| POST | Public / Payer | Confirms on-chain settlement for paylink | Origin Header Check | Verifies txid on-chain; checks cross-feature anti-replay. |
| `/api/swaps/tokens` | GET | Public | Returns supported cross-chain EVM tokens | Standard IP Limiting | Returns verified token list (ETH, USDC, USDT). |
| `/api/swaps/quote` | POST | Public | Calculates quote & deposit address for EVM swap | Rate Limited | Validates EVM amount; fetches conservative exchange quote. |
| `/api/swaps/[id]` | GET | Public | Checks cross-chain swap status | Standard IP Limiting | Returns status, confirmations, and settlement state. |
| `/api/swaps/[id]/settle` | POST | Public | Settles EVM swap order with tx hash | Origin Header Check | Prohibits simulation in production; checks hash anti-replay. |
| `/api/sync` | POST | Cron Secret | Automated tip expiry sweep & reconciliation | Bearer Auth Header | Protected by `CRON_SECRET`; fails closed if unauthenticated. |

---

## 2. Authentication & Authorization Matrix

1. **Session-Protected Endpoints:**
   - `/api/auth/me`
   - `/api/tips/[id]/claim`
   - `/api/tips/claim-all`
   - `/api/requests` (GET, POST)
   - `/api/requests/[id]/reject` (POST)
   - `/api/paylinks` (GET, POST)
   - *Implementation:* Enforced via `getCurrentUser()` with AES-256-GCM encrypted HTTP-only session cookies. Missing or invalid sessions return `401 Unauthorized`.
2. **Worker / Automation Endpoints:**
   - `/api/sync`
   - *Implementation:* Gated by `Authorization: Bearer <CRON_SECRET>`. Missing or invalid tokens return `401 Unauthorized`.
3. **Public Mutating Endpoints (Settlement & Funding):**
   - `/api/tips/[id]/fund`
   - `/api/requests/[id]/settle`
   - `/api/paylinks/[slug]/settle`
   - `/api/swaps/[id]/settle`
   - *Implementation:* Protected against cross-site request forgery by `src/middleware.ts` origin validation, and guarded against double-spend by cryptographic on-chain transaction verification (`verifyPaymentTransaction`) and multi-collection anti-replay indexes (`isTxidAlreadyUsed`).

---

## 3. Cryptographic Input Validation Standards

1. **Zcash Address Validation:**
   - All addresses submitted to `/api/tips`, `/api/requests`, `/api/paylinks`, and `/api/tips/[id]/claim` undergo strict cryptographic validation:
     - Transparent P2PKH (`t1...` mainnet, `tm...` testnet) & P2SH (`t3...`, `t2...`) via Base58Check checksum decoding.
     - Sapling shielded (`zs...`, `ztestsapling...`) via Bech32 checksum decoding.
     - Unified Addresses (`u...`, `uregtest...`) via Bech32m checksum decoding.
     - Address corruptions and cross-network mismatches (e.g. mainnet address on testnet) are rejected with `400 Bad Request`.
2. **Amount Normalization:**
   - Monetary amounts are strictly validated against non-negative, finite numbers.
   - Payout calculations use 8-decimal precision rounding (`Math.round(zec * 1e8) / 1e8`) to eliminate floating point rounding leakage.

---

## 4. Error Handling & Information Disclosure Prevention

- **Standardized Error Schemas:** Errors return `{ error: string, status?: number }` without internal database stack traces or raw Mongoose validation dumps.
- **Fail-Closed Guarantees:** Database or RPC node connection failures return HTTP 500 or 503 rather than falling back to in-memory mocks in production.
- **Diagnostics:** `/api/health` exposes health summaries (connected/disconnected) without exposing database connection strings, passwords, or internal file paths.
