# XTip UI Rules & Design System Specification

> **"Simple on the surface. Powerful underneath."**  
> XTip is a private payment product, not a crypto dashboard.  
> Every UI element must earn its place.  
> **Golden Rule:** If an element doesn't help the user understand, decide, or act — remove it.

---

## Hard Bans (Zero Tolerance)
- ❌ **NO AI aesthetics:** No AI icons, sparkle icons, robot heads, "magic AI" language, or neural network graphics.
- ❌ **NO AI-generated images:** No AI illustrations, stock photos, 3D floating crypto coins, or cliché blockchain imagery.
- ❌ **NO visual clutter:** No decorative tags, unnecessary badges, excessive gradients, or heavy glassmorphism.
- ❌ **NO crypto jargon:** No raw hashes, RPC terminology, or "broadcast shielded transaction" where human language works ("Send tip").
- ❌ **NO animation spam:** No confetti, bouncing buttons, or particle effects.
- ❌ **NO inconsistent styling:** No mixing icon sets (strictly Lucide only), no random corner radiuses, and no arbitrary font sizes.

---

## 1. Visual Identity & Palette

### Primary Palette Tokens
- **Background (Canvas):** Warm Cream / Ivory (`#FAF7F2`)
- **Card / Surface:** Pure Pearl White (`#FFFFFF`, subtle border: `#EFE8DC`, clean `rounded-xl`)
- **Primary Text:** Deep Espresso Dark Brown (`#1E1315`)
- **Secondary / Subtitle Text:** Warm Muted Sepia (`#6B5B5E`)
- **Primary Action Accent:** Radiant Zcash Gold (`#F4B728`, hover: `#E5A81A`, text: `#1E1315`)
- **Secondary Action Accent:** Deep Espresso (`#2A1A1E`, hover: `#1E1315`, text: `#FAF7F2`)
- **State Borders & Dividers:** Subtle Sand Divider (`#EAE0D0`)

---

## 2. Typography Hierarchy

Single unified font family: **Inter** / **Geist Sans** (with monospaced tabular numerals for financial figures).

| Role | Class / Size | Weight | Usage |
|---|---|---|---|
| **Display** | `text-3xl` / `text-4xl` (32px / 36px) | Bold (`font-bold`) | Key hero headers & major numbers |
| **Heading** | `text-xl` / `text-2xl` (20px / 24px) | SemiBold (`font-semibold`) | Card titles, section headers |
| **Body** | `text-base` (16px) | Normal (`font-normal`) | General descriptions & inputs |
| **Label** | `text-sm` (14px) | Medium (`font-medium`) | Form labels, button text, table headers |
| **Caption** | `text-xs` (12px) | Medium (`font-medium`) | Timestamps, secondary helper text |
| **Amount** | `font-mono tracking-tight` | SemiBold (`font-semibold`) | ZEC amounts (e.g. `0.25 ZEC`) |

---

## 3. Financial UX Rules

1. **Prominent Amounts:** Always make the ZEC amount the most legible element on payment screens.
2. **Clear Fiat Equivalence:** Subtly display estimated USD beneath ZEC in muted sepia (`0.5 ZEC` with `~$22.40 USD`).
3. **Explicit Sender & Recipient:** Always clearly display who is paying and who is receiving before committing.
4. **Action Confirmation:** Require explicit confirmation before irreversible transactions:
   ```text
   You're tipping
   @bob
   0.25 ZEC

   Bob will receive
   0.25 ZEC

   [ Confirm tip ]
   ```
5. **Human Language Over Jargon:**
   - Instead of *"Broadcast shielded transaction"* $\rightarrow$ **"Send tip"**
   - Instead of *"Awaiting chain finality"* $\rightarrow$ **"Waiting for payment confirmation"**
   - Instead of *"Execute atomic claim"* $\rightarrow$ **"Claim tip"**

---

## 4. Status Badges & State Tags

Badges are used **only** to communicate meaningful status. If removing the badge does not reduce understanding, remove it.

| Status | Visual Treatment | Text |
|---|---|---|
| `Pending` | Soft Cream/Amber tint (`bg-amber-100 text-amber-900 border-amber-200`) | `Pending` |
| `Funded` / `Ready` | Soft Emerald tint (`bg-emerald-100 text-emerald-900 border-emerald-200`) | `Ready to claim` |
| `Claimed` | Soft Gray tint (`bg-stone-100 text-stone-700 border-stone-200`) | `Claimed` |
| `Cancelled` | Soft Rose tint (`bg-rose-100 text-rose-800 border-rose-200`) | `Cancelled` |

---

## 5. Buttons & Interactive Elements

- **Button Sizing:** Standard touch targets (minimum `44px` height on mobile, `h-11` or `h-12`).
- **Corner Radius:** Standardized `rounded-xl` (12px) across all buttons, inputs, and cards.
- **Action Verbs:**
  - `Send tip`
  - `Request payment`
  - `Pay request`
  - `Claim tip`
  - `Connect wallet`
  - `Confirm payment`
  - `Decline request`
- **Avoid Vague Labels:** Never use *"Proceed"*, *"Execute"*, *"Process"*, or *"Submit"*.

---

## 6. Navigation Architecture

Strictly minimalist top bar:
```text
[ XTip Logo ]                     [ Tips ]   [ Requests ]   [ Links ]      [ Login with X / Profile ]
```
Mobile bottom bar:
```text
[ 🏠 Home ]        [ 💸 Tips ]        [ 📩 Requests ]        [ 🔗 Links ]        [ 👤 Account ]
```

---

## 7. Privacy UX Standard

- **No Over-Lecturing:** Do not turn every screen into a cryptography essay.
- **Clear Toggle:** Clean, simple checkbox/switch for `[x] Tip anonymously`.
- **Restrained Address Display:** Truncate long shielded addresses (`u1test1...48a2`) with a one-click copy icon.

---

## 8. Form Standards & Validation

- Immediate inline validation (e.g. green checkmark when `@username` resolves).
- Keep form fields strictly minimal:
  - Tipping: `Recipient (@username)` + `Amount (ZEC)` + optional `Private Memo`.
  - Claiming: `Your Shielded Zcash Address (u1...)`.
- Preserve input values on validation error.

---

## 9. Animation & Feedback

- **Transitions:** Fast, subtle transitions (`duration-150 ease-out`).
- **Confirmation:** Single smooth checkmark reveal upon payment broadcast, then display the transaction receipt cleanly. Zero confetti, zero 3D particles.
