# XTip — Incident Response Runbook

**Purpose:** Standard operating procedures for responding to security incidents, financial discrepancies, blockchain node failures, and database outages in XTip production environments.

---

## 1. Incident Severity Levels

| Severity | Definition | Target MTTR | Examples |
|---|---|---|---|
| **SEV-1 (Critical)** | Direct risk to user funds, potential duplicate payouts, ongoing cryptographic compromise, or complete system outage. | < 30 minutes | Key leakage, rogue payouts detected, unverified transactions settling invoices. |
| **SEV-2 (Major)** | Core financial operations impaired; tips stuck in `PENDING_VERIFICATION`; Zcash node RPC unreachable; degraded database. | < 2 hours | Node out of sync, sync worker failing, OAuth login failures. |
| **SEV-3 (Minor)** | Non-blocking issues, cosmetic UI inconsistencies, single user edge cases. | < 24 hours | Avatar lookup timeouts, localized slow queries. |

---

## 2. Emergency Kill-Switches & Containment

### 2.1 Halting All Outgoing Payouts
If rogue payouts or state corruption are suspected, immediately freeze all outgoing claim transactions without bringing down the web UI:

1. **Option A — Environment Variable Flag:**
   Set `DISABLE_PAYOUTS=true` on application containers and perform a rolling restart.
2. **Option B — Firewall / Security Group Rule:**
   Temporarily drop traffic from the application servers to the Zcash RPC port (18232 / 8232).
   - Because XTip fails closed, any outgoing payout attempt will gracefully transition to `PENDING_VERIFICATION` without losing financial state.

### 2.2 Global Session Revocation
If `SESSION_SECRET` is suspected of being compromised:
1. Generate a new secret:
   ```bash
   NEW_SECRET=$(openssl rand -hex 32)
   ```
2. Update the `SESSION_SECRET` environment variable in the secret store and restart all application instances.
3. **Effect:** All existing cookies will immediately fail GCM decryption and be rejected as `null`, forcing all active users to re-authenticate cleanly via Twitter OAuth 2.0 PKCE.

---

## 3. Playbooks for Common Scenarios

### Playbook A: Tips Stuck in `PENDING_VERIFICATION`
**Symptoms:** Users report tips showing "Pending Verification" for > 15 minutes.

1. **Check Zcash Node Operation Status:**
   Run an RPC query against the node to inspect the operation ID (`payoutOpid`):
   ```bash
   curl -s -u "$ZALLET_RPC_USER:$ZALLET_RPC_PASS" \
     -d '{"jsonrpc":"2.0","id":"diag","method":"z_getoperationstatus","params":[["<OPID>"]]}' \
     -H 'Content-Type: application/json' "$ZALLET_RPC_URL"
   ```
2. **Assess Operation State:**
   - **`success`:** The transaction was broadcasted! Extract `result.txid`.
     - Update the database:
       ```javascript
       db.tips.updateOne(
         { payoutOpid: "<OPID>" },
         { $set: { status: "CLAIMED", claimTxid: "<TXID>", claimedAt: new Date() } }
       );
       ```
   - **`failed`:** Operation aborted by node (e.g. insufficient funds, fee calculation).
     - **CAUTION:** Confirm with `z_listunspent` or blockchain explorer that the tx was NOT broadcast.
     - Once confirmed unspent, reset tip to `FUNDED`:
       ```javascript
       db.tips.updateOne(
         { payoutOpid: "<OPID>" },
         { $set: { status: "FUNDED", payoutOpid: null, payoutError: "Failed during dispatch" } }
       );
       ```
   - **`executing`:** Node is still computing zk-SNARK proof. Allow an additional 5 minutes.

---

### Playbook B: Zcash RPC Node Unreachable or Timing Out
**Symptoms:** Application logs showing `RPC request timed out after 10000ms` or `Connection refused`.

1. **Inspect Node Process:**
   ```bash
   ssh node-server
   sudo systemctl status zcashd   # or docker ps
   ```
2. **Check Blockchain Sync State:**
   ```bash
   zcash-cli getblockchaininfo
   ```
   Verify `blocks` matches `headers` and `verificationprogress > 0.999`.
3. **Check Memory & SNARK Prover Resources:**
   Zcash proofs require significant RAM (minimum 4GB free). If the daemon was OOM-killed:
   - Check `dmesg -T | grep -i oom`.
   - Resize node instance to at least 16GB RAM and restart the daemon.

---

### Playbook C: Suspected Replay Attack / Double Spending
**Symptoms:** Logs indicate `DUPLICATE_TXID_REUSE` or unusual database index conflict.

1. **Audit Affected Transaction:**
   ```bash
   zcash-cli getrawtransaction "<TXID>" 1
   ```
2. **Query All Collections for the Txid:**
   In MongoDB shell:
   ```javascript
   db.tips.find({ $or: [{ fundingTxid: "<TXID>" }, { claimTxid: "<TXID>" }] });
   db.paymentrequests.find({ paidTxid: "<TXID>" });
   db.paymentlinks.find({ paidTxid: "<TXID>" });
   ```
3. **Verify Settlement Outcomes:**
   - Confirm that only the legitimate first-arrived invoice or tip claimed the transaction.
   - Verify that any subsequent attempts were blocked by `isTxidAlreadyUsed` and unique sparse indexes.

---

## 4. Post-Incident Review & Root Cause Analysis

Following any SEV-1 or SEV-2 incident:
1. Preserve all logs (`/var/log/nginx`, Next.js container logs, `zcashd` `debug.log`).
2. Document timeline from first anomalous event to containment and resolution.
3. Open GitHub issue with remediation tasks to prevent recurrence.
