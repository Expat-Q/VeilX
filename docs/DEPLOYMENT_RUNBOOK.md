# XTip — Production Deployment Runbook

**Target Audience:** DevOps Engineers, Site Reliability Engineers, Full-Stack Engineers  
**System:** XTip Production Deployment (Docker / Kubernetes / Systemd)

---

## 1. System Architecture Overview

```
[Cloudflare CDN / Edge WAF]
             │ (HTTPS / TLS 1.3)
             ▼
[Nginx / Reverse Proxy] ────► Security Headers & SSL Termination
             │
             ▼
[Next.js Node.js Cluster] ───► Stateless Application Pods (Port 3000)
       │               │
       │               ▼
       │      [MongoDB Replica Set (6.0+)]
       │      ├── Primary
       │      ├── Secondary
       │      └── Arbiter
       │
       ▼ (Private VPC Network)
[Zcash Node Daemon (zcashd / zallet)]
├── Shielded Escrow Pool
└── Block Height Synchronizer
```

---

## 2. Infrastructure Sizing & Requirements

### 2.1 Next.js Application Server
- **CPU:** 2-4 vCPUs
- **Memory:** 4-8 GB RAM
- **OS:** Ubuntu 22.04 LTS / Alpine Linux (Container)
- **Runtime:** Node.js v18.x or v20.x LTS

### 2.2 Zcash Node Server (`zcashd` / `zallet`)
- **CPU:** 4-8 vCPUs (fast single-core performance for zk-SNARK prover)
- **Memory:** 16 GB RAM minimum (prover peaks at ~4-6GB during shielded joinsplits/outputs)
- **Storage:** 200 GB+ High-IOPS NVMe SSD (for full blockchain ledger)
- **Network:** Private VPC connection to application servers; RPC port never exposed to public internet.

### 2.3 MongoDB Cluster
- **Version:** MongoDB 6.0+ with WiredTiger storage engine
- **Topology:** 3-node replica set with automated failover
- **Authentication:** SCRAM-SHA-256 enabled with dedicated application user

---

## 3. Environment Variables Configuration

Create `/etc/xtip/production.env` (permissions `chmod 600`):

```bash
# Application Runtime
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=https://xtip.app

# Cryptography & Session (MUST be >= 32 characters)
SESSION_SECRET=<32_BYTE_HEX_GENERATED_VIA_OPENSSL>

# Database Connection (Replica Set URI)
MONGODB_URI=mongodb://xtip_app:<SECURE_DB_PASSWORD>@mongo1.internal:27017,mongo2.internal:27017,mongo3.internal:27017/xtip?replicaSet=rs0&authSource=admin&w=majority

# Twitter / 𝕏 OAuth 2.0 PKCE Credentials
TWITTER_CLIENT_ID=<PRODUCTION_TWITTER_CLIENT_ID>
TWITTER_CLIENT_SECRET=<PRODUCTION_TWITTER_CLIENT_SECRET>
TWITTER_CALLBACK_URL=https://xtip.app/api/auth/callback/twitter

# Zcash Blockchain & Node RPC
NEXT_PUBLIC_ZCASH_NETWORK=mainnet
ZALLET_RPC_URL=http://zcash-node.internal:8232
ZALLET_RPC_USER=xtip_rpc_user
ZALLET_RPC_PASS=<SECURE_RPC_PASSWORD>

# Simulation Protection (MUST be disabled in production)
ENABLE_TESTNET_SIMULATION=false

# Background Sync & Automation Security
CRON_SECRET=<RANDOM_HEX_SECRET_FOR_SYNC_WORKER>
```

---

## 4. Pre-Deployment Verification & Database Indexing

Before routing live traffic, execute the database index synchronization:

```bash
# Connect to container or runner
node -e '
  const { ensureDatabaseIndexes } = require("./dist/lib/mongodb");
  ensureDatabaseIndexes()
    .then(() => { console.log("✅ All production indexes verified."); process.exit(0); })
    .catch((err) => { console.error("❌ Index creation failed:", err); process.exit(1); });
'
```

---

## 5. Build & Containerization

### 5.1 Production Dockerfile Build
```bash
# Build production image
docker build -t xtip:v1.0.0 .

# Tag for internal registry
docker tag xtip:v1.0.0 registry.internal/xtip:v1.0.0
docker push registry.internal/xtip:v1.0.0
```

### 5.2 Standalone Build Test
```bash
npm run build
```

---

## 6. Smoke Tests & Verification Commands

Execute immediately following deployment:

1. **Health & Security Headers Check:**
   ```bash
   curl -I https://xtip.app/
   ```
   Verify response contains:
   - `x-frame-options: DENY`
   - `x-content-type-options: nosniff`
   - `strict-transport-security: max-age=63072000; includeSubDomains; preload`
   - `content-security-policy`

2. **Zcash Node Connectivity Check:**
   ```bash
   curl -s -u "$ZALLET_RPC_USER:$ZALLET_RPC_PASS" \
     -d '{"jsonrpc":"2.0","id":"ping","method":"getblockchaininfo","params":[]}' \
     -H 'Content-Type: application/json' "$ZALLET_RPC_URL" | grep -q "blocks" && echo "✅ Zcash node reachable"
   ```

3. **Background Sync Worker Verification:**
   ```bash
   curl -s -X POST https://xtip.app/api/sync \
     -H "Authorization: Bearer $CRON_SECRET" | grep -q "scannedNotes" && echo "✅ Sync worker operational"
   ```

4. **Automated Regression Suite Verification:**
   ```bash
   npm test
   ```
   Confirm `18 / 18 passed (100%)`.
