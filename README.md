# ⚡ KoboSplit — Non-Custodial Campus & Market Micro-Split & Escrow

> Split costs instantly with your group using Bitcoin Lightning. Built for the **Dakar Bitcoin Hack by BTrust**.

KoboSplit is a non-custodial Bitcoin Lightning group split and micro-escrow web application designed for campus communities and market cooperatives across Africa. It enables groups to pool funds transparently and release them to vendors — all without a central custodian.

## ✨ Key Features

- **Non-Custodial:** Funds flow directly through Lightning wallets via NWC (Nostr Wallet Connect) — KoboSplit never holds your money.
- **Zero PII:** No emails, phone numbers, or real names stored — only display nicknames and cryptographic proofs.
- **Mobile-First:** Server-rendered pages for instant load on Slow 3G / mid-range Android devices.
- **Multi-Currency:** Live NGN (Naira) and XOF (CFA Franc) conversion with fallback rates.
- **Escrow Release:** Funds are held until the target is reached, then released to the vendor with cryptographic proof visible to all contributors.
- **1-Click Demo Mode:** Judges can test with a pre-configured testnet wallet.

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Next.js 15 (App Router)            │
│  ┌─────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │  RSC     │  │  Client    │  │  API Routes      │  │
│  │  Pages   │  │  Components│  │  /api/pools/*     │  │
│  └────┬─────┘  └─────┬──────┘  └────────┬─────────┘  │
│       │              │                   │            │
│  ┌────▼──────────────▼───────────────────▼─────────┐  │
│  │              Core Libraries (src/lib/)           │  │
│  │  ┌──────────┐ ┌────────┐ ┌───────┐ ┌─────────┐ │  │
│  │  │ crypto.ts│ │ nwc.ts │ │rates.ts│ │security │ │  │
│  │  │AES-256   │ │NWC/NIP │ │NGN/XOF│ │Zod+Rate │ │  │
│  │  │-GCM     │ │-47     │ │Rates  │ │Limiter  │ │  │
│  │  └──────────┘ └───┬────┘ └───────┘ └─────────┘ │  │
│  └────────────────────┼────────────────────────────┘  │
│                       │                               │
│  ┌────────────────────▼────────────────────────────┐  │
│  │            SQLite (Prisma ORM)                   │  │
│  │     Pool | Contribution (Zero PII)              │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  ┌──────────────┐          ┌──────────────┐
  │  NWC Relay   │          │  LNURL-pay   │
  │  (Nostr)     │          │  (Vendor LN  │
  │              │          │   Address)   │
  └──────────────┘          └──────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm

### 1. Clone & Install

```bash
git clone <repo-url>
cd kobosplit
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
- `ENCRYPTION_SECRET` — Already set with a dev key. Generate a production key: `openssl rand -hex 32`
- `DEMO_NWC_URI` — *(Optional but recommended)* Paste a testnet NWC URI from [Alby Hub](https://nwc.getalby.com) for 1-click demo mode.
- `LNURL_PROXY_URL` — *(Optional)* How vendor Lightning Addresses resolve. Leave unset for Alby's public proxy, set to `"false"` to resolve directly against each vendor's own domain, or point it at your own proxy URL.

Fiat amounts are labelled "estimated rate" whenever the live exchange rate could not be fetched, so stale fallback numbers are never presented as live market prices.

### 3. Initialize Database & Seed

```bash
npx prisma generate
npx prisma db push
npx prisma db seed
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Test NWC Integration (Optional)

Set `DEMO_NWC_URI` in `.env`, then:

```bash
npx tsx scripts/test-nwc.ts
```

## 🧪 Local Mock Wallet Harness (no wallet needed)

The whole money lifecycle — invoice → settlement → LNURL-pay release — runs without a Lightning wallet, Nostr relay or internet access.

```bash
npm run e2e
```

That single command starts a mock wallet on `:3102` and its own app server on `:3100` against a throwaway `prisma/harness.db`, then drives the full end-to-end suite through the real HTTP API. Your demo data in `prisma/dev.db` is never touched.

**What the harness verifies**

- Create pool with the demo wallet, then contribute → a real BOLT11 invoice with the amount and payment hash the API reported.
- `lookupInvoice` refuses to settle an unpaid invoice, then confirms it once paid and locks the preimage onto the ledger.
- Partial funding keeps the pool `OPEN`; reaching the target flips it to `FUNDED`.
- Release resolves the vendor Lightning Address, pays the LNURL-pay invoice, and stores a release preimage that hashes (sha256) to the vendor invoice's payment hash.
- Double release, contributions after release, and release before funding are all refused.
- Two release requests fired simultaneously: the conditional `FUNDED → RELEASING` claim lets exactly one pay the vendor, and the loser is refused with `409` while the payout is still in flight (`MOCK_PAY_DELAY_MS` makes that window deterministic).
- The harness delays (`MOCK_PAY_DELAY_MS`, `MOCK_LNURL_DELAY_MS`) apply only to the mock's `slow@blink.sv` vendor, which just the concurrency and stale-claim pools use — the rest of the suite runs at full speed.
- A failed payout rolls the claim back to `FUNDED` so the organizer can retry, and no receipt is stored.
- A crash between "vendor paid" and "receipt written" (reproduced directly in the database) is recovered with the organizer key: a stranger's key is refused, a mismatched preimage is refused, the real preimage settles the pool, and the reconciled pool can never pay again.
- A crash between "claim taken" and "vendor invoice recorded" is not a dead end: because the invoice hash is written before paying, its absence proves nothing was paid, so the organizer key hands the claim back to `FUNDED` and a fresh release runs. Reconciling an `OPEN` or already `RELEASED` pool is refused.
- Every claim carries its own id and all post-claim writes are conditioned on it, so a release that was cancelled by a reconcile-abandon cannot record a hash or pay even if a retry has already re-claimed the pool. The harness drives exactly that interleaving (`MOCK_LNURL_DELAY_MS` holds the stale request inside its window) and asserts one payout, a `409` for the stale request and a `200` for the retry.
- A vendor whose LNURL `maxSendable` is below the collected amount is rejected *before* any payment is attempted, and the pool stays `FUNDED`.
- Nicknames with markup, malformed vendor addresses, and verifying another pool's payment hash are rejected.
- Neither the NWC URI nor its ciphertext ever appears in an API response.

**What is mocked** — the NIP-47 wallet itself (`makeInvoice` / `lookupInvoice` / `payInvoice`, so no relay is involved) and the LNURL-pay proxy that resolves the vendor address. Everything above that seam is the real app: route handlers, Zod validation, rate limiting, Prisma state transitions, AES-256-GCM decryption, `@getalby/lightning-tools` LNURL parsing and real BOLT11 decoding. Mock invoices are structurally valid but unsigned and must never leave your machine.

### Driving a demo in the browser

The mock wallet can settle contribution invoices on a timer, so the QR → polling flow completes by itself on stage — no wallet to scan.

```bash
# terminal 1 — mock wallet, auto-settling contributions after 6s
MOCK_AUTO_SETTLE_MS=6000 npm run mock:wallet

# terminal 2 — app pointed at the mock wallet
NWC_MOCK=1 \
MOCK_WALLET_URL=http://127.0.0.1:3101 \
LNURL_PROXY_URL=http://127.0.0.1:3101/lnurl \
DEMO_NWC_URI='nostr+walletconnect://mock?relay=wss://mock.relay.local&secret=demo' \
npm run dev
```

Then tick **🧪 Use Demo Testnet Wallet** when creating a pool. With `MOCK_AUTO_SETTLE_MS` unset, settlement is manual instead:

```bash
npm run mock:pay        # pay the most recent unpaid contribution
npm run mock:pay -- <paymentHash>
```

`NWC_MOCK=1` throws in a production build, so a real deployment can never fake a payout.

## ▲ Deploying to Vercel

Vercel functions have a read-only filesystem and one instance per request, so the local SQLite file cannot back a deployment — without a hosted database every page returns `500` with `Error code 14: Unable to open the database file`.

KoboSplit uses [Turso](https://turso.tech) (hosted libSQL, same SQLite dialect, free tier):

```bash
turso db create kobosplit
turso db show kobosplit --url        # libsql://kobosplit-<org>.turso.io
turso db tokens create kobosplit     # copy the token
```

1. Add the environment variables in Vercel (Production scope):

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://kobosplit-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | the token from `turso db tokens create` |
| `DATABASE_URL` | `file:./dev.db` — unused at runtime, but `prisma generate` requires it |
| `ENCRYPTION_SECRET` | `openssl rand -hex 32` (must match the one used to seed) |
| `DEMO_NWC_URI` | optional, enables the 1-click demo wallet |

Either name works: if `DATABASE_URL` already holds a `libsql://` URL, the app connects with it instead of `file:`.

2. Redeploy. `npm run build` runs `scripts/db-push.ts --if-missing --seed-if-empty --tolerant`, so the deploy creates the tables on an empty database and seeds the two demo pools itself. It never fails the build when the database is unreachable; open `/api/health` to see the database mode and the real error instead of Next's "server-side exception" digest.

You can still do it by hand, which is useful before a first deploy:

```bash
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run db:push:turso
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run db:seed
```

The runtime picks the adapter from `TURSO_DATABASE_URL`; when it is unset, `npm run dev`, the seed script and the mock harness keep using `prisma/dev.db` exactly as before. `NWC_MOCK=1` still throws in a production build.

## 📁 Project Structure

```
kobosplit/
├── prisma/
│   ├── schema.prisma      # Pool + Contribution models
│   └── seed.ts             # 2 realistic seed pools
├── scripts/
│   └── test-nwc.ts         # NWC integration test
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── pools/      # CRUD + contribute/verify/release
│   │   │   └── rates/      # Currency conversion
│   │   ├── create/          # Create pool page
│   │   ├── pool/[id]/       # Pool detail + QR + escrow
│   │   ├── globals.css
│   │   ├── layout.tsx       # App shell
│   │   └── page.tsx         # Home page
│   └── lib/
│       ├── crypto.ts        # AES-256-GCM encryption
│       ├── db.ts            # Prisma singleton
│       ├── nwc.ts           # NWC + LNURL-pay service
│       ├── rates.ts         # Exchange rate cache
│       └── security.ts      # Zod schemas + rate limiter
├── .env.example
├── package.json
└── README.md
```

## 🔒 Security by Design

| Threat | Mitigation |
|---|---|
| NWC URI exposure | AES-256-GCM encrypted at rest; decrypted in memory only |
| API abuse | In-memory sliding-window rate limiter (no IP storage) |
| Input injection | All payloads validated with strict Zod schemas |
| Double payout | `releasePreimage` check prevents duplicate releases |
| PII leakage | Zero PII stored — nicknames only, no emails/phones/IPs |
| XSS | React's default escaping + no `dangerouslySetInnerHTML` |

## 🌍 Local Impact

- **Campus use case:** Students splitting generator fuel, internet, and textbook costs — common across Nigerian and West African universities.
- **Market use case:** Cooperative bulk buying at markets like Sandaga in Dakar, reducing per-unit costs by 20-30%.
- **Financial inclusion:** No bank account needed — just a Lightning wallet on any smartphone.

## 📄 License

MIT
