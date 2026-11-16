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
