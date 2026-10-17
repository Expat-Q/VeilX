# XTip V1 — UI Template & Screen Specification

> **"Don't design around the technology. Design around the user's action."**  
> Simple on the surface. Powerful underneath.  
> XTip is a private payment product, not a crypto dashboard.

---

## Table of Contents
1. [Product Feel & Visual Language](#1-product-feel)
2. [Global App Layout (Desktop & Mobile)](#2-global-app-structure)
3. [Primary Navigation Architecture](#3-primary-navigation)
4. [Home Screen & Activity Feed](#4-home-screen)
5. [Tip Flow (Step-by-Step Screens)](#5-tip-flow)
   - Step 1: Find Recipient
   - Step 2: Tip Amount & Presets
   - Step 3: Privacy Option
   - Step 4: Financial Confirmation
   - Step 5: Wallet Payment Handoff (QR / Deep Link / Noir)
   - Step 6: Payment Waiting & Confirmation
   - Step 7: Understated Success State
6. [Tips Page & Received Tip Claim Flow](#6-tips-page--claim-flow)
7. [Private Request Flow (Create & Settle)](#7-private-request-flow)
8. [Private Payment Link Flow (Invoice Creation & Public Landing)](#8-private-payment-link-flow)
9. [Payments Activity History & Transaction Details](#9-payments-activity--details)
10. [Settings & Profile Screens](#10-settings--profile)
11. [Design System Tokens (Colors, Typography, Spacing, Radius)](#11-design-system-tokens)
12. [Reusable Component Inventory](#12-reusable-component-inventory)
13. [Semantic Status System](#13-semantic-status-system)
14. [Design Review Checklist](#14-design-review-checklist)

---

# 1. Product Feel

### What XTip IS:
- **Private, Calm, Trustworthy, Modern, Minimal, Social, Financial, Fast.**
- A focused payment application where actions feel obvious and immediate.

### What XTip IS NOT:
- ❌ NOT a crypto exchange or trading terminal.
- ❌ NOT a blockchain explorer full of raw hashes and gas gauges.
- ❌ NOT an AI product with robot heads or sparkle icons.
- ❌ NOT a DeFi app with yield charts or liquidity metrics.
- ❌ NOT a futuristic cyberpunk interface with neon grids and glassmorphism.

---

# 2. Global App & Landing Page Structure

### Public Landing Page (Hero Section Layout)
Inspired by clean modern fintech architecture with smooth scroll animations, adapted to XTip's **Warm Cream (`#FAF7F2`) + Espresso Brown (`#1E1315`) + Zcash Gold (`#F4B728`)** aesthetic:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [ XTip Logo ]           [ Features ]  [ How It Works ]  [ Privacy ]       [ Launch App → ]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ DIGITAL PRIVACY. SOCIAL SETTLEMENTS. ]                                              │
│                                                                                        │
│  Send money on X.                                      ┌─────────────────────────────┐ │
│  Keep your finances                                    │ [ Interactive Product       │ │
│  private.                                              │   Preview Card Template ]   │ │
│                                                        │                             │ │
│  Tip creators, request payments, and create            │  @zooko                     │ │
│  private payment links directly for X identities.      │  0.25 ZEC (~$11.20)         │ │
│  Powered by Zcash zero-knowledge cryptography.         │  Status: Shielded Ready     │ │
│                                                        │  [ Claim Tip 0.25 ZEC ]     │ │
│  [ Send a Private Tip → ]   [ How It Works ]           └─────────────────────────────┘ │
│                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  [ TICKER ]   SECURED BY ZCASH  •  IRONWOOD NU6.3  •  X OAUTH 2.0  •  ZERO-KNOWLEDGE   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Dashboard Layout (Desktop & Mobile)
```text
┌──────────────────────────────────────────────────────────────┐
│ @alice (Connected ✓)                     [ 🔔 ]  [ Avatar ]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    PENDING TIPS RECEIVED               │  │
│  │                                                        │  │
│  │                        0.75 ZEC                        │  │
│  │                      (~$33.60 USD)                     │  │
│  │                                                        │  │
│  │  [ 💸 Tip ]     [ 📩 Request ]   [ 🔗 PayLink ] [ 🛡️ Claim ] │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Recent Activity                                  View all → │
│                                                              │
│  @zooko                  -0.25 ZEC                           │
│  Tip sent                 Claimed                            │
│                                                              │
│  Private sender          +0.50 ZEC                           │
│  Tip received             Ready to claim                     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [ 🏠 Home ]     [ 💸 Tips ]     [ 📩 Requests ]    [ 👤 Profile ] │
└──────────────────────────────────────────────────────────────┘
```

### Image & Mockup Placeholder Framework
- Where product screenshots are required on the landing page, XTip renders **high-fidelity CSS/SVG UI component templates** with smooth entrance fades.
- These interactive mockup frames serve as elegant visual representations that can seamlessly be swapped with static product imagery when finalized.

---

# 3. Primary Navigation

```text
Home      -> Overview, primary actions, and recent activity
Tips      -> Sent & received tips, claim portal
Requests  -> Direct payment requests
Payments  -> Complete transaction history
Settings  -> Account & privacy preferences
```

### Primary Quick Actions:
- **`Tip someone`** (Primary radiant Zcash gold CTA)
- **`Request money`** (Secondary espresso dark button)

---

# 4. Home Screen

```text
┌──────────────────────────────────────────┐
│                                          │
│  Private payments for X                  │
│                                          │
│  Send and receive money privately.       │
│                                          │
│  [ Tip someone ]  [ Request money ]      │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  Recent activity                         │
│                                          │
│  @alice                  +0.25 ZEC       │
│  Tip received             Pending        │
│                                          │
│  @charlie                -0.10 ZEC       │
│  Tip sent                 Claimed        │
│                                          │
└──────────────────────────────────────────┘
```

---

# 5. Tip Flow

### Step 1: Find Recipient
```text
┌──────────────────────────────────────────┐
│ ← Tip someone                            │
│                                          │
│ Who do you want to tip?                  │
│                                          │
│ [ Search X username...                 ] │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ 👤 Zooko Wilcox [ Verified ✓ ]       │ │
│ │ @zooko · 142K followers              │ │
│ └──────────────────────────────────────┘ │
│                                          │
│             [ Continue ]                 │
└──────────────────────────────────────────┘
```

### Step 2: Tip Amount & Presets
```text
┌──────────────────────────────────────────┐
│ ← Tip @zooko                             │
│                                          │
│ Amount                                   │
│                                          │
│             0.25 ZEC                     │
│            (~$11.20 USD)                 │
│                                          │
│  [0.05]  [0.10]  [0.25]  [0.50]  [Custom]│
│                                          │
│ Message (optional)                       │
│ ┌──────────────────────────────────────┐ │
│ │ Thanks for your work on Zcash!       │ │
│ └──────────────────────────────────────┘ │
│                                          │
│              [ Continue ]                │
└──────────────────────────────────────────┘
```

### Step 3: Tip Privacy Option
```text
┌──────────────────────────────────────────┐
│ Tip visibility                           │
│                                          │
│ ○ Show my identity                       │
│   @alice will be shown to @zooko         │
│                                          │
│ ● Keep me private                        │
│   Your X identity won't be shown to Zooko│
│                                          │
│              [ Continue ]                │
└──────────────────────────────────────────┘
```

### Step 4: Tip Confirmation (Explicit Financial Action)
```text
┌──────────────────────────────────────────┐
│ Confirm tip                              │
│                                          │
│              0.25 ZEC                    │
│                                          │
│ Sending to                               │
│ @zooko                                   │
│                                          │
│ Your identity                            │
│ Private (Anonymous)                      │
│                                          │
│ Message                                  │
│ Thanks for your work on Zcash!           │
│                                          │
│ ──────────────────────────────────────── │
│                                          │
│ You will send                            │
│ 0.25 ZEC                                 │
│                                          │
│          [ Confirm tip ]                 │
└──────────────────────────────────────────┘
```

### Step 5: Payment / Wallet Handoff
```text
┌──────────────────────────────────────────┐
│ Pay with Zcash                           │
│                                          │
│ 0.25 ZEC                                 │
│                                          │
│ Choose how to pay:                       │
│                                          │
│ [ 🦊 Pay with Noir Extension ]           │
│                                          │
│ [ 📱 Open in Zodl App ]                  │
│                                          │
│ Or scan QR code:                         │
│ ┌──────────────────────────────────────┐ │
│ │             [ QR CODE ]              │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [ 📋 Copy payment address ]              │
│                                          │
│ Waiting for payment...                   │
└──────────────────────────────────────────┘
```

### Step 6: Payment Waiting State
```text
┌──────────────────────────────────────────┐
│ Waiting for payment                      │
│                                          │
│              0.25 ZEC                    │
│                                          │
│ Send the payment from your Zcash wallet. │
│                                          │
│       Waiting for confirmation…          │
│                                          │
│ Payment status                           │
│ ● Waiting                                │
│ ○ Confirmed (3 blocks)                   │
│ ○ Completed                              │
└──────────────────────────────────────────┘
```

### Step 7: Understated Success State
```text
┌──────────────────────────────────────────┐
│                                          │
│             Tip sent                     │
│                                          │
│             0.25 ZEC                     │
│                                          │
│             to @zooko                    │
│                                          │
│ Zooko can claim this payment after       │
│ joining XTip and verifying his X account.│
│                                          │
│ [ Share on X ]      [ Copy claim link ]  │
│                                          │
│              [ Done ]                    │
└──────────────────────────────────────────┘
```

---

# 6. Tips Page & Claim Flow

### Tips Overview
```text
┌──────────────────────────────────────────┐
│ Tips                                     │
│                                          │
│ [Sent] [Received]                        │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ @zooko                               │ │
│ │ 0.25 ZEC                             │ │
│ │ Sent · Pending claim                 │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Private sender                       │ │
│ │ 0.50 ZEC                             │ │
│ │ Received · Ready to claim            │ │
│ │ [ Claim tip ]                        │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### Claim Screen (Bob's View)
```text
┌──────────────────────────────────────────┐
│ Claim your tip                           │
│                                          │
│ 0.50 ZEC                                 │
│                                          │
│ Where should we send it?                 │
│                                          │
│ Zcash receiving address                  │
│ ┌──────────────────────────────────────┐ │
│ │ u1test1... (Paste Shielded Address)  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [ 🦊 Auto-fill with Noir ]               │
│                                          │
│ Your address is used only to deliver     │
│ this payment directly to your wallet.    │
│                                          │
│ [ Claim 0.50 ZEC ]                       │
└──────────────────────────────────────────┘
```

---

# 7. Private Request Flow

### Create Request
```text
┌──────────────────────────────────────────┐
│ Request money                            │
│                                          │
│ Who are you requesting from?             │
│ [ @bob                                 ] │
│                                          │
│ Amount                                   │
│ 0.50 ZEC                                 │
│                                          │
│ Reason (optional)                        │
│ [ Invoice for design work              ] │
│                                          │
│ Your Shielded Receiving Address          │
│ [ u1alice...                           ] │
│                                          │
│ [ Create request ]                       │
└──────────────────────────────────────────┘
```

### Request Details (Bob's View)
```text
┌──────────────────────────────────────────┐
│ Payment request                          │
│                                          │
│ From @alice                              │
│                                          │
│ 0.50 ZEC                                 │
│ "Invoice for design work"                │
│                                          │
│ [ Pay request ]                          │
│ [ Decline ]                              │
└──────────────────────────────────────────┘
```

---

# 8. Private Payment Link Flow

### Create Payment Link
```text
┌──────────────────────────────────────────┐
│ Get paid                                 │
│                                          │
│ Amount                                   │
│ 1.00 ZEC                                 │
│                                          │
│ Description                              │
│ [ Website design                       ] │
│                                          │
│ Your Shielded Address                    │
│ [ u1alice...                           ] │
│                                          │
│ [ Create payment link ]                  │
└──────────────────────────────────────────┘
```

### Payment Link Public Landing Page (`xtip.app/pay/<id>`)
```text
┌──────────────────────────────────────────┐
│ XTip                                     │
│                                          │
│ Payment request                          │
│                                          │
│              1.00 ZEC                    │
│                                          │
│ Website design                           │
│                                          │
│ Pay privately with Zcash.                │
│                                          │
│ [ Pay with Zcash ]                       │
│                                          │
│ No XTip account required.                │
└──────────────────────────────────────────┘
```

---

# 9. Payments Activity & Details

### Payments Activity Feed
```text
┌──────────────────────────────────────────┐
│ Payments                                 │
│                                          │
│ Today                                    │
│                                          │
│ Tip to @zooko               -0.25 ZEC    │
│ Payment request from @alice +0.50 ZEC    │
│                                          │
│ Yesterday                                │
│                                          │
│ Payment link invoice        +1.00 ZEC    │
│                                          │
└──────────────────────────────────────────┘
```

### Payment Details
```text
┌──────────────────────────────────────────┐
│ Payment details                          │
│                                          │
│ Amount:      0.25 ZEC                    │
│ Type:        Tip                         │
│ Status:      Completed                   │
│ Recipient:   @zooko                      │
│ Date:        Oct 8, 2026                 │
│                                          │
│ [ View transaction details ]             │
└──────────────────────────────────────────┘
```

---

# 10. Settings & Profile

```text
Settings

Account
  X account: @alice (Connected ✓)

Wallet
  Default Shielded Address: u1alice...48a2

Privacy
  Default tip visibility: Private

Notifications

About & Support
```

---

# 11. Design System Tokens

```typescript
export const themeTokens = {
  colors: {
    bgCanvas: '#FAF7F2',       // Warm Cream / Ivory
    surface: '#FFFFFF',        // Pearl White
    surfaceBorder: '#EFE8DC',  // Soft Sand Border
    textPrimary: '#1E1315',    // Deep Espresso Brown
    textSecondary: '#6B5B5E',  // Warm Muted Sepia
    accentGold: '#F4B728',     // Zcash Radiant Gold (Primary CTA)
    accentGoldHover: '#E5A81A',
    accentDark: '#2A1A1E',     // Secondary Espresso Button
    divider: '#EAE0D0',
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    monoFamily: 'JetBrains Mono, monospace', // For ZEC numbers
    scale: {
      display: '36px',
      heading: '24px',
      section: '18px',
      body: '16px',
      secondary: '14px',
      caption: '12px',
    }
  },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  borderRadius: {
    small: '8px',
    input: '10px',
    card: '12px',
    dialog: '16px',
    surface: '20px',
  }
};
```

---

# 12. Reusable Component Inventory

Before assembling pages, implement these core components:

```text
- Button (Primary Gold / Secondary Dark / Ghost / Destructive)
- Input (Text / Username Search)
- AmountInput (Large ZEC display + USD subtitle)
- Avatar (X Profile Picture + Verified Badge)
- XProfileCard (Interactive preview card)
- PaymentCard (Activity item)
- TipCard (Sent / Received tip item)
- RequestCard (Pending / Accepted request)
- StatusBadge (Pending / Funded / Claimed / Completed)
- Modal & Dialog (Confirmation & Wallet QR Handoff)
- QRDisplay (Clean ZIP-321 QR container with copy button)
- EmptyState (Minimal text + single action button)
- SkeletonLoader (Subtle cream pulsing placeholder)
```

---

# 13. Semantic Status System

- **Tips:** `Pending` | `Funded` | `Claimed`
- **Requests:** `Pending` | `Paid` | `Declined`
- **Payments:** `Waiting` | `Confirming` | `Completed` | `Failed`

---

# 14. Design Review Checklist

Before approving any UI component or page, verify:
- [ ] Does it use the **Warm Cream (`#FAF7F2`) + Espresso (`#1E1315`) + Gold (`#F4B728`)** palette?
- [ ] Is the primary action immediately obvious?
- [ ] Is all AI imagery and decorative crypto clutter absent?
- [ ] Is technical crypto jargon replaced with plain human verbs?
- [ ] Is the amount prominently formatted with monospaced numerals?
- [ ] Does the screen fit and function gracefully on mobile?
- [ ] Can a non-technical Twitter user understand what will happen before clicking?
