# ApnaDabba — Module Flows

> This file documents the finalized flow for each module.
> Each flow is validated and approved before implementation.
> Status: `DRAFT` | `FINALIZED` | `IN_PROGRESS` | `IMPLEMENTED`

---

## Module 1 — Customer Authentication

**Status:** `FINALIZED` (awaiting implementation)

### Objective
Replace phone-based authentication with email-based authentication across registration, login, and password management.

### Schema Changes

**`users` table — ADD:**
- `email` — `String @unique @db.VarChar(255)` — primary login identifier
- `email_verified_at` — `DateTime?` — reserved for future email verification

**`users` table — MODIFY:**
- `phone` — make nullable (`String?`) — kept for operational/delivery contact only

**`otp_sessions` table — ADD:**
- `email` — `String @db.VarChar(255)` — email to which OTP was sent
- `purpose` — `String @db.VarChar(50)` — values: `FORGOT_PASSWORD`
- Index on `[email, purpose, expires_at]`

### Flows

#### 1. Registration
```
POST /auth/register { email, password, first_name, last_name }
  → Validate: email format, password >= 8 chars, name required
  → Check: email not already in use
  → Role defaults to CUSTOMER (ADMIN blocked in public route)
  → Create user with bcrypt hash (salt rounds 10)
  → Issue JWT access token (15min) + refresh token (7 days, SHA-256 hashed)
  → Returns: 201 { user, tokens }
```

#### 2. Login
```
POST /auth/login { email, password }
  → Rate limit: 5 attempts per 15 minutes
  → Lookup user by email
  → Check: user.is_active (403 ACCOUNT_DISABLED if false)
  → Verify bcrypt password (500ms artificial delay on failure)
  → Issue JWT access token + refresh token
  → Returns: 200 { user, tokens, force_password_change }
```

#### 3. Forgot Password (OTP via Email)
```
POST /auth/forgot-password { email }
  → Lookup user by email; if not found, return 200 (prevent enumeration)
  → Rate limit: 5 OTP sends per email per hour
  → Generate 6-digit OTP
  → Hash OTP, store in otp_sessions (purpose=FORGOT_PASSWORD, expires_at=10min)
  → Send email via nodemailer
  → Returns: 200 { message: "OTP sent to email" }
```

#### 4. Reset Password
```
POST /auth/reset-password { email, otp, new_password }
  → Validate: OTP not expired, not used, matches hash, same email + purpose
  → Mark OTP as used
  → Validate: new_password >= 8 characters
  → Update password_hash with new bcrypt hash
  → Revoke ALL refresh tokens for user (forces re-login on all devices)
  → Returns: 200 { message: "Password reset successful" }
```

#### 5. Change Password (Authenticated)
```
POST /auth/change-password { old_password, new_password }
  → requireAuth middleware
  → Verify old_password matches stored hash
  → Validate: new_password >= 8 characters, different from old
  → Update password_hash
  → Revoke ALL refresh tokens for user except current session
  → Returns: 200 { message: "Password changed successfully" }
```

#### 6. Token Refresh
```
POST /auth/refresh { refresh_token }
  → Rate limit: 10 attempts per 15 minutes
  → Hash incoming token, look up in refresh_tokens table
  → Check: not revoked, not expired (15s tolerance), user active
  → Begin transaction:
    → UpdateMany where id=token.id AND revoked=false → set revoked=true
    → If count 0 → THROW TOKEN_REUSED (reuse detection)
    → Insert new refresh token for user
  → Returns: 200 { access_token, refresh_token }
```

#### 7. Logout
```
POST /auth/logout { refresh_token }
  → requireAuth middleware
  → Hash token, look up
  → Verify token.user_id matches authenticated user
  → Revoke token
  → Returns: 200 { message: "Logged out successfully" }
```

#### 8. Logout All
```
POST /auth/logout-all
  → requireAuth middleware
  → Revoke ALL non-revoked refresh tokens for user
  → Returns: 200 { message: "Logged out from all devices" }
```

### Security Rules
| Concern | Mitigation |
|---|---|
| OTP brute-force | 3 OTP verification attempts per email per 10min; 5 OTP sends per email per hour |
| OTP expiry | 10-minute TTL on OTP |
| Public ADMIN registration | Server blocks role=ADMIN in public `/register` route |
| Token revocation on password reset | All refresh tokens revoked — forces re-login on all devices |
| Login rate limiting | 5 attempts/15min per IP (already implemented) |
| Refresh token reuse detection | Transactional atomic revoke + check pattern (already implemented) |
| Email enumeration | Forgot password returns 200 even if email not found |
| Password storage | bcrypt with salt rounds 10 |

### Dependencies
- `nodemailer` + `@types/nodemailer` — email sending
- SMTP configuration in `.env` (HOST, PORT, USER, PASS, FROM)

### Testing Strategy
| Test Type | Cases |
|---|---|
| Happy path | Register → Login → Refresh → Change Password → Logout |
| | Forgot Password → OTP → Reset Password → Login with new password |
| Validation | Invalid email format, short password, missing name |
| Permission | Register with ADMIN role → 403 |
| Security | Wrong OTP, expired OTP, reused OTP, reused refresh token |
| Edge case | Login with unregistered email, reset password with wrong email |

---

## Module 2 — Subscription (Customer Flow)

**Status:** `FINALIZED`

### Objective
Enable a customer to browse active plans, provide delivery address, and subscribe to a plan. A customer can subscribe to multiple plans at any time — each subscription is fully independent.

### Schema Changes

**`plan_configs` table — ADD:**
| Field | Type | Notes |
|---|---|---|
| `duration_days` | `Int` | e.g., 7, 15, 30. Used to calculate end_date = start_date + duration_days - 1 |

**`delivery_addresses` table — ADD:**
| Field | Type | Notes |
|---|---|---|
| `label` | `String? @db.VarChar(20)` | "Home", "Work", "Other" |

### Flows

#### 1. Browse Active Plans (Public)
```
GET /plans
  → No auth required
  → Fetch all plan_configs where is_active = true
  → Return: { id, name, description, price_per_meal, security_deposit,
              skip_limit, buffer_days, duration_days }
```

#### 2. Subscribe to a Plan (Authenticated Customer)
```
POST /subscriptions { plan_id, address_line_1, address_line_2?, landmark?, city, pincode, lat?, lng?, label? }
  → requireAuth (CUSTOMER role)
  → Validate plan exists + is_active
  → BEGIN TRANSACTION:
    → Create delivery_address (user_id = req.user.id, is_active = true)
    → Calculate: start_date = today, end_date = today + plan.duration_days - 1
    → Create subscription:
        - user_id, plan_config_id, delivery_address_id
        - status = ACTIVE
        - start_date, end_date (auto-calculated)
        - skip_balance = plan.skip_limit
        - skipped_meal_pool = 0
        - All snapshot fields copied from plan_configs (immutable)
    → Create subscription_wallet (balance = 0, security_deposit_held = plan.security_deposit)
    → Create tiffin_tracker (tiffins_due = 0, security_deducted = false)
    → Create audit_log: CUSTOMER_SUBSCRIBED
  → END TRANSACTION
  → Returns: 201 { subscription, wallet }
```

#### 3. View My Subscriptions (Authenticated Customer)
```
GET /my-subscriptions
  → requireAuth (CUSTOMER)
  → Fetch all subscriptions for user (any status), ordered by created_at desc
  → Include: plan_configs, delivery_addresses, subscription_wallets
  → Returns: 200 { subscriptions[] }
```

### Business Rules
| Rule | Detail |
|---|---|
| Multiple subscriptions | Allowed — no overlap check. Each is fully independent with own wallet, tiffin tracker, deliveries |
| Plan snapshots | All plan values copied at creation — plan config changes don't affect active subscriptions |
| Delivery address | Created fresh per subscription, linked to user |
| Wallet | Starts at ₹0 — funded via payment/top-up (to be defined) |
| Duration | end_date = start_date + duration_days - 1 |

### Edge Cases
| Case | Handling |
|---|---|
| Plan deactivated mid-flow | Plan fetched inside transaction — if inactive, throw INVALID_PLAN |
| Address creation fails | Transaction rollback — subscription not created |
| Multiple subscriptions same address | Allowed — each subscription has its own delivery_address record |

### Architecture
```
Route:    GET /plans              → Controller: listActivePlans    → Service: getAllActivePlans
Route:    POST /subscriptions     → Controller: subscribeUser      → Service: subscribeUser
Route:    GET /my-subscriptions   → Controller: getMySubscriptions → Service: getMySubscriptions
```

### Testing Strategy
| Test Type | Cases |
|---|---|
| Happy path | Browse plans → Select plan → Subscribe → View subscriptions |
| Validation | Invalid plan_id, missing address fields, inactive plan |
| Permission | Unauthenticated user tries to subscribe |
| Edge case | Subscribe to multiple plans simultaneously |
| Edge case | Subscribe to a deactivated plan |

---

## Module 8 — Delivery Generation Engine

**Status:** `FINALIZED`

### Objective

Automatically generate daily meal deliveries for all active and buffer subscriptions across BREAKFAST, LUNCH, and DINNER slots, without any admin intervention. The engine runs on a cron schedule, checks subscription eligibility, wallet balance, tiffin debt, and creates delivery records with appropriate statuses.

### Cron Schedule

| Time | Action |
|------|--------|
| 12:01 AM | `runPlanExpiryCron()` — transition expired ACTIVE subscriptions to BUFFER |
| 12:02 AM | `runBufferExpiryCron()` — transition expired BUFFER subscriptions to EXPIRED |
| 05:00 AM | Generate BREAKFAST deliveries for today |
| 09:00 AM | Generate LUNCH deliveries for today |
| 02:00 PM | Generate DINNER deliveries for today |

### Architecture

```
node-cron (in-process)
  → deliveryCron.generateSlot(slot)
    → deliveryService.generateDeliveriesForSlot(targetDate, slot)
      → prisma.$transaction (batched, 500 per batch)
```

### Generation Logic

#### Step 1 — Query qualifying subscriptions

Fetch subscriptions matching ANY of:
- `status = "ACTIVE"` AND `start_date <= today` AND `end_date >= today`
- `status = "BUFFER"` AND `buffer_expiry_date >= today` AND `buffer_meals_remaining > 0`
- AND `users.is_active = true`
- AND `meal_category` matches target slot:

| Slot | Matching meal_category values |
|------|-----------------------------|
| BREAKFAST | `BREAKFAST`, `ALL_THREE` |
| LUNCH | `LUNCH`, `LUNCH_DINNER`, `ALL_THREE` |
| DINNER | `DINNER`, `LUNCH_DINNER`, `ALL_THREE` |

#### Step 2 — Process in batches (up to 500 subscriptions per batch)

For each subscription, in order:

| Order | Step | Condition | Action |
|-------|------|-----------|--------|
| 1 | **Duplicate check** | Delivery exists for `[subscription_id, today, slot]` | SKIP — log warning, continue |
| 2 | **Tiffin debt check** | `tiffins_due >= 2` | status = `BLOCKED_TIFFIN_DEBT` |
| 3 | **Wallet check** | `wallet.balance < price_per_meal_snapshot` | status = `BLOCKED_LOW_WALLET` |
| 4 | **Default** | None of the above | status = `PENDING` |
| 5 | **Buffer handling** | Subscription is BUFFER | `is_buffer_meal = true`, `buffer_meals_remaining -= 1` |

#### Step 3 — Create delivery record

```
deliveries.create({
  subscription_id,
  delivery_date: today,
  slot,                           // "BREAKFAST" | "LUNCH" | "DINNER"
  status,                         // Determined above
  cutoff_time,                    // From system_configs or hardcoded default
  is_buffer_meal,                 // true if BUFFER subscription
  address_id: subscription.delivery_address_id,
  created_at: now(),
  updated_at: now()
})
```

#### Step 4 — Log generation summary

After batch completes, log:
- Total subscriptions processed
- Deliveries created
- Duplicates skipped
- Blocked by tiffin debt
- Blocked by low wallet
- Errors encountered

### Cutoff Times

| Slot | Cutoff Time | Notes |
|------|------------|-------|
| BREAKFAST | 20:00 day before (8 PM previous day) | Skip cutoff for BREAKFAST |
| LUNCH | 09:00 same day (9 AM) | Skip cutoff for LUNCH |
| DINNER | 15:00 same day (3 PM) | Skip cutoff for DINNER |

Cutoff times are initially hardcoded with defaults per the table above. The `system_configs` table will be seeded with corresponding keys for future admin configurability:
- `skip_cutoff_breakfast_hours`
- `skip_cutoff_lunch_hours`
- `skip_cutoff_dinner_hours`

### Status Priority

When multiple blocking conditions apply, the highest-priority status is used:

1. `BLOCKED_TIFFIN_DEBT` (highest — physical asset recovery needed)
2. `BLOCKED_LOW_WALLET` (financial constraint)
3. `PENDING` (default — ready for dispatch)

### Delivery Statuses Used

| Status | Description |
|--------|-------------|
| `PENDING` | Created, awaiting dispatch |
| `BLOCKED_TIFFIN_DEBT` | Customer has ≥2 tiffins outstanding |
| `BLOCKED_LOW_WALLET` | Wallet balance < meal price |
| `SKIPPED` | Customer skipped before cutoff |
| `DISPATCHED` | Out for delivery (set by dispatch flow, not this module) |
| `DELIVERED` | Completed successfully |
| `FAILED` | Delivery could not be completed |
| `EXPIRED_BUFFER` | Buffer meal expired before delivery |

### Database Impact

| Entity | Change | Detail |
|--------|--------|--------|
| `deliveries.slot` | Accept `BREAKFAST` | Currently only `LUNCH`/`DINNER` — add `BREAKFAST` to allowed values |
| `deliveries.status` | Add `BLOCKED_LOW_WALLET` | New status value for wallet-blocked deliveries |
| `system_configs` | Seed cutoff time keys | Keys: `skip_cutoff_breakfast_hours`, `skip_cutoff_lunch_hours`, `skip_cutoff_dinner_hours` with default values |
| No new tables needed | — | Uses existing `deliveries`, `subscriptions`, `subscription_wallets`, `tiffin_tracker` |

### API Impact

| Endpoint | Change |
|----------|--------|
| `POST /api/v1/deliveries/generate` | **Kept** as manual fallback / testing trigger. Admin-only. |

No new API endpoints required.

### Out of Scope (handled by other modules)

| Feature | Module |
|---------|--------|
| Route optimization | Deferred |
| Dispatch / location-lock flow | TBD |
| Addon/guest meal linking at generation | Deferred |
| Driver assignment | Module 12 |
| Notifications on delivery generation | Module 20 |

### Edge Cases

| Case | Handling |
|------|----------|
| Subscription starts today | `start_date <= today` includes it — delivery generated |
| Subscription ends today | `end_date >= today` includes it — delivery generated |
| Buffer expires on generation date | `buffer_expiry_date >= today` includes it — generated (check happens before expiry cron at 12:02 AM) |
| User disabled mid-cycle | `users.is_active = true` filter excludes them |
| Subscription cancelled mid-period | Won't match ACTIVE status query |
| Multiple cron triggers same slot | Unique constraint `[subscription_id, delivery_date, slot]` prevents duplicates |
| `buffer_meals_remaining` reaches 0 mid-batch | Checked per subscription — if 0, delivery not created |
| Admin triggers generation manually for past date | Controller validates date is parseable but doesn't prevent past dates — acceptable for testing/fixes |

### Testing Strategy

| Test Type | Cases |
|-----------|-------|
| Happy path | BREAKFAST cron generates deliveries for BREAKFAST subs |
| | LUNCH cron generates deliveries for LUNCH subs |
| | DINNER cron generates deliveries for DINNER subs |
| | Buffer subs get `is_buffer_meal = true` |
| Validation | Inactive user excluded |
| | Expired subscription excluded |
| | Buffers with 0 meals remaining excluded |
| | Duplicate generation skipped (idempotent) |
| Blocking | Subscription with `tiffins_due >= 2` → `BLOCKED_TIFFIN_DEBT` |
| | Subscription with low wallet → `BLOCKED_LOW_WALLET` |
| | Both conditions → `BLOCKED_TIFFIN_DEBT` (higher priority) |
| Scalability | 100K subscriptions processed without timeout |
| | Batches of 500 don't overflow memory |
| Cron | Schedule fires at correct times |
| | Manual POST endpoint still works |

## Module 3 — Plan Management

**Status:** `FINALIZED`

### Objective

Enable admin to manage subscription plans (create, read, update, activate, deactivate) and customers to browse active plans. Plan configs serve as templates — all values are snapshotted at subscription creation and remain immutable for that cycle. Plan changes affect only new subscriptions and renewals.

### Schema

#### `plan_configs` table — Full Definition

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `plan_code` | `String @unique @db.VarChar(60)` | Business key — e.g., WEEKLY_SINGLE |
| `name` | `String @db.VarChar(120)` | Display name |
| `description` | `String?` | Free text |
| `duration_days` | `Int` | 1, 7, 15, or 30 |
| `meal_combination` | `String @db.VarChar(20)` | `SINGLE` / `COMBO` / `BREAKFAST` / `TRIAL` / `TRIAL_SPECIAL` |
| `price_per_meal` | `Decimal(10,2)` | Per-meal price |
| `total_price` | `Decimal(10,2)` | Pre-calculated total |
| `security_deposit` | `Decimal(10,2)` | Default 500, 0 for trials |
| `skip_limit` | `Int?` | Nullable. `null` = flexible skip (monthly plans) |
| `is_flexible_skip` | `Boolean @default(false)` | `true` for monthly plans |
| `flexible_skip_max_per_day` | `Int @default(1)` | Max skips per day for flexible plans |
| `buffer_days` | `Int @default(0)` | 0 for trials, 3/7/15 for others |
| `special_meal_count` | `Int @default(0)` | Included count for INCLUDED_COUNT rule |
| `special_meal_rule` | `String @default("NONE")` | `NONE` / `INCLUDED_COUNT` / `SCHEDULE_BASED` |
| `is_active` | `Boolean @default(true)` | Soft delete |
| `created_at` | `DateTime @default(now())` | |
| `updated_at` | `DateTime @updatedAt` | |

### Seed Plans

| Plan Code | Days | Combo | Price/Meal | Total | Deposit | Skips | Flexible | Buffer | Special |
|-----------|------|-------|------------|-------|---------|-------|----------|--------|---------|
| TRIAL_STD | 1 | TRIAL | 99 flat | 99 | 0 | 0 | false | 0 | NONE |
| TRIAL_SPL | 1 | TRIAL_SPECIAL | 129 flat | 129 | 0 | 0 | false | 0 | NONE |
| WEEKLY_SINGLE | 7 | SINGLE | 90 | 630 | 500 | 2 | false | 3 | 1 INCLUDED_COUNT |
| WEEKLY_COMBO | 7 | COMBO | 90 | 1,260 | 500 | 4 | false | 3 | 2 INCLUDED_COUNT |
| WEEKLY_BREAKFAST | 7 | BREAKFAST | 90 | 630 | 500 | 2 | false | 3 | 1 INCLUDED_COUNT |
| HALF_SINGLE | 15 | SINGLE | 80 | 1,200 | 500 | 5 | false | 7 | 2 INCLUDED_COUNT |
| HALF_COMBO | 15 | COMBO | 80 | 2,400 | 500 | 10 | false | 7 | 4 INCLUDED_COUNT |
| HALF_BREAKFAST | 15 | BREAKFAST | 80 | 1,200 | 500 | 5 | false | 7 | 2 INCLUDED_COUNT |
| MONTHLY_SINGLE | 30 | SINGLE | 70 | 2,100 | 500 | null | true | 15 | SCHEDULE_BASED |
| MONTHLY_COMBO | 30 | COMBO | 70 | 4,200 | 500 | null | true | 15 | SCHEDULE_BASED |
| MONTHLY_BREAKFAST | 30 | BREAKFAST | 70 | 2,100 | 500 | null | true | 15 | SCHEDULE_BASED |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `GET` | `/api/v1/subscriptions/plans` | None | Public | List active plans |
| `GET` | `/api/v1/subscriptions/plans/:id` | None | Public | View single active plan |
| `POST` | `/api/v1/admin/plans` | JWT | ADMIN | Create plan |
| `GET` | `/api/v1/admin/plans` | JWT | ADMIN | List all plans (active + inactive) |
| `GET` | `/api/v1/admin/plans/:id` | JWT | ADMIN | View any plan by ID |
| `PUT` | `/api/v1/admin/plans/:id` | JWT | ADMIN | Update plan |
| `PATCH` | `/api/v1/admin/plans/:id/activate` | JWT | ADMIN | Activate plan |
| `PATCH` | `/api/v1/admin/plans/:id/deactivate` | JWT | ADMIN | Deactivate plan |

### Business Rules

| Rule | Detail |
|------|--------|
| Plan values are templates | All values snapshotted at subscription creation. Edits to plan_configs never modify active subscriptions. |
| Edits apply to next cycle | Changes take effect on: (a) new subscriptions, (b) renewals of existing subscriptions |
| Deactivation | `is_active = false` — hidden from browse, new subscriptions blocked. Existing subs complete their cycle. Renewal prevented. |
| Reactivation | `is_active = true` — plan reappears, new subscriptions and renewals resume. |
| Admin can edit any field | All fields including plan_code, pricing, skip/buffer/special meal settings. |
| Unique plan_code | Enforced at DB + service level. |
| No hard delete | FK constraint with subscriptions. Use deactivation instead. |

### Plan -> Subscription Flow

```
Admin edits plan_configs
        |
        v
  plan_configs (source of truth)
        |
        |-- Sub A (created Jan 1) -- snapshots: 90, 2, 3
        |       |-- Renewal on Feb 1 -- fresh snapshots from current plan_configs
        |
        |-- Sub B (created Feb 15) -- snapshots: current config
        |
        +-- Admin edits price to 95 on Feb 20
                |
                Sub A still at 90 (until renewal)
                Sub B still at 90 (snapshotted at Feb 15)
                New subscriptions from Feb 20: 95
```

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **Module 2** (Subscription) | `duration_days` used for `end_date = start_date + duration_days - 1`. `meal_combination` maps to subscription `meal_category`. All snapshot fields copied at creation. |
| **Module 8** (Delivery Gen) | `meal_combination` determines which slots generate deliveries. `price_per_meal` (via snapshot) for wallet check. `skip_limit`/`is_flexible_skip` governs skip behavior. `buffer_days` sets buffer window. `special_meal_rule` flags special meal deliveries. |

### Frontend Impact

| Page | Description |
|------|-------------|
| Customer - Browse Plans | Pricing card grid by duration (Trial / Weekly / Half / Monthly) |
| Customer - Plan Detail | Full plan info with Subscribe CTA |
| Admin - Plan List | Table with status badge, quick-toggle active/inactive |
| Admin - Plan Create/Edit | Full form with validation |

### Validation Rules

| Field | Rule |
|-------|------|
| `plan_code` | Required, unique, alphanumeric + underscores, max 60 |
| `name` | Required, max 120 |
| `duration_days` | Required, must be 1, 7, 15, or 30 |
| `meal_combination` | Required, one of: SINGLE, COMBO, BREAKFAST, TRIAL, TRIAL_SPECIAL |
| `price_per_meal` | Required, > 0 |
| `total_price` | Required, > 0 |
| `security_deposit` | Required, >= 0 |
| `skip_limit` | Optional (nullable), >= 0 if provided |
| `buffer_days` | Required, >= 0 |
| `special_meal_count` | Required, >= 0 |
| `special_meal_rule` | Required, one of: NONE, INCLUDED_COUNT, SCHEDULE_BASED |

### Edge Cases

| Case | Handling |
|------|----------|
| Admin edits price on plan with active subs | Existing subs keep old snapshots. New subs + renewals get new price. |
| Admin deactivates plan with active subs | Allowed — existing subs complete their cycle. Renewal blocked. |
| Admin changes is_flexible_skip | Only applies to future subscriptions. |
| Admin changes plan_code | Existing subscriptions reference via plan_code_snapshot. |
| Hard-delete a plan | Blocked by FK constraint. Use deactivation. |
| Auto-renew after plan deactivated | Renewal prevented. Subscription expires normally. |
| Concurrent admin edits | Last write wins. Audit log captures both. |
| Trial with buffer/skip | Not applicable — enforced by validation. |

### Testing Strategy

| Type | Cases |
|------|-------|
| Happy path | Create -> Browse (customer) -> Subscribe |
| | Update price -> new sub gets new price |
| | Deactivate -> hidden from browse |
| | Reactivate -> reappears |
| Validation | Missing fields, duplicate code, invalid meal_combination, negative price |
| Permission | Customer -> admin endpoints = 403. Unauthenticated = 401. Public endpoints = works. |
| Edge case | Deactivate with active subs. Renewal blocked after deactivation. Trial validation. |
| Snapshot isolation | Sub at 90, admin changes to 95, existing sub still at 90, new sub at 95. |

## Module 6 — Wallet Management

**Status:** `FINALIZED`

### Objective

Provide a per-subscription prepaid wallet system with an append-only financial ledger. Enable customers to top-up their wallets, admins to manage wallets across all subscriptions, and the system to deduct meal costs on delivery completion. Track security deposits separately from spendable balance and enforce financial integrity through DB constraints and triggers.

### Schema Changes

#### `subscription_wallets` — Add fields

| Field | Type | Notes |
|-------|------|-------|
| `security_deposit_status` | `String @default("ACTIVE") @db.VarChar(30)` | `ACTIVE \| AT_RISK \| DEDUCTED \| PARTIALLY_DEDUCTED \| REFUNDED` |
| `created_at` | `DateTime @default(now())` | |

#### `wallet_transactions` — Add/modify fields

| Field | Type | Notes |
|-------|------|-------|
| `balance_before` | `Decimal @db.Decimal(10, 2)` | **New** — balance before this transaction |
| `balance_after` | `Decimal @db.Decimal(10, 2)` | **New** — balance after this transaction |
| `reference_type` | `String? @db.VarChar(50)` | **New** — `DELIVERY \| SUBSCRIPTION \| ADDON_ORDER \| GUEST_MEAL \| SYSTEM \| TOPUP` |
| FK onDelete | `onDelete: Restrict` | Prevent wallet deletion if transactions exist |

#### Raw SQL Migrations

**CHECK constraint — balance >= 0:**
```sql
ALTER TABLE subscription_wallets
ADD CONSTRAINT check_balance_non_negative
CHECK (balance >= 0);
```

**Append-only trigger — block UPDATE:**
```sql
CREATE TRIGGER block_wallet_txn_update
BEFORE UPDATE ON wallet_transactions
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'wallet_transactions is append-only';
```

**Append-only trigger — block DELETE:**
```sql
CREATE TRIGGER block_wallet_txn_delete
BEFORE DELETE ON wallet_transactions
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'wallet_transactions is append-only';
```

### Architecture

```
wallet.service.ts (NEW — dedicated wallet service)
  |
  |-- getWallet(subscriptionId)              — fetch wallet by subscription
  |-- getTransactions(walletId, page, limit)  — paginated ledger
  |-- topup(walletId, amount, category, note) — add funds (CREDIT)
  |-- deduct(walletId, amount, category, note, referenceId, referenceType) — deduct funds (DEBIT)
  |-- refund(walletId, amount, reason)       — general refund (CREDIT)
  |-- processTopupMultiple(userId, requests[]) — atomic multi-wallet top-up
  |-- getSpendable(wallet)                   — computed: balance - security_deposit_held
  |
  All mutations use SELECT FOR UPDATE inside prisma.$transaction
```

### Spendable Balance

`spendable = balance - security_deposit_held`

A computed value. All threshold checks (low-wallet warning, BLOCKED_LOW_WALLET at generation) use spendable, not raw balance.

### Wallet Operations

#### 1. Wallet Creation (exists)

Auto-created inside `subscription.service.ts:subscribeUser()` transaction. Set `security_deposit_status = "ACTIVE"`.

#### 2. Wallet Top-Up

| Flow | Endpoint | Auth | Detail |
|------|----------|------|--------|
| Customer top-up own wallet | `POST /api/v1/wallet/topup` | CUSTOMER | `{ subscription_id, amount }`. Validates ownership. Creates `CREDIT / TOPUP`. |
| Admin top-up any wallet | `POST /api/v1/admin/wallets/:subscriptionId/topup` | ADMIN | `{ amount, note }`. Creates `CREDIT / MANUAL_TOPUP`. |
| Multi-wallet aggregated | `POST /api/v1/wallet/topup-multiple` | CUSTOMER | `{ subscription_ids[], amount_per_wallet }`. Atomic across wallets. |

All top-ups create a transaction record but **do not process payment** — Razorpay integration is in Module 25.

#### 3. Wallet Deduction (on delivery completion — exists, improve)

Move balance check **inside** the transaction to close TOCTOU gap:
```
BEGIN TRANSACTION
  SELECT ... FOR UPDATE (lock wallet row)
  CHECK: balance >= mealCost
  UPDATE wallet SET balance = balance - mealCost
  INSERT wallet_transactions (DEBIT, MEAL_DEDUCTION, balance_before, balance_after, reference_id, reference_type=DELIVERY)
END TRANSACTION
```

#### 4. Wallet Refund

| Flow | Endpoint | Auth | Detail |
|------|----------|------|--------|
| Delivery reversal (exists) | — | — | Already credits with `DELIVERY_REVERSAL` |
| General refund | `POST /api/v1/admin/wallets/:subscriptionId/refund` | ADMIN | `{ amount, reason }`. Creates `CREDIT / REFUND`. |

#### 5. BLOCKED_LOW_WALLET in Delivery Generation

At generation time (Module 8), for each subscription:
```
IF (wallet.balance - wallet.security_deposit_held) < price_per_meal_snapshot
  THEN status = BLOCKED_LOW_WALLET
```

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `GET` | `/api/v1/wallet` | JWT | CUSTOMER | My wallet (via active subscription) |
| `GET` | `/api/v1/wallet/transactions` | JWT | CUSTOMER | My transaction history (paginated) |
| `POST` | `/api/v1/wallet/topup` | JWT | CUSTOMER | Top-up my wallet |
| `POST` | `/api/v1/wallet/topup-multiple` | JWT | CUSTOMER | Multi-wallet top-up |
| `GET` | `/api/v1/admin/wallets/:subscriptionId` | JWT | ADMIN | View any wallet (exists) |
| `GET` | `/api/v1/admin/wallets/:subscriptionId/transactions` | JWT | ADMIN | Transaction history (exists) |
| `POST` | `/api/v1/admin/wallets/:subscriptionId/topup` | JWT | ADMIN | Admin top-up |
| `POST` | `/api/v1/admin/wallets/:subscriptionId/refund` | JWT | ADMIN | General refund |

### Business Rules

| Rule | Detail |
|------|--------|
| Spendable = balance - security_deposit_held | Deposit is never spendable |
| Balance >= 0 | Enforced by DB CHECK constraint |
| Transactions are append-only | DB trigger blocks UPDATE and DELETE |
| Each transaction records balance_before + balance_after | Full audit trail |
| Low-wallet threshold | spendable < `system_configs.min_wallet_threshold` (default 500) triggers `LOW_WALLET_WARNING` |
| Customer can only top-up own subscriptions | Ownership validation via `subscriptions.user_id` |
| Admin can top-up any wallet | No ownership check |
| Multi-wallet top-up is atomic | All wallets updated in single transaction, or none |
| Deduction uses SELECT FOR UPDATE | Closes TOCTOU gap between balance check and deduction |

### Transaction Categories

| Category | Type | When |
|----------|------|------|
| `MEAL_DEDUCTION` | DEBIT | Successful delivery |
| `TIFFIN_PENALTY` | DEBIT | tiffins_due >= 2, security deposit deducted |
| `PLAN_EXPIRY_PENALTY` | DEBIT | Final settlement when net_refund < 0 |
| `DELIVERY_REVERSAL` | CREDIT | Delivery reset |
| `SECURITY_RESTORED` | CREDIT | Tiffin returned after penalty |
| `SKIP_EXCESS_REFUND` | CREDIT | Non-recoverable skips refunded at expiry |
| `BUFFER_MEAL_EXPIRED_REFUND` | CREDIT | Undelivered buffer meals refunded |
| `PLAN_PAYMENT` | CREDIT | Initial subscription payment |
| `TOPUP` | CREDIT | Customer self top-up |
| `MANUAL_TOPUP` | CREDIT | Admin-initiated top-up |
| `REFUND` | CREDIT | General admin refund |

### system_configs Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `min_wallet_threshold` | `500` | Spendable below this triggers LOW_WALLET_WARNING |

### Edge Cases

| Case | Handling |
|------|----------|
| Top-up while subscription expired | Allowed — wallet can be funded for renewal |
| Top-up while in buffer | Allowed — buffer meals need funding if extended |
| Concurrent top-up + deduction | `SELECT FOR UPDATE` serializes |
| balance_after doesn't match | Impossible — computed in same atomic operation |
| Admin refund > balance | Blocked by CHECK constraint balance >= 0 |
| Wallet deletion with transactions | Blocked by FK Restrict |
| Customer tops up another's wallet | Blocked by ownership validation |
| min_wallet_threshold = 0 | Disables low-wallet warning |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **Module 2** (Subscription) | Wallet auto-created on subscription. Top-up available. |
| **Module 8** (Delivery Gen) | `BLOCKED_LOW_WALLET` check: spendable < price_per_meal_snapshot |
| **Module 14** (Delivery Completion) | Wallet deduction with balance_after tracking |
| **Module 15** (Delivery Reversal) | Wallet credit with balance_after tracking |
| **Module 25** (Integrations) | Razorpay payment for top-ups (service layer ready, payment processing deferred) |

### Out of Scope

| Feature | Deferred To |
|---------|-------------|
| Razorpay payment processing for top-ups | Module 25 |
| Multi-wallet aggregated payment split UI | Module 25 |
| Wallet-to-wallet transfers | Not in business requirements |
| Negative wallet recovery flow | Covered by outstanding_dues at subscription expiry |

### Testing Strategy

| Type | Cases |
|------|-------|
| Happy path | Customer top-up -> balance increases -> transaction logged with balance_before/after |
| | Admin top-up any wallet -> balance increases |
| | Multi-wallet top-up -> all wallets credited atomically |
| | Delivery completion -> wallet deducted -> balance_after correct |
| | Delivery reversal -> wallet credited -> balance_after correct |
| | Low wallet -> BLOCKED_LOW_WALLET at generation |
| Validation | Customer tops up another's wallet -> 403 |
| | Negative amount -> 400 |
| | Refund > balance -> blocked by CHECK |
| Security | UPDATE/DELETE on wallet_transactions -> DB trigger blocks |
| | Concurrent operations -> serialized by SELECT FOR UPDATE |
| Edge case | min_wallet_threshold = 0 -> no warning |
| | Top-up expired subscription -> allowed |

## Module 14 — Delivery Completion Engine

**Status:** `FINALIZED`

### Objective

Process the delivery handover when a delivery boy marks a meal as delivered or failed. Execute the full tiffin security decision tree including penalty deductions and security restoration. Deduct wallet atomically with `SELECT FOR UPDATE`. Handle buffer meal failure with reschedule logic. Create audit trail for all state changes.

### Controller Input

**`POST /api/v1/deliveries/:id/driver/deliver`**

```json
{
  "meal_delivered": true,
  "tiffin_returned": false,
  "tiffin_box_id": "uuid",
  "returned_tiffin_box_id": "uuid",
  "lat": 26.9124,
  "lng": 75.7873
}
```

- `meal_delivered` — explicit boolean (NEW)
- `tiffin_returned` — explicit boolean (NEW)
- `tiffin_box_id` — required if meal_delivered = true
- `returned_tiffin_box_id` — required if tiffin_returned = true
- `lat`/`lng` — GPS logged but not validated (geofence deferred)

### Pre-Transaction Validations

| Step | Check | Failure |
|------|-------|---------|
| 1 | Delivery exists | `DELIVERY_NOT_FOUND` |
| 2 | Not already DELIVERED | `ALREADY_PROCESSED` |
| 3 | Status is PENDING or DISPATCHED | `INVALID_STATE` |
| 4 | Driver owns delivery | `FORBIDDEN` |
| 5 | price_per_meal_snapshot not null | `INVALID_PRICE_CONFIGURATION` |
| 6 | Tiffin tracker exists | `DATA_INTEGRITY_ERROR` |
| 7 | Pre-check tiffin debt (tiffins_due >= 2) | Block with `BLOCKED_TIFFIN_DEBT` |
| 8 | Wallet exists | `DATA_INTEGRITY_ERROR` |
| 9 | New tiffin box exists (if meal_delivered) | `TIFFIN_NOT_FOUND` |
| 10 | Returned tiffin box exists (if returned) | `RETURNED_TIFFIN_NOT_FOUND` |

### Full Tiffin Security Decision Tree

#### Branch 1 — meal_delivered = TRUE, tiffin_returned = TRUE

```
tiffins_due += 1; tiffins_due -= 1 (net unchanged)
Event: RETURNED

IF tiffins_due > 0:
  tiffins_due -= 1 (net -1)
  IF tiffins_due == 0 AND security_deducted == TRUE:
    CREDIT wallet Rs. 500 (SECURITY_RESTORED)
    security_deducted = FALSE
    security_deposit_status = ACTIVE
    Event: SECURITY_RESTORED
```

#### Branch 2 — meal_delivered = TRUE, tiffin_returned = FALSE

```
tiffins_due += 1
Event: NOT_RETURNED

IF tiffins_due >= 2 AND security_deducted == FALSE:
  IF wallet.spendable >= 500:
    DEBIT wallet Rs. 500 (TIFFIN_PENALTY)
    security_deducted = TRUE
    security_deposit_status = DEDUCTED
    Event: PENALTY_APPLIED
  ELSE:
    Admin alert: TIFFIN_PENALTY_FAILED_LOW_WALLET
    Block next pending delivery for this sub -> BLOCKED_TIFFIN_DEBT
```

#### Branch 3 — meal_delivered = FALSE

```
tiffins_due unchanged
wallet NOT debited
delivery.status = FAILED
Admin alert raised

IF is_buffer_meal:
  IF first failure:
    Create rescheduled delivery for next day
    status = FAILED_RESCHEDULED
  ELSE (second failure):
    status = EXPIRED_BUFFER_FAILED
    CREDIT wallet price_per_meal_snapshot (BUFFER_MEAL_EXPIRED_REFUND)
```

### Atomic Transaction Flow

```
prisma.$transaction([
  // Step 1: Lock wallet row
  SELECT ... FOR UPDATE ON subscription_wallets

  // Step 2: Update delivery with optimistic lock
  UPDATE deliveries SET status = "DELIVERED", delivered_at = NOW(),
    tiffin_box_id, location_locked = true, location_locked_at = NOW()
    WHERE id = deliveryId AND status IN ("PENDING", "DISPATCHED")
    // If count === 0 -> throw DELIVERY_ALREADY_COMPLETED

  // Step 3: Process tiffin decision tree
  UPDATE tiffin_tracker SET tiffins_due, security_deducted

  // Step 4: Wallet operations (if applicable)
  //   Meal deduction: DEBIT / MEAL_DEDUCTION
  //   Tiffin penalty: DEBIT / TIFFIN_PENALTY (if applicable)
  //   Security restored: CREDIT / SECURITY_RESTORED (if applicable)
  //   Each records balance_before, balance_after, reference_type

  // Step 5: Update subscription_wallets.security_deposit_status
  UPDATE subscription_wallets SET security_deposit_status

  // Step 6: Tiffin box statuses
  UPDATE tiffin_boxes SET status = "WITH_CUSTOMER" WHERE id = tiffin_box_id
  UPDATE tiffin_boxes SET status = "IN_KITCHEN" WHERE id = returned_tiffin_box_id

  // Step 7: Tiffin events
  INSERT tiffin_events (event_type, tiffins_due_after, scan_method)

  // Step 8: Route log
  INSERT route_logs (event = "HANDOVER_COMPLETE", lat, lng, delivery_boy_id)

  // Step 9: Audit log
  INSERT audit_log (action = "DELIVERY_CONFIRMED", actor_type = "DELIVERY_BOY",
    entity_type = "DELIVERY", entity_id, old_values, new_values)
])
```

### Failure Handling

#### `markDeliveryFailed` (improved)

| Condition | Action |
|-----------|--------|
| Buffer meal, first failure | Create rescheduled delivery for next day. Status = FAILED_RESCHEDULED. |
| Buffer meal, second failure | Status = EXPIRED_BUFFER_FAILED. Refund price_per_meal_snapshot. |
| Regular meal | Status = FAILED. Admin alert raised. |
| Admin alert | Record in admin_alerts (deferred sending). |

### Wallet Deduction Pattern

```
SELECT ... FOR UPDATE on subscription_wallets (lock row)
CHECK: spendable = balance - security_deposit_held
  IF meal deduction: spendable >= price_per_meal_snapshot
  IF penalty: spendable >= 500
UPDATE balance
INSERT wallet_transactions WITH balance_before, balance_after, reference_type
UPDATE security_deposit_status if changed
```

### Database Impact

| Entity | Change |
|--------|--------|
| `deliveries.status` | Add `FAILED_RESCHEDULED`, `EXPIRED_BUFFER_FAILED` |
| `wallet_transactions` | Add `balance_before`, `balance_after`, `reference_type` (from Module 6) |
| `tiffin_events.event_type` | Add `RETURNED`, `NOT_RETURNED`, `PENALTY_APPLIED`, `SECURITY_RESTORED` |
| `tiffin_events` | Add `tiffins_due_after`, `scan_method`, `notes` |
| `tiffin_tracker` | Add CHECK constraint `tiffins_due >= 0` |
| `subscription_wallets` | Add `security_deposit_status` (from Module 6) |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/deliveries/:id/driver/arrive` | JWT | DELIVERY_BOY | Log arrival (exists) |
| `POST` | `/api/v1/deliveries/:id/driver/fail` | JWT | DELIVERY_BOY | Mark failed (improve with reschedule) |
| `POST` | `/api/v1/deliveries/:id/driver/deliver` | JWT | DELIVERY_BOY | Complete handover (improve with booleans + tiffin tree) |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **Module 6** (Wallet) | Use `deduct()`/`topup()` with `SELECT FOR UPDATE`, `balance_before`/`after`, `reference_type`. Manage `security_deposit_status`. |
| **Module 8** (Delivery Gen) | Consumes delivery statuses: DELIVERED, FAILED, FAILED_RESCHEDULED, EXPIRED_BUFFER_FAILED. |
| **Module 15** (Reversal) | `resetDeliveredMeal` reverses wallet + tiffin changes made here. |
| **Module 20** (Notifications) | Create notification_log entries (deferred send). |
| **Module 22** (Audit) | Audit log for all state transitions. |

### Tiffin Event Types

| Event | When |
|-------|------|
| `RETURNED` | tiffin_returned = true, box physically collected |
| `NOT_RETURNED` | tiffin_returned = false, box remains with customer |
| `PENALTY_APPLIED` | tiffins_due >= 2 AND security_deducted turned true, Rs. 500 deducted |
| `SECURITY_RESTORED` | tiffins_due returned to 0 after previous penalty, Rs. 500 credited |
| `DELIVERED` | New tiffin box handed to customer (existing) |

### Out of Scope

| Feature | Reason |
|---------|--------|
| GPS 200m geofence validation | Deferred |
| 15-min correction window | Deferred |
| Admin override endpoint | Deferred |
| FCM/SMS notification sending | Module 20 |
| Addon/guest meal status updates | Module 5 |

### Edge Cases

| Case | Handling |
|------|----------|
| Concurrent delivery marking | Second caller gets DELIVERY_ALREADY_COMPLETED (updateMany count check) |
| Concurrent wallet ops | SELECT FOR UPDATE serializes |
| tiffins_due goes below 0 | CHECK constraint blocks. Code logic prevents via decision tree. |
| Buffer meal fails twice | Second failure refunds, no further reschedule |
| TIFFIN_PENALTY with insufficient wallet | Admin alert + BLOCKED_TIFFIN_DEBT on next delivery |
| Wallet balance exactly equals mealCost | Deduction succeeds, balance becomes 0 |
| Returned box belongs to different sub | Not validated (physical box collection, box identified by QR) |
| Wrong driver tries to deliver | 403 FORBIDDEN (driver_id mismatch) |
| Already DELIVERED | 400 ALREADY_PROCESSED |

### Testing Strategy

| Type | Cases |
|------|-------|
| Happy path — delivered + returned | Wallet deducted, tiffins_due net 0, box to IN_KITCHEN |
| Delivered + not returned | tiffins_due += 1, wallet deducted |
| Delivered + not returned + tiffins_due >= 2 | + TIFFIN_PENALTY Rs. 500 deducted |
| Delivered + returned + tiffins_due > 0 | tiffins_due -= 1 |
| Delivered + returned + tiffins_due 0 + security_deducted | SECURITY_RESTORED Rs. 500 credited |
| Meal not delivered | Status FAILED, no wallet deduction, admin alert |
| Buffer meal fail 1st time | Reschedule created |
| Buffer meal fail 2nd time | EXPIRED_BUFFER_FAILED + refund |
| TIFFIN_PENALTY insufficient wallet | Admin alert, BLOCKED_TIFFIN_DEBT |
| Concurrent delivery marking | Second gets DELIVERY_ALREADY_COMPLETED |
| Concurrent wallet ops | SELECT FOR UPDATE serializes |
| Wrong driver | 403 FORBIDDEN |
| Already DELIVERED | 400 ALREADY_PROCESSED |
| Buffer meal delivered | No wallet deduction, tiffin tracking still applies |

---

## Module 4 — Subscription Lifecycle Management

**Status:** `FINALIZED`

### Objective

Manage the full lifecycle of a subscription from creation through pause/resume, cancellation, renewal, and expiry. The lifecycle touches wallet, deliveries, buffer meals, tiffin tracking, and audit. All state transitions are guarded by business rules, validated at the service layer, and recorded via audit logs.

### Subscription State Machine

```
                  ┌──────────┐
                  │  ACTIVE  │ ←──── Created (M2)
                  └────┬─────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
            ▼          ▼          ▼
        ┌──────┐  ┌───────┐  ┌───────┐
        │PAUSED│  │BUFFER │  │CANCELLED│
        └──┬───┘  └───┬───┘  └────────┘
           │          │
           ▼          ▼
        ┌──────┐  ┌─────────┐
        │ACTIVE│  │ EXPIRED │
        └──────┘  └─────────┘
                      │
                      ▼
                 ┌──────────┐
                 │CANCELLED │ (if opted during expiry settlement)
                 └──────────┘
```

| Status | Meaning | Transitions To |
|--------|---------|----------------|
| `ACTIVE` | Running, generating deliveries | `PAUSED`, `BUFFER`, `CANCELLED` |
| `PAUSED` | Temporarily halted — no deliveries generated | `ACTIVE` |
| `BUFFER` | Post-end-date grace period, draining skipped_meal_pool | `ACTIVE` (via renewal), `EXPIRED` |
| `EXPIRED` | Terminated — buffer exhausted or auto-expired | `CANCELLED` (on settlement) |
| `CANCELLED` | Manually terminated by customer or admin before end_date | (Terminal) |

### Schema Changes

#### `subscriptions` table — ADD/modify fields

| Field | Type | Notes |
|-------|------|-------|
| `paused_at` | `DateTime?` | Timestamp when subscription was paused |
| `pause_count` | `Int @default(0)` | Number of times paused (admin limit check) |
| `cancelled_at` | `DateTime?` | Timestamp when cancelled |
| `cancellation_reason` | `String? @db.VarChar(255)` | Customer-provided reason |
| `cancelled_by` | `String? @db.VarChar(20)` | `CUSTOMER` or `ADMIN` |
| `renewal_count` | `Int @default(0)` | Number of renewals for this subscription line |
| `renewed_from_id` | `String?` | FK to original subscription (for renewal chain) |
| `auto_expire_at` | `DateTime? @db.Date` | Scheduled expiry date (end_date + buffer_days_snapshot, moved if paused) |
| `settled_at` | `DateTime?` | Timestamp of expiry financial settlement |

#### Raw SQL Migration — CHECK constraints

```sql
ALTER TABLE subscriptions
ADD CONSTRAINT check_pause_count_max
CHECK (pause_count <= 3);  -- max 3 pauses per subscription cycle
```

### Architecture

```
subscription.service.ts — lifecycle operations
  ├── subscribeUser()         (exists — M2)
  ├── pauseSubscription()     (NEW)
  ├── resumeSubscription()    (NEW)
  ├── cancelSubscription()    (NEW)
  ├── renewSubscription()     (NEW)
  ├── processExpiredSubscriptions()  (NEW — replaces parts of buffer.service)
  ├── settleExpiredSubscription()    (NEW — financial settlement)
  └── getLifecycleHistory()          (NEW — monitoring)

cron jobs (node-cron):
  ├── 12:01 AM — runPlanExpiryCron()        → ACTIVE → BUFFER transition (M8)
  ├── 12:02 AM — runBufferExpiryCron()      → BUFFER → EXPIRED (M8)
  └── 12:05 AM — runAutoRenewalCron()       → Attempt auto-renew for eligible EXPIRED subs
  └── 12:10 AM — runExpiredSettlementCron() → Settle unpicked EXPIRED subs (auto-CANCELLED)
```

### Flows

#### 1. Pause Subscription (Customer)

```
POST /subscriptions/:id/pause { reason? }
  → requireAuth, ownership check (subscription.user_id === req.user.id)
  → Validate: status is ACTIVE
  → Validate: pause_count < 3 (max 3 pauses per cycle)
  → BEGIN TRANSACTION:
    → Update subscription:
        status = PAUSED
        paused_at = NOW()
        pause_count += 1
    → Calculate new auto_expire_at:
        remaining_days = end_date - NOW()
        auto_expire_at = NOW() + remaining_days + buffer_days_snapshot
        (pause extends the effective expiry by holding time)
    → Cancel all PENDING deliveries for subscription
        (status = CANCELLED — reason SYSTEM_PAUSE)
    → Refund wallet for cancelled deliveries: balance += price_per_meal_snapshot each
    → Create audit_log: CUSTOMER_PAUSED_SUBSCRIPTION
  → END TRANSACTION
  → Returns: 200 { subscription }
```

##### Business Rules for Pause

| Rule | Detail |
|------|--------|
| Max 3 pauses per cycle | CHECK constraint at DB level. After 3, endpoint returns 400 PAUSE_LIMIT_EXCEEDED. |
| Only ACTIVE can be paused | PAUSED/BUFFER/EXPIRED/CANCELLED → 400 INVALID_STATE |
| Pending deliveries cancelled | Refund wallet for each. Does not refund already-DELIVERED meals. |
| Pause extends effective duration | auto_expire_at recalculated so total days in ACTIVE+PAUSED = original duration. |
| Wallet balance unchanged | Pause only refunds pending non-delivered meals. Existing balance stays. |

#### 2. Resume Subscription (Customer)

```
POST /subscriptions/:id/resume
  → requireAuth, ownership check
  → Validate: status is PAUSED
  → BEGIN TRANSACTION:
    → Update subscription:
        status = ACTIVE
        auto_expire_at = NULL (recalculated on next pause or expiry)
    → Create audit_log: CUSTOMER_RESUMED_SUBSCRIPTION
  → END TRANSACTION
  → Note: Delivery generation resumes automatically via the next cron
  → Returns: 200 { subscription }
```

##### Business Rules for Resume

| Rule | Detail |
|------|--------|
| Only PAUSED can be resumed | Other statuses → 400 INVALID_STATE |
| No skip_balance reset | Skips are preserved as-is |
| No address/plan change | Resume uses same snapshot values |
| Next cron generates deliveries | From resume date onward |

#### 3. Cancel Subscription (Customer or Admin)

```
POST /subscriptions/:id/cancel { reason?, cancelled_by = "CUSTOMER" | "ADMIN" }
  → requireAuth (CUSTOMER owns sub OR ADMIN)
  → Validate: status is ACTIVE or PAUSED
  → Validate: if CUSTOMER, ownership check
  → BEGIN TRANSACTION:
    → Calculate refund amount:
        days_used = (NOW() - start_date).days
        total_days = (end_date - start_date).days
        if days_used >= total_days: refund = 0 (no refund for completed period)
        else:
            unused_days = total_days - days_used
            meals_per_day = total_meals / total_days  (estimated)
            refund_meals = meals_per_day * unused_days - skipped_meal_pool
            refund = min(refund_meals * price_per_meal_snapshot, wallet.balance)
            (refund is capped at current wallet balance)
    → Update subscription:
        status = CANCELLED
        cancelled_at = NOW()
        cancellation_reason = reason
        cancelled_by = cancelled_by
    → Cancel all PENDING deliveries (status = CANCELLED, reason SYSTEM_CANCEL)
    → Refund wallet for cancelled deliveries (same as pause refund)
    → Refund security_deposit:
        IF tiffins_due == 0:
            wallet.balance += security_deposit_snapshot
            security_deposit_status = REFUNDED
        ELSE:
            security_deposit_status = PARTIALLY_DEDUCTED (tiffins must be returned first)
    → Process wallet refund to customer (if any net positive):
        create wallet_transaction CREDIT / CANCELLATION_REFUND
    → Create audit_log: CUSTOMER_CANCELLED_SUBSCRIPTION or ADMIN_CANCELLED_SUBSCRIPTION
  → END TRANSACTION
  → Returns: 200 { subscription, refund_amount }
```

##### Business Rules for Cancel

| Rule | Detail |
|------|--------|
| Only ACTIVE or PAUSED can cancel | BUFFER/EXPIRED/CANCELLED → 400 INVALID_STATE |
| Customer can cancel own subscription | Ownership validated |
| Admin can cancel any subscription | No ownership check |
| Security deposit refund | Conditional on tiffins_due == 0. If tiffins are outstanding, deposit held until return. |
| Pending delivery refund | Wallet credited for each cancelled pending delivery. |
| Pro-rated refund | Refund = (unused days / total days) × total_price_snapshot, capped at wallet balance. |
| No negative refund | If wallet is already depleted, refund = 0. |
| Subscription cannot be uncancelled | CANCELLED is terminal. Create a new subscription if needed. |

#### 4. Renew Subscription (System + Customer Trigger)

```
POST /subscriptions/:id/renew
  → requireAuth, ownership check (customer) OR admin
  → Validate: status is BUFFER or EXPIRED
  → Validate: associated plan_configs.is_active === true
  → If plan deactivated: return 400 PLAN_INACTIVE with suggested_active_plans[] (list of active alternative plans)
  → Customer's wallet balance is preserved — no loss
  → BEGIN TRANSACTION:
    → Snapshot fresh values from plan_configs
    → Create new subscription record:
        user_id, plan_config_id, delivery_address_id (from original)
        status = ACTIVE
        start_date = today
        end_date = today + plan.duration_days - 1
        renewal_count = parent.renewal_count + 1
        renewed_from_id = parent.id (for chain tracing)
        skip_balance = plan.skip_limit
        skipped_meal_pool = 0
        buffer_meals_remaining = 0
        All snapshot fields from current plan_configs (fresh, not parent)
    → Create new subscription_wallet:
        balance = remaining_balance_from_old_wallet (transfer)
        security_deposit_held = plan.security_deposit_snapshot
        (If old deposit >= new deposit: surplus credited to balance)
        (If old deposit < new deposit: deficit deducted from balance)
    → Create new tiffin_tracker (tiffins_due = 0, security_deducted = false)
    → Transfer pending skipped_meal_pool:
        Wallet credit for value of skipped_meal_pool from old sub
        (skipped meals don't carry forward — refunded at settlement)
    → Update old subscription:
        status = EXPIRED (if BUFFER) or mark as RENEWED (conceptual)
        settled_at = NOW()
    → Create audit_log: SYSTEM_RENEWED_SUBSCRIPTION
  → END TRANSACTION
  → Returns: 201 { new_subscription }
```

##### Auto-Renewal Cron (12:05 AM)

```
runAutoRenewalCron():
  → Query subscriptions where:
      status = "BUFFER" AND buffer_meals_remaining = 0
      OR status = "EXPIRED" AND expired_within_last_7_days
      AND plan_configs.is_active = true
      AND users.is_active = true
  → For each, attempt renewSubscription() in batch (500/batch)
  → Log summary: renewed, skipped (plan inactive), failed (wallet)
```

##### Business Rules for Renewal

| Rule | Detail |
|------|--------|
| Renewal is a **new subscription** | Snapshots fresh plan configs. Old sub is finalized. |
| Wallet balance transfers | Remaining balance from old wallet moves to new wallet. |
| Security deposit comparison | If old deposit >= new: surplus → balance. If old < new: deduct from balance. |
| Tiffins_due must be 0 | If tiffins are outstanding, renewal is blocked until return. |
| Plan must be active | If plan was deactivated, renewal is blocked. Endpoint returns `PLAN_INACTIVE` with `suggested_active_plans[]`. Wallet balance is preserved — customer can subscribe to an active plan instead. |
| Skipped meals don't carry forward | skipped_meal_pool is refunded at settlement. |
| Renewal chain | renewed_from_id links to parent subscription. Allows tracing. |
| No max renewals | Unlimited renewals allowed. Each is a new cycle. |
| Customer can trigger early renewal | Even while ACTIVE — creates a new overlapping subscription (like M2 rule). |

#### 5. Expiry Flow (Automated)

##### 5a. Plan Expiry Cron (12:01 AM — from M8)

```
runPlanExpiryCron():
  → Query subscriptions WHERE status = "ACTIVE" AND end_date < today
  → For each in batch (500):
      → If skipped_meal_pool > 0: status = BUFFER
          buffer_start_date = end_date
          buffer_expiry_date = end_date + buffer_days_snapshot
          buffer_meals_remaining = skipped_meal_pool
      → Else (skipped_meal_pool == 0):
          status = EXPIRED
          settled_at = NOW()
          → Process financial settlement (see 5c)
```

##### 5b. Buffer Expiry Cron (12:02 AM — from M8)

```
runBufferExpiryCron():
  → Query subscriptions WHERE status = "BUFFER" AND buffer_expiry_date < today
  → For each in batch (500):
      → Refund remaining buffer meals to wallet:
          refund = buffer_meals_remaining * price_per_meal_snapshot
          wallet.balance += refund
          wallet_transaction: CREDIT / BUFFER_MEAL_EXPIRED_REFUND
      → Update subscription:
          status = EXPIRED
          buffer_meals_remaining = 0
          settled_at = NOW()
      → Cancel any remaining PENDING buffer deliveries (EXPIRED_BUFFER)
      → Process financial settlement (see 5c)
```

##### 5c. Financial Settlement at Expiry

```
settleExpiredSubscription(subscriptionId):
  → Inside transaction:
    → Calculate net settlement:
        total_collected = SUM(all CREDIT transactions)
        total_spent = SUM(all DEBIT transactions)
        net_balance = wallet.balance - security_deposit_held

    → Security deposit handling:
        IF tiffins_due == 0:
            refund_security = security_deposit_held
            wallet.balance += refund_security
            security_deposit_status = REFUNDED
            wallet_transaction: CREDIT / SECURITY_DEPOSIT_REFUND
        ELSE:
            security_deposit_status = DEDUCTED
            // Security deposit forfeited to cover unreturned tiffins
            wallet_transaction: CREDIT / SECURITY_DEPOSIT_FORFEITED
            // Remaining tiffins_due logged as outstanding_dues
    
    → If net_balance > 0:
        // Surplus available for refund or transfer to new subscription
        wallet_transaction: CREDIT / PLAN_EXPIRY_SETTLEMENT
    → If net_balance < 0:
        // Outstanding debt — logged in admin_alerts
        admin_alert: OUTSTANDING_DUES

    → Set settled_at = NOW()
    → audit_log: SYSTEM_SETTLED_SUBSCRIPTION
```

##### Business Rules for Expiry

| Rule | Detail |
|------|--------|
| Buffer only activates if skipped_meal_pool > 0 | Subscriptions with 0 skips skip buffer entirely — go straight to EXPIRED. |
| Buffer meals refunded at expiry | Undelivered buffer meals = refund at price_per_meal_snapshot. |
| Security deposit refund | Only if tiffins_due == 0. Otherwise forfeited as penalty. |
| Outstanding dues logged | If settlement is negative, admin alert created. No further auto-action. |
| settled_at timestamp | Marks closure. Prevents double-settlement. |
| Wallet remains accessible | Wallet is not deleted — kept for audit trail. Balance can be used for new subscription. |

#### 6. Subscription Monitoring

##### 6a. Customer Dashboard — Updated

```
GET /my-subscriptions  (exists — M2, enhanced)
  → requireAuth (CUSTOMER)
  → Fetch all subscriptions, ordered by created_at desc
  → Include: plan_configs, delivery_addresses, subscription_wallets, tiffin_tracker
  → For each subscription, compute computed fields:
      days_remaining = end_date - today (or buffer_expiry_date for BUFFER)
      status_label = computed from status + buffer_meals_remaining
      can_pause = status === ACTIVE && pause_count < 3
      can_resume = status === PAUSED
      can_cancel = status IN ('ACTIVE', 'PAUSED')
      can_renew = status IN ('BUFFER', 'EXPIRED')
      renewal_eligible = can_renew && plan_configs.is_active
```

##### 6b. Admin Monitoring

| Endpoint | Change |
|----------|--------|
| `GET /admin/subscriptions?status=EXPIRING_SOON` | New filter. Returns ACTIVE/BUFFER subs where end_date within next 7 days. |
| `GET /admin/subscriptions?status=OVERDUE` | New filter. Returns EXPIRED subs where settled_at IS NULL. |
| `GET /admin/subscriptions/:id/lifecycle` | New endpoint. Returns full lifecycle timeline: created_at → pauses → resume → cancelled_at → renewals chain. |

##### 6c. Expiry Notification Triggers

| Condition | Trigger | Action |
|-----------|---------|--------|
| end_date - today === 7 days | Cron (daily) | notification_log: SUBSCRIPTION_EXPIRING_SOON |
| end_date - today === 3 days | Cron (daily) | notification_log: SUBSCRIPTION_EXPIRING_SOON (reminder) |
| Buffer activated | Expiry cron | notification_log: BUFFER_ACTIVATED |
| Buffer expiry in 3 days | Cron (daily) | notification_log: BUFFER_EXPIRING_SOON |
| Subscription expired | Expiry cron | notification_log: SUBSCRIPTION_EXPIRED (with renewal CTA) |
| Renewal success | Renewal flow | notification_log: SUBSCRIPTION_RENEWED |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/subscriptions/:id/pause` | JWT | CUSTOMER | Pause active subscription |
| `POST` | `/api/v1/subscriptions/:id/resume` | JWT | CUSTOMER | Resume paused subscription |
| `POST` | `/api/v1/subscriptions/:id/cancel` | JWT | CUSTOMER | Cancel subscription |
| `POST` | `/api/v1/subscriptions/:id/renew` | JWT | CUSTOMER | Renew expired/buffer subscription |
| `GET` | `/api/v1/my-subscriptions` | JWT | CUSTOMER | List my subscriptions (exists, enhanced) |
| `GET` | `/api/v1/subscriptions/:id/lifecycle` | JWT | CUSTOMER | Lifecycle timeline for a sub |
| `GET` | `/api/v1/admin/subscriptions` | JWT | ADMIN | List all subscriptions (exists, enhanced filters) |
| `GET` | `/api/v1/admin/subscriptions/:id` | JWT | ADMIN | View any subscription (exists) |
| `POST` | `/api/v1/admin/subscriptions/:id/cancel` | JWT | ADMIN | Admin cancel subscription |
| `POST` | `/api/v1/admin/subscriptions/:id/renew` | JWT | ADMIN | Admin force-renew subscription |
| `PATCH` | `/api/v1/admin/subscriptions/:id/status` | JWT | ADMIN | Generic status update (exists, limit to admin-only transitions) |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M2** (Subscription Creation) | Lifecycle begins here. Subscriptions enter the state machine as ACTIVE. |
| **M3** (Plan Management) | Renewal reads fresh plan_configs snapshot. Deactivated plans block renewal. |
| **M6** (Wallet) | Pause refund → wallet credit. Cancel refund → wallet credit. Renewal → balance transfer. Expiry settlement → security deposit refund/forfeit. |
| **M8** (Delivery Generation) | Cron runs check `status IN ('ACTIVE', 'BUFFER')` — PAUSED/CANCELLED/EXPIRED automatically excluded. |
| **M14** (Delivery Completion) | tiffins_due at settlement time determines security deposit fate. |
| **M20** (Notifications) | Notification triggers at each lifecycle transition. |

### Transaction Categories (Additions to M6)

| Category | Type | When |
|----------|------|------|
| `CANCELLATION_REFUND` | CREDIT | Customer-initiated cancellation |
| `PAUSE_REFUND` | CREDIT | Pending meals refunded at pause |
| `RENEWAL_BALANCE_TRANSFER` | CREDIT | Balance moved from old to new wallet |
| `SECURITY_DEPOSIT_REFUND` | CREDIT | Deposit returned at expiry (tiffins_due == 0) |
| `SECURITY_DEPOSIT_FORFEITED` | DEBIT | Deposit forfeited at expiry (tiffins_due > 0) |
| `PLAN_EXPIRY_SETTLEMENT` | CREDIT | Net positive balance refunded at settlement |

### Edge Cases

| Case | Handling |
|------|----------|
| Pause while deliveries already dispatched | Dispatched deliveries proceed to completion. Only PENDING deliveries cancelled. |
| Cancel during buffer | Allowed — customer forfeits remaining buffer meals. Security deposit handled per tiffins_due. |
| Renewal with deactivated plan | Blocked with `PLAN_INACTIVE` + `suggested_active_plans[]`. Customer's wallet balance is preserved — they can subscribe to an active plan or wait for expiry settlement and refund. |
| Renewal with outstanding tiffins | Blocked with `TIFFINS_OUTSTANDING`. Customer must return tiffins first. |
| Concurrent pause + delivery generation | Pause transaction cancels pending deliveries. Cron checks status before generating — PAUSED is excluded. |
| Pause limit reached | `pause_count >= 3` → 400 PAUSE_LIMIT_EXCEEDED. DB CHECK constraint also enforces. |
| Admin cancels subscription | Works same as customer cancel. `cancelled_by = ADMIN`. Audit log differentiates. |
| Expired subscription with 0 settlement | `settled_at` set, no admin alert needed. Clean zero-close. |
| Expired subscription with negative settlement | Admin alert created. Wallet kept open for recovery payment. |
| Customer requests refund after cancel | Refund is computed at cancellation time. Post-cancellation adjustments are admin-manual. |
| Subscription chain tracing | `renewed_from_id` links to parent. Admin can traverse. |
| Renewal while old sub still in buffer | Old sub status → EXPIRED. New sub → ACTIVE. No overlap. |
| Pause at end_date | If paused on the last day, status changes to PAUSED. auto_expire_at = end_date + remaining buffer days. |
| Resume after end_date | If end_date has passed, resume transitions to BUFFER (not ACTIVE). |
| Security deposit already deducted (tiffins_due ≥ 2 during life) | At settlement, security_deposit_status already DEDUCTED. No further action. |
| Wallet exhausted at settlement (balance < 0) | Protected by CHECK constraint balance >= 0. Settlement logic never produces negative balance. |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| Cron batch processing | All expiry/renewal crons process in batches of 500 with `skip`/`take` pagination. |
| Expiry cron timeout | Each sub processed in own transaction. If one fails, others continue. |
| Renewal at scale | Auto-renewal cron filters to BUFFER subs with buffer_meals_remaining = 0 only — small subset daily. |
| Lifecycle history queries | Index on `[user_id, status, end_date]` and `[status, end_date]`. |
| Concurrent operations | All mutations inside `prisma.$transaction`. Pause/resume/cancel are single-transaction. |
| Notification triggers | Notification creation is synchronous (inside transaction). Sending deferred to M20. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Sub created → Pause → Resume → Cancel → Refund computed |
| | Sub created → Run to expiry → Buffer → Buffer expiry → Settlement |
| | Sub created → End_date reached, skipped_meal_pool = 0 → Immediate EXPIRED |
| | Sub created → Renew while ACTIVE → New sub created |
| | Sub created → Expire → Renew → Balance transferred |
| **Pause** | Pause with PENDING deliveries → Refunded |
| | Pause when already paused → 400 |
| | Pause when pause_count = 3 → 400 |
| | Pause on non-ACTIVE sub → 400 |
| | Resume → Status back to ACTIVE |
| | Resume from expired pause → BUFFER (not ACTIVE) |
| **Cancel** | Cancel ACTIVE → Pending deliveries refunded |
| | Cancel PAUSED → Works |
| | Cancel BUFFER → Allowed |
| | Cancel EXPIRED → 400 INVALID_STATE |
| | Cancel with tiffins due → Deposit held, PARTIALLY_DEDUCTED |
| | Cancel with 0 tiffins due → Deposit refunded to wallet |
| | Pro-rated refund computed correctly |
| | Admin cancel → Same result, different audit trail |
| **Renewal** | Renew from BUFFER → New sub, wallet transferred |
| | Renew from EXPIRED → New sub, wallet transferred |
| | Renew with deactivated plan → 400 PLAN_INACTIVE |
| | Renew with tiffins_due > 0 → 400 TIFFINS_OUTSTANDING |
| | Renew with deposit increase → Deficit deducted from balance |
| | Renew with deposit decrease → Surplus credited to balance |
| **Expiry** | ACTIVE → end_date passed, skipped_meal_pool > 0 → BUFFER |
| | ACTIVE → end_date passed, skipped_meal_pool = 0 → EXPIRED (skip buffer) |
| | BUFFER → buffer_expiry_date passed → EXPIRED + refund |
| | BUFFER with remaining meals → Refunded |
| | Settlement with positive balance → CREDIT / PLAN_EXPIRY_SETTLEMENT |
| | Settlement with 0 balance → Clean close |
| | Settlement with tiffins_due > 0 → Deposit forfeited, admin alert |
| **Monitoring** | Dashboard shows days_remaining, can_pause, can_renew flags |
| | Admin EXPIRING_SOON filter returns subs ending within 7 days |
| | Lifecycle timeline endpoint returns full history |
| **Security** | Customer cannot pause/resume/cancel another's subscription |
| | Admin can cancel any subscription (no ownership check) |
| | Unauthenticated access → 401 |
| **Edge cases** | Concurrent pause + cancel → Serialized by transaction |
| | Pause on last day → auto_expire_at adjustment |
| | Resume after end_date → BUFFER status |
| | Renewal chain → renewed_from_id links to parent |
| | Wallet exhausted at settlement → Zero refund, no negative |

---

## Module 9 — Delivery Lifecycle Management

**Status:** `FINALIZED`

### Objective

Manage the full lifecycle of a single delivery record from creation through dispatch, delivery/failure, skip, and cancellation. This module formalizes the state machine that all deliveries traverse, defines the valid transitions between each status, and documents the integration points with generation (M8), dispatch, driver assignment (M12), customer skip (M10), and completion (M14).

### Delivery Status State Machine

```
                          ┌─────────────────────────────┐
                          │         CREATED             │
                          │  (by M8 Delivery Generation)│
                          └────────┬────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────────┐  ┌───────┐
              │ PENDING  │  │BLOCKED_      │  │CANCELLED│
              │          │  │TIFFIN_DEBT   │  │(system)│
              └─────┬────┘  └──────┬───────┘  └───────┘
                    │              │           (Pause/Cancel)
         ┌──────────┤              │
         │          │              │
         ▼          ▼              │
     ┌──────┐  ┌────────┐         │
     │SKIPPED│  │BLOCKED_│         │
     │       │  │LOW_    │         │
     └──────┘  │WALLET  │         │
               └────────┘         │
                    │              │
                    ▼              │
              ┌──────────┐         │
              │DISPATCHED│         │
              └─────┬────┘         │
                    │              │
            ┌───────┼───────┐      │
            │       │       │      │
            ▼       ▼       ▼      │
        ┌──────┐ ┌──────┐ ┌───┐    │
        │DELIVERED│FAILED│ │   │    │
        │        │ │      │ │   │    │
        └────────┘ └──────┘ │   │    │
                            │   │    │
        ┌───────────────────┘   │    │
        │                       │    │
        ▼                       ▼    ▼
    ┌───────────┐         ┌───────────┐
    │FAILED_    │         │EXPIRED_   │
    │RESCHEDULED│         │BUFFER     │
    └───────────┘         │FAILED     │
        │                 └───────────┘
        │                      │
        ▼                      ▼
    (New PENDING        (Refunded —
     delivery for       terminal)
     next day)
```

### All Delivery Statuses

| Status | Meaning | Set By | Transitions To |
|--------|---------|--------|----------------|
| `PENDING` | Created, awaiting dispatch | M8 Generation | `SKIPPED`, `DISPATCHED`, `CANCELLED` |
| `BLOCKED_TIFFIN_DEBT` | Customer has ≥2 tiffins outstanding | M8 Generation | `DISPATCHED` (after debt cleared, admin override), `CANCELLED` |
| `BLOCKED_LOW_WALLET` | Wallet balance < meal price | M8 Generation | `PENDING` (after top-up, auto-recheck cron), `CANCELLED` |
| `SKIPPED` | Customer opted out before cutoff | Customer (M10) | (Terminal — counts toward skip_balance) |
| `DISPATCHED` | Driver assigned + out for delivery | Dispatch Flow / M12 | `DELIVERED`, `FAILED`, `CANCELLED` |
| `DELIVERED` | Successfully handed over | Driver (M14) | (Terminal — reversible via M15 reversal) |
| `FAILED` | Driver could not complete | Driver (M14) | (Terminal) |
| `FAILED_RESCHEDULED` | Buffer meal first failure — rescheduled | M14 (buffer logic) | (Terminal — replaced by new PENDING delivery) |
| `EXPIRED_BUFFER` | Buffer meal expired before delivery | M8 Buffer Expiry Cron | (Terminal — refund to wallet) |
| `EXPIRED_BUFFER_FAILED` | Buffer meal second failure — refunded | M14 (buffer logic) | (Terminal — refund to wallet) |
| `CANCELLED` | System-cancelled (pause, cancel sub, etc.) | System / Admin | (Terminal — refund to wallet) |

### Status Transition Matrix

| From ↓ \ To → | PENDING | SKIPPED | DISPATCHED | DELIVERED | FAILED | FAILED_RESCHEDULED | EXPIRED_BUFFER_FAILED | EXPIRED_BUFFER | CANCELLED | BLOCKED_TIFFIN_DEBT | BLOCKED_LOW_WALLET |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PENDING | — | ✓ | ✓ | — | — | — | — | — | ✓ | — | — |
| BLOCKED_TIFFIN_DEBT | ✓ (override) | — | ✓ (override) | — | — | — | — | — | ✓ | — | — |
| BLOCKED_LOW_WALLET | ✓ (auto) | — | — | — | — | — | — | — | ✓ | — | — |
| DISPATCHED | — | — | — | ✓ | ✓ | — | — | — | ✓ | — | — |
| DELIVERED | — | — | — | — | — | — | — | — | — | — | — |

> Note: DELIVERED is only reversible via the separate reversal flow (M15), not a direct status transition.

### Flows

#### 1. Delivery Creation (M8 Generation)

Already documented in M8. Deliveries are created by cron at scheduled slot times. Status is determined at generation:

*See Module 8 for full generation logic.*

```
Generation Result:
  1a. PENDING           — default (no blocking condition)
  1b. BLOCKED_TIFFIN_DEBT — tiffins_due >= 2
  1c. BLOCKED_LOW_WALLET  — wallet.spendable < price_per_meal_snapshot
```

#### 2. Customer Skip (M10 Aligned)

```
POST /deliveries/:id/skip
  → requireAuth (CUSTOMER), ownership check
  → Validate: status is PENDING
  → Validate: not a buffer meal (CANNOT_SKIP_BUFFER_MEAL)
  → Validate: current time < cutoff_time
  → Validate: subscription.skip_balance > 0
  → BEGIN TRANSACTION:
    → delivery.status = SKIPPED
    → subscription.skip_balance -= 1
    → subscription.skipped_meal_pool += 1
    → audit_log: CUSTOMER_SKIPPED_DELIVERY
  → Returns: 200 { delivery }
```

##### Skip Cutoff Times

| Slot | Cutoff | Behavior after cutoff |
|------|--------|-----------------------|
| BREAKFAST | 20:00 day before (8 PM previous day) | Skip blocked — meal proceeds |
| LUNCH | 09:00 same day (9 AM) | Skip blocked — meal proceeds |
| DINNER | 15:00 same day (3 PM) | Skip blocked — meal proceeds |

##### Business Rules for Skip

| Rule | Detail |
|------|--------|
| Only PENDING can be skipped | DISPATCHED/DELIVERED → 400 INVALID_STATE |
| Buffer meals cannot be skipped | Buffer meals are already "free" from skipped_meal_pool — skipping would double-count |
| Cutoff enforced server-side | Time comparison against cutoff_time field on delivery |
| Skip consumes from skip_balance | If 0 remaining → 400 NO_SKIPS_REMAINING |
| Skipped meals → skipped_meal_pool | Pool funds buffer period after subscription end_date |

#### 3. Dispatch Flow

```
POST /deliveries/:id/dispatch  { driver_id }
  → requireAuth (ADMIN) or auto-assign via M12
  → Validate: delivery.status IN ('PENDING', 'BLOCKED_TIFFIN_DEBT', 'BLOCKED_LOW_WALLET')
  → Validate: driver exists + is_active + role = DELIVERY_BOY
  → BEGIN TRANSACTION:
    → delivery.status = DISPATCHED
    → delivery.driver_id = driver_id
    → route_log: DISPATCHED (lat/lng from kitchen)
    → audit_log: ADMIN_DISPATCHED_DELIVERY or SYSTEM_AUTO_DISPATCHED
  → Returns: 200 { delivery }
```

##### Dispatch Rules

| Rule | Detail |
|------|--------|
| PENDING dispatches normally | Default path |
| BLOCKED_TIFFIN_DEBT requires admin override | Admin sees warning: "tiffin debt active — override?" |
| BLOCKED_LOW_WALLET dispatch blocked | Admin must top-up wallet or recheck first. Endpoint rejects with BLOCKED_LOW_WALLET. |
| Auto-dispatch via M12 | Driver assignment cron assigns pending deliveries in batches — status → DISPATCHED |
| Driver must be DELIVERY_BOY role | RBAC enforced |
| Route log created | GPS coordinates logged at dispatch time |

#### 4. Driver Arrival (Pre-delivery)

```
POST /deliveries/:id/driver/arrive
  → requireAuth (DELIVERY_BOY)
  → Validate: deliveries.driver_id == req.user.id (ownership)
  → Validate: delivery.status IN ('PENDING', 'DISPATCHED')
  → Validate: NOT already DELIVERED (idempotency)
  → BEGIN TRANSACTION:
    → Create route_log: ARRIVED_AT_LOCATION { lat, lng }
    → (status unchanged — still PENDING or DISPATCHED)
  → Returns: 200 { message: "Arrival logged" }
```

#### 5. Delivery Completion (M14 Aligned)

##### 5a. Successful Delivery

```
POST /deliveries/:id/driver/deliver
  → requireAuth (DELIVERY_BOY)
  → Body: { meal_delivered: true, tiffin_returned: bool,
            tiffin_box_id, returned_tiffin_box_id?, lat, lng }
  → Pre-transaction validations (see M14):
      Exists | Not DELIVERED | Status IN (PENDING, DISPATCHED)
      Driver ownership | price_per_meal_snapshot not null
      Tiffin tracker exists | tiffins_due < 2 (pre-check)
      Wallet exists + sufficient | Tiffin box valid + not WITH_CUSTOMER
  → BEGIN TRANSACTION (see M14 full decision tree):
    → delivery.status = DELIVERED
    → delivered_at = NOW()
    → tiffin_box_id set, location_locked = true
    → tiffin_tracker updated (tiffins_due +1, -1 if returned)
    → wallet deduction (MEAL_DEDUCTION)
    → Tiffin penalty / security restoration (if applicable)
    → Tiffin events: DELIVERED, RETURNED/NOT_RETURNED
    → Tiffin boxes: new → WITH_CUSTOMER, returned → IN_KITCHEN
    → Route log: HANDOVER_COMPLETE
    → Audit log: DELIVERY_CONFIRMED
  → Returns: 200 { delivery }
```

##### 5b. Failed Delivery

```
POST /deliveries/:id/driver/fail
  → requireAuth (DELIVERY_BOY)
  → Same pre-validations as arrive (ownership, state)
  → BEGIN TRANSACTION:
    → delivery.status = FAILED
    → route_log: DELIVERY_ATTEMPTED
    → IF is_buffer_meal:
        → Check for previous failure count for this sub + date
        → IF first failure: status = FAILED_RESCHEDULED
            → Create new PENDING delivery for next day (same slot, same sub)
        → IF second failure: status = EXPIRED_BUFFER_FAILED
            → CREDIT wallet: price_per_meal_snapshot (BUFFER_MEAL_EXPIRED_REFUND)
    → ELSE (regular meal):
        → delivery.status = FAILED (terminal)
        → admin_alert: DELIVERY_FAILED
    → Audit log: DELIVERY_FAILED
  → Returns: 200 { delivery }
```

#### 6. Status Auto-Healing

##### 6a. BLOCKED_LOW_WALLET → PENDING Recheck Cron

Runs **5 minutes before each delivery generation** slot (not every 5 min — eliminates unnecessary load):

| Slot | Generation Time | Recheck Cron Time |
|------|----------------|--------------------|
| BREAKFAST | 05:00 AM | 04:55 AM |
| LUNCH | 09:00 AM | 08:55 AM |
| DINNER | 02:00 PM | 01:55 PM |

```
runLowWalletRecheckCron(slot) — runs per slot before generation
  → Query deliveries WHERE status = "BLOCKED_LOW_WALLET"
      AND delivery_date >= today (not past)
      AND slot = <target_slot>
  → For each in batch (500):
    → wallet = subscription_wallets for this sub
    → IF wallet.balance - wallet.security_deposit_held >= price_per_meal_snapshot:
        → delivery.status = PENDING (auto-healed)
        → audit_log: SYSTEM_LOW_WALLET_CLEARED
```

##### 6b. BLOCKED_TIFFIN_DEBT — Manual Only

No auto-heal for tiffin debt. Only admin override or tiffin return + manual action can clear this status.

#### 7. Delivery Monitoring

##### 7a. Customer Views

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `GET /my-subscriptions` (M4 enhanced) | Status summary per sub | Days remaining, upcoming deliveries count |
| `GET /customer/deliveries/by-date?date=...&slot=...` | Single delivery detail (exists) | Delivery record with status |
| `GET /customer/deliveries/today` | **NEW** — Today's deliveries | All deliveries for today across all active subs |
| `GET /customer/deliveries/upcoming` | **NEW** — Next N days | Paginated upcoming deliveries |
| `GET /customer/deliveries/history` | **NEW** — Past deliveries | Paginated history (last 90 days) |

##### 7b. Driver Views

| Endpoint | Capability | Filter |
|----------|------------|--------|
| `GET /deliveries/driver/assigned?date=...&slot=...` | All assigned deliveries (exists) | By date + optional slot |
| — Includes: | Customer name, address, phone | — |
| — Ordered by: | Address (groups same-location deliveries) | — |

##### 7c. Admin Views

| Endpoint | Capability |
|----------|------------|
| `GET /admin/deliveries?date=&slot=&status=&page=&limit=` | Filtered delivery list (exists) |
| — Filters: date, slot, status (single or comma-separated) | All status values |
| — Pagination: page + limit (max 200) | Sorted by created_at desc |
| — Includes: customer info, address | Nested relation |
| `GET /admin/deliveries/blocked` | **NEW** — Aggregated blocked view (TIFFIN_DEBT + LOW_WALLET) |
| `GET /admin/deliveries/stats` | **NEW** — Today's delivery stats (total, delivered, failed, skipped, blocked, pending) |

#### 8. System Cancellation (Internal)

Triggered by subscription pause/cancel/expiry flows (M4), not directly by any user:

```
System cancels deliveries for a subscription:
  → Called by: pauseSubscription, cancelSubscription, processBufferExpirations
  → Target: deliveries WHERE subscription_id = ? AND status = 'PENDING'
            AND delivery_date >= today
  → delivery.status = CANCELLED
  → wallet credit = price_per_meal_snapshot per cancelled delivery
  → transaction_category: PAUSE_REFUND or CANCELLATION_REFUND
```

### Delivery Cutoff and Scheduling

| Slot | Generation Time | Cutoff Time (Skip) | Dispatch Deadline | Driver Window |
|------|----------------|--------------------|--------------------|---------------|
| BREAKFAST | 05:00 AM | 8:00 PM day before | 06:00 AM | 06:00 – 09:00 |
| LUNCH | 09:00 AM | 09:00 AM same day | 10:00 AM | 10:00 – 14:00 |
| DINNER | 02:00 PM | 3:00 PM same day | 03:00 PM | 03:00 – 20:00 |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M4** (Subscription Lifecycle) | Pause/Cancel/Expiry cancel PENDING deliveries with wallet refund. Status CANCELLED. |
| **M8** (Delivery Generation) | Creates PENDING, BLOCKED_TIFFIN_DEBT, BLOCKED_LOW_WALLET deliveries. Entry point. |
| **M10** (Skip Module) | Customer skip transitions PENDING → SKIPPED. Updates skip_balance + skipped_meal_pool. |
| **M12** (Driver Assignment) | Assigns drivers to PENDING deliveries → status DISPATCHED. |
| **M14** (Delivery Completion) | DISPATCHED → DELIVERED or FAILED/FAILED_RESCHEDULED/EXPIRED_BUFFER_FAILED. |
| **M15** (Delivery Reversal) | Reverses DELIVERED → PENDING (special operation, not a standard transition). |
| **M6** (Wallet) | SKIPPED: no wallet impact (skip_balance consumed). DELIVERED: wallet deducted. CANCELLED/EXPIRED: wallet refunded. |

### Database Impact

| Entity | Change | Detail |
|--------|--------|--------|
| `deliveries.slot` | Accept `BREAKFAST` | Currently only LUNCH/DINNER — add BREAKFAST to allowed values (noted in M8) |

No new tables required. All statuses already exist in code or M8/M14 definitions.

### API Endpoints Summary

| Method | Path | Auth | Role | Purpose | Status |
|--------|------|------|------|---------|--------|
| `POST` | `/api/v1/deliveries/generate` | JWT | ADMIN | Manual generation trigger | Exists |
| `POST` | `/api/v1/deliveries/:id/skip` | JWT | CUSTOMER | Skip a pending delivery | Exists |
| `POST` | `/api/v1/deliveries/:id/dispatch` | JWT | ADMIN | Dispatch delivery to driver | NEW |
| `GET` | `/api/v1/deliveries/:id` | JWT | CUSTOMER | View single delivery | Exists |
| `GET` | `/api/v1/deliveries/driver/assigned` | JWT | DELIVERY_BOY | Assigned deliveries | Exists |
| `POST` | `/api/v1/deliveries/:id/driver/arrive` | JWT | DELIVERY_BOY | Log arrival | Exists |
| `POST` | `/api/v1/deliveries/:id/driver/fail` | JWT | DELIVERY_BOY | Mark failed | Exists |
| `POST` | `/api/v1/deliveries/:id/driver/deliver` | JWT | DELIVERY_BOY | Mark delivered | Exists |
| `GET` | `/api/v1/customer/deliveries/today` | JWT | CUSTOMER | Today's deliveries | NEW |
| `GET` | `/api/v1/customer/deliveries/upcoming` | JWT | CUSTOMER | Upcoming deliveries | NEW |
| `GET` | `/api/v1/customer/deliveries/history` | JWT | CUSTOMER | Delivery history | NEW |
| `GET` | `/api/v1/admin/deliveries` | JWT | ADMIN | Filtered delivery list | Exists |
| `GET` | `/api/v1/admin/deliveries/blocked` | JWT | ADMIN | All blocked deliveries | NEW |
| `GET` | `/api/v1/admin/deliveries/stats` | JWT | ADMIN | Today's stats | NEW |

### Out of Scope

| Feature | Deferred To |
|---------|-------------|
| GPS 200m geofence validation | Deferred |
| 15-min driver correction window | Deferred |
| Admin delivery override/force-complete | Deferred |
| Delivery notes and photo upload | Future |
| Customer delivery rating | Future |
| Real-time tracking (driver GPS stream) | Future |
| Delivery time slot selection (customer chooses AM/PM) | Future |

### Edge Cases

| Case | Handling |
|------|----------|
| Delivery created for future date but sub paused | Paused subs are excluded from generation (M8 checks status). |
| Skip attempted after cutoff | Server-time check against cutoff_time. Returns CUTOFF_TIME_PASSED. |
| Skip attempted on buffer meal | Returns CANNOT_SKIP_BUFFER_MEAL. Buffer meals are compensatory — skipping defeats purpose. |
| Dispatch attempted on BLOCKED_LOW_WALLET | Rejected. Admin must top-up wallet. Auto-recheck cron may heal. |
| Concurrent skip + dispatch | Skip checks status=PENDING. If dispatch wins race, skip gets INVALID_STATE. |
| Driver assigned but unassigns | Handle in M12 driver re-assignment flow. |
| Buffer meal fails twice | Second failure → EXPIRED_BUFFER_FAILED + refund. No third attempt. |
| Today's delivery generated, then sub cancelled | System cancels PENDING deliveries with CANCELLED status + wallet refund. |
| Delivery date is in the past | Not generated by cron (targetDate >= today). Manual admin trigger allows past dates for testing. |
| Duplicate generation (same sub, date, slot) | Unique constraint `[subscription_id, delivery_date, slot]` blocks with P2002. |
| BLOCKED_TIFFIN_DEBT delivery manually dispatched | Allowed with admin override warning. Driver will get blocked again at handover if debt not cleared. |
| Multiple subscriptions, same address, same slot | Two independent deliveries. Separate records, separate driver interactions. |
| Skip on deliver + return = true | Only one tiffin returned. Fine — still counts as 1 returned box. |
| Driver marks failed, then tries to mark delivered | Already FAILED → INVALID_STATE. |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| 100K deliveries generated per day | Batch generation (500/batch) in M8. Status updates are single-row. |
| Low-wallet recheck cron | Runs 5 min before each slot generation (3×/day). Paginated (500/batch), minimal overhead. |
| Driver queries at scale | Index on `[driver_id, delivery_date]`. |
| Customer history queries | Index on `[subscription_id, delivery_date]`. Limit history to last 90 days. |
| Admin blocked delivery view | Separate query with status IN filter — uses existing status index. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Create → Dispatch → Arrive → Delivered + returned |
| | Create → Dispatch → Arrive → Delivered + not returned |
| | Create → Skip (before cutoff) → SKIPPED |
| | Create (buffer) → Fail (1st) → FAILED_RESCHEDULED + new delivery created |
| | Create (buffer) → Fail (2nd) → EXPIRED_BUFFER_FAILED + refund |
| | Create → BLOCKED_LOW_WALLET → Top-up → Auto-healed to PENDING |
| **Skip** | Skip after cutoff → CUTOFF_TIME_PASSED |
| | Skip without remaining skips → NO_SKIPS_REMAINING |
| | Skip on buffer meal → CANNOT_SKIP_BUFFER_MEAL |
| | Skip on non-PENDING → INVALID_STATE |
| **Dispatch** | Dispatch PENDING → DISPATCHED |
| | Dispatch BLOCKED_TIFFIN_DEBT → Allowed (admin override) |
| | Dispatch BLOCKED_LOW_WALLET → Rejected |
| | Dispatch to invalid driver → 400/404 |
| **Delivery** | Delivered + returned → tiffins_due net 0, wallet deducted |
| | Delivered + not returned → tiffins_due += 1 |
| | Delivered + not returned + tiffins_due >= 2 → TIFFIN_PENALTY deducted |
| | Delivered + returned + tiffins_due > 0 → tiffins_due -= 1 |
| | Delivered + returned + tiffins_due 0 + security_deducted → SECURITY_RESTORED |
| | Mark failed (regular) → FAILED + admin alert |
| **Blocking** | BLOCKED_TIFFIN_DEBT → Delivery blocked at handover |
| | BLOCKED_LOW_WALLET → Delivery blocked at generation |
| | Both → Highest priority status wins (TIFFIN_DEBT) |
| **Monitoring** | Customer today/upcoming/history → correct pagination |
| | Admin filtered list → correct filters |
| | Admin blocked view → only TIFFIN_DEBT + LOW_WALLET |
| | Admin stats → counts match reality |
| **Security** | Wrong driver tries to deliver → 403 FORBIDDEN |
| | Customer tries to skip another's delivery → 403 |
| | Unauthenticated → 401 |
| | DELIVERY_BOY tries admin endpoint → 403 |
| **Edge cases** | Duplicate driver arrival → Idempotent (route_log creates duplicate entry) |
| | Duplicate delivery completion → ALREADY_PROCESSED |
| | Generate for past date (admin) → Allowed for testing |
| | Generate for future date → Allowed — pre-generation |
| | Cancel subscription → PENDING deliveries CANCELLED + refunded |

---

## Module 5 — Address Management

**Status:** `FINALIZED`

### Objective

Enable customers to manage their delivery addresses independently from subscriptions. Addresses are created once and can be reused across multiple subscriptions. The module covers full CRUD, input validation, service area (pincode-based) checks, and label support for quick selection.

### Schema Changes

#### `delivery_addresses` table — ADD fields

| Field | Type | Notes |
|-------|------|-------|
| `label` | `String? @db.VarChar(20)` | "Home", "Work", "Other" — quick-select label |
| `is_default` | `Boolean @default(false)` | Single default address per user |

#### `service_areas` table — NEW

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `pincode` | `String @unique @db.VarChar(20)` | 6-digit Indian pincode |
| `city` | `String @db.VarChar(100)` | City name |
| `state` | `String @db.VarChar(100)` | State name |
| `is_serviced` | `Boolean @default(true)` | Whether currently serviceable |
| `created_at` | `DateTime @default(now())` | |

### Architecture

```
address.service.ts (NEW)
  ├── createAddress(userId, data)         — Create new delivery address
  ├── getMyAddresses(userId)              — List all active addresses for user
  ├── getAddressById(addressId, userId)   — Single address (with ownership check)
  ├── updateAddress(addressId, userId, data) — Edit address fields
  ├── deleteAddress(addressId, userId)    — Soft-delete (is_active = false)
  ├── setDefaultAddress(addressId, userId) — Mark as default, unset others
  ├── validatePincode(pincode)            — Check pincode is serviceable
  └── isAddressOwnedBy(addressId, userId) — Ownership check (for middleware)

address.routes.ts (NEW)
  CRUD endpoints (CUSTOMER auth)
  Admin read endpoints (ADMIN auth)
```

### Flows

#### 1. Create Address

```
POST /addresses { address_line_1, address_line_2?, landmark?, city, pincode, lat?, lng?, label? }
  → requireAuth (CUSTOMER)
  → Validate required: address_line_1, city, pincode
  → Validate format:
      address_line_1: string, max 255 chars, no HTML tags
      address_line_2: string?, max 255 chars
      landmark: string?, max 255 chars
      city: string, max 100 chars, alphabetic-only
      pincode: exactly 6 digits, must be in service_areas AND is_serviced = true
      lat/lng: decimal lat (-90 to 90), lng (-180 to 180)
      label: one of "Home", "Work", "Other" or null
  → Validate: user has < 5 addresses (max 5 per user)
  → BEGIN TRANSACTION:
    → If this is user's first address: set is_default = true
    → Create delivery_address with:
        user_id = req.user.id, is_active = true
    → audit_log: USER_ADDED_ADDRESS
  → Returns: 201 { address }
```

##### Validation Rules Detail

| Field | Required | Format | Max Length | Notes |
|-------|----------|--------|------------|-------|
| `address_line_1` | Yes | String, no HTML tags | 255 | Building, street, area |
| `address_line_2` | No | String, no HTML tags | 255 | Apartment, floor, etc. |
| `landmark` | No | String | 255 | Near hospital, etc. |
| `city` | Yes | Alphabetic + spaces | 100 | Must not contain numbers |
| `pincode` | Yes | Exactly 6 digits | 20 | Must exist in service_areas with is_serviced = true |
| `lat` | No | Decimal -90 to 90 | — | GPS latitude |
| `lng` | No | Decimal -180 to 180 | — | GPS longitude |
| `label` | No | One of: Home, Work, Other | 20 | Case-insensitive matching |

#### 2. List My Addresses

```
GET /addresses
  → requireAuth (CUSTOMER)
  → Fetch all delivery_addresses WHERE user_id = req.user.id AND is_active = true
  → Ordered by: is_default DESC (defaults first), created_at DESC
  → Returns: 200 { addresses[] }
```

#### 3. Get Single Address

```
GET /addresses/:id
  → requireAuth (CUSTOMER)
  → Ownership check: address.user_id === req.user.id
  → Fetch address
  → If not found or inactive: 404 ADDRESS_NOT_FOUND
  → Returns: 200 { address }
```

#### 4. Update Address

```
PUT /addresses/:id { address_line_1?, address_line_2?, landmark?, city?, pincode?, lat?, lng?, label? }
  → requireAuth (CUSTOMER)
  → Ownership check
  → Validate: address.is_active === true
  → Validate: same rules as create (only provided fields)
  → If pincode changed: re-validate serviceability
  → BEGIN TRANSACTION:
    → Update delivery_address SET provided fields
    → audit_log: USER_UPDATED_ADDRESS (previous_state captured)
  → Returns: 200 { address }
```

#### 5. Delete Address (Soft)

```
DELETE /addresses/:id
  → requireAuth (CUSTOMER)
  → Ownership check
  → Validate: address.is_active === true
  → Validate: address not linked to any ACTIVE or BUFFER subscription
    (otherwise delete is blocked — customer must cancel/subscribe with new address first)
  → BEGIN TRANSACTION:
    → delivery_address.is_active = false
    → If this was default address:
        → Auto-assign next most recent active address as default (if any)
    → audit_log: USER_DELETED_ADDRESS
  → Returns: 200 { message: "Address deleted" }
```

#### 6. Set Default Address

```
PATCH /addresses/:id/default
  → requireAuth (CUSTOMER)
  → Ownership check
  → Validate: address.is_active === true
  → BEGIN TRANSACTION:
    → Update ALL user's addresses: is_default = false (bulk unset)
    → Update this address: is_default = true
    → audit_log: USER_SET_DEFAULT_ADDRESS
  → Returns: 200 { address }
```

#### 7. Validate Pincode (Public)

```
GET /addresses/validate-pincode?pincode=302001
  → No auth required
  → Lookup pincode in service_areas
  → If found AND is_serviced: 200 { serviceable: true, city, state }
  → If found but not serviced: 200 { serviceable: false, message: "Area temporarily not serviceable" }
  → If not found: 200 { serviceable: false, message: "We don't serve this area yet" }
```

#### 8. Admin — Service Area Management

```
GET  /admin/service-areas?page=&limit=&city=&is_serviced=
  → requireAuth (ADMIN)
  → List service_areas with filters (paginated)
  → Returns: 200 { service_areas[], total }

POST /admin/service-areas
  → requireAuth (ADMIN)
  → Body: { pincode, city, state }
  → Validate: pincode already not exists
  → Create service_area with is_serviced = true
  → Returns: 201 { service_area }

PATCH /admin/service-areas/:id
  → requireAuth (ADMIN)
  → Body: { is_serviced, city?, state? }
  → Toggle serviceability status or update metadata
  → audit_log: ADMIN_UPDATED_SERVICE_AREA
  → Returns: 200 { service_area }

DELETE /admin/service-areas/:id
  → requireAuth (ADMIN)
  → Hard delete (pincode no longer served)
  → Returns: 200 { message: "Service area removed" }
```

### Integration with M2 (Subscription Creation)

When M2's `POST /subscriptions` creates an address inline, it should be updated to:

```
Option A (Current — Simplified):
  Address fields sent inline → create address → create subscription
  (No address reuse — each sub creates a fresh address)

Option B (Recommended — Reusable):
  Customer first creates address via POST /addresses (M5)
  Then POST /subscriptions references existing address_id
  → subscription.delivery_address_id = existing address.id
  (Address can be reused across multiple subscriptions)
```

**Decision: Support both patterns.**
- `POST /subscriptions` with inline address fields → creates both address + subscription (backward compatible)
- `POST /subscriptions` with `delivery_address_id` only → uses existing address (new path)
- If both provided: address fields create new address (inline overrides existing reference)

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M2** (Subscription Creation) | Can create address inline (backward compat) OR reference existing address_id |
| **M4** (Subscription Lifecycle) | Cancel/Expiry: address stays active (not deleted). Only marked inactive when user explicitly deletes. |
| **M8/M9** (Delivery Generation) | Delivery records reference subscription's address for driver routing |
| **M12** (Driver Assignment) | Driver route optimization groups deliveries by address_id |
| **Admin** | View any user's addresses; manage service areas and pincode serviceability |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `GET` | `/api/v1/addresses/validate-pincode` | None | Public | Check pincode serviceability |
| `GET` | `/api/v1/addresses` | JWT | CUSTOMER | List my addresses |
| `GET` | `/api/v1/addresses/:id` | JWT | CUSTOMER | Get single address |
| `POST` | `/api/v1/addresses` | JWT | CUSTOMER | Create address |
| `PUT` | `/api/v1/addresses/:id` | JWT | CUSTOMER | Update address |
| `DELETE` | `/api/v1/addresses/:id` | JWT | CUSTOMER | Soft-delete address |
| `PATCH` | `/api/v1/addresses/:id/default` | JWT | CUSTOMER | Set as default |
| `GET` | `/api/v1/admin/service-areas` | JWT | ADMIN | List service areas |
| `POST` | `/api/v1/admin/service-areas` | JWT | ADMIN | Add service area |
| `PATCH` | `/api/v1/admin/service-areas/:id` | JWT | ADMIN | Update service area |
| `DELETE` | `/api/v1/admin/service-areas/:id` | JWT | ADMIN | Remove service area |

### Business Rules

| Rule | Detail |
|------|--------|
| Max 5 addresses per user | Enforced at service layer. Reaching limit → 400 ADDRESS_LIMIT_EXCEEDED. |
| One default address per user | Set/Unset pattern: bulk unset, then set one. |
| Soft delete only | `is_active = false`. Kept for historical subscription references. |
| Delete blocked if linked to active subscription | Must cancel subscription first or change its address. |
| First address auto-default | On first creation, `is_default = true` automatically. |
| Pincode must be serviceable at creation | Hard validation. If pincode later becomes unserviceable, existing deliveries continue. |
| No hard limit on address reuse | One address can be linked to many subscriptions across different time periods. |
| Address snapshotted via FK | Subscription stores `delivery_address_id`. If address is updated, existing subs see latest (not snapshotted). |

### Edge Cases

| Case | Handling |
|------|----------|
| User edits pincode to unserviceable area | Blocked — validation runs on every update. |
| User deletes default address | Next most recent active address becomes default. If none remain, no default set. |
| Admin marks pincode as not serviced | Existing subs with that address continue. New subs blocked if address's pincode not serviced. |
| User has 5 addresses, tries to create 6th | 400 ADDRESS_LIMIT_EXCEEDED. Must delete an inactive one first. |
| Address linked to ACTIVE subscription | Soft-delete blocked. Prompt user: "Address is linked to active subscription. Cancel subscription first or create a new address for existing sub." |
| Lat/Lng validation on update | Optional fields. If provided, validate range. Not validated if omitted. |
| Two subscriptions use same address; user deletes address | Both subscriptions must be inactive first. |
| Pincode validation service unavailable | Fallback: allow pincode (optimistic). Log for admin review. |
| Label normalization | Stores as-is but validates case-insensitively. "home", "HOME", "Home" all → "Home". |

### Seed Data — Service Areas

Initial seed should include the pincodes where ApnaDabba operates. At minimum:

```csv
pincode,city,state
302001,Jaipur,Rajasthan
302002,Jaipur,Rajasthan
302003,Jaipur,Rajasthan
302004,Jaipur,Rajasthan
302005,Jaipur,Rajasthan
... (expand via admin panel)
```

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Create address → List → Get → Update → Set default → Delete |
| | Create first address → auto-default |
| | Create 2 addresses → set B as default → A loses default |
| | Delete default → next available becomes default |
| | Validate pincode (serviceable) → 200 { serviceable: true } |
| | Validate pincode (not found) → 200 { serviceable: false } |
| **Validation** | Create with missing required fields → 400 |
| | Create with invalid pincode (non-numeric) → 400 |
| | Create with unserviceable pincode → 400 |
| | Create with invalid label (not Home/Work/Other) → 400 |
| | Update pincode to unserviceable → 400 |
| | Create address 6 (limit reached) → 400 |
| **Security** | Customer tries to update another's address → 403 |
| | Unauthenticated → 401 |
| | Create/edit with HTML in address_line_1 → 400 |
| **Delete** | Delete address linked to active sub → 400 |
| | Delete inactive address → 404 |
| | Delete twice → 404 (already inactive) |
| **Admin** | Add service area → appears in pincode validation |
| | Toggle service area off → validation blocks new creates |
| | Delete service area → pincode no longer recognized |
| **Edge** | Edit address while linked to active sub → allowed (not blocked) |
| | Two subs share address → delete blocked until both subs inactive |
| | Lat without lng → allowed (optional pair) |

---

## Module 7 — Security Deposit Management

**Status:** `FINALIZED`

### Objective

Manage the full lifecycle of the security deposit collected per subscription — from initial hold through monitoring, penalty deduction, restoration, and final refund or forfeiture at subscription end. The deposit is held in the wallet as non-spendable (`security_deposit_held`) and tracked via `security_deposit_status`. All state transitions are driven by tiffin return behavior (M14), subscription cancel (M4), or expiry settlement (M4), with admin override capability.

### Deposit State Machine

```
                  ┌──────────┐
                  │  ACTIVE  │ ←── Created at subscription creation (M2)
                  └────┬─────┘
                       │
            ┌──────────┼──────────────┐
            │          │              │
            ▼          ▼              ▼
        ┌────────┐ ┌─────────┐ ┌──────────────┐
        │AT_RISK │ │DEDUCTED │ │ PARTIALLY_   │
        │        │ │         │ │ DEDUCTED     │
        └───┬────┘ └────┬────┘ └──────┬───────┘
            │           │             │
            ▼           │             │
        ┌────────┐      │             │
        │ ACTIVE │      │             │
        │(return)│      │             │
        └────────┘      │             │
                        ▼             ▼
                    ┌──────────┐ ┌──────────┐
                    │ REFUNDED │ │ REFUNDED │
                    │          │ │(partial) │
                    └──────────┘ └──────────┘
```

### Status Definitions

| Status | Meaning | Set By | Transitions To |
|--------|---------|--------|----------------|
| `ACTIVE` | Deposit held, no issues. Tiffins_due normal. | Subscription creation (M2) | `AT_RISK`, `DEDUCTED`, `PARTIALLY_DEDUCTED`, `REFUNDED` |
| `AT_RISK` | Tiffins_due >= 1 but < 2 — warning state. Deposit still intact but one more unreturned tiffin triggers penalty. | System (tiffin return check) | `ACTIVE`, `DEDUCTED` |
| `DEDUCTED` | Deposit forfeited as penalty. Tiffins_due crossed threshold (≥ 2) and penalty was applied. Wallet debited for deposit amount. | M14 (tiffin penalty branch) | `ACTIVE` (via SECURITY_RESTORED), `REFUNDED` |
| `PARTIALLY_DEDUCTED` | Only relevant at cancel/expiry. Some tiffins outstanding but not enough to forfeit full deposit. Deposit partially refunded, remainder held. | M4 (cancel/expiry settlement) | `REFUNDED` |
| `REFUNDED` | Deposit fully returned to spendable balance. Terminal state for the deposit lifecycle. | M14 (SECURITY_RESTORED), M4 (settlement), Admin | (Terminal) |

### Schema

#### `subscription_wallets` — Relevant Fields

| Field | Type | Notes |
|-------|------|-------|
| `balance` | `Decimal @db.Decimal(10, 2)` | Total wallet balance (spendable + held) |
| `security_deposit_held` | `Decimal @db.Decimal(10, 2)` | Non-spendable — snapshotted at creation |
| `security_deposit_status` | `String @default("ACTIVE") @db.VarChar(30)` | `ACTIVE \| AT_RISK \| DEDUCTED \| PARTIALLY_DEDUCTED \| REFUNDED` |

#### Spendable Balance Formula

```
spendable = balance - security_deposit_held
```

The deposit is never spendable. `BLOCKED_LOW_WALLET` checks use spendable, not raw balance.

### Architecture

```
wallet.service.ts (extends M6 operations)
  ├── holdDeposit(walletId, amount)           — Set security_deposit_held at creation (M2)
  ├── applyTiffinPenalty(walletId, amount)    — Deduct deposit as penalty (M14)
  ├── restoreDeposit(walletId, amount)        — Credit back deposit after tiffins returned (M14)
  ├── refundDeposit(subscriptionId)           — Full refund at cancel/expiry settlement (M4)
  ├── partialRefundDeposit(subscriptionId)    — Partial refund with remainder held (M4)
  ├── forfeitDeposit(subscriptionId)          — Full forfeiture at expiry settlement (M4)
  ├── adminReleaseDeposit(subscriptionId)     — Admin override: force release/refund
  └── getDepositHistory(subscriptionId)       — Audit trail of all deposit events
```

### Flows

#### 1. Deposit Collection (at Subscription Creation — M2)

Already documented in M2. For completeness:

```
Inside subscribeUser() transaction (M2):
  → subscription_wallets.create({
      balance: 0.00,
      security_deposit_held: plan.security_deposit_snapshot,
      security_deposit_status: "ACTIVE"
    })
```

- The deposit amount is the plan's `security_deposit` at the time of subscription creation (snapshotted).
- It is held in `security_deposit_held` and is never spendable.
- The initial balance is 0 — the customer must top-up separately for meal costs.
- The deposit value is stored in `subscriptions.security_deposit_snapshot` as well.

#### 2. AT_RISK Transition

Triggered after each delivery completion (M14) when `tiffins_due == 1`:

```
After tiffin_tracker update in M14 delivery flow:
  → AFTER meal_delivered = true AND tiffin_returned = false:
      tiffins_due += 1
      IF tiffins_due == 1:
        security_deposit_status = "AT_RISK"
        audit_log: DEPOSIT_STATUS_AT_RISK
```

##### Business Rules for AT_RISK

| Rule | Detail |
|------|--------|
| No wallet impact | Deposit is still held. Only status changes. |
| Notifies customer | AT_RISK is a warning — one more unreturned tiffin triggers actual deduction. |
| Auto-reverts | If tiffin is later returned and tiffins_due drops to 0, status returns to ACTIVE. |

#### 3. Penalty Deduction (DEDUCTED — M14)

Triggered by M14 delivery completion when `tiffins_due >= 2` AND `security_deducted == false`:

Penalty amount comes from `system_configs` key `tiffin_penalty_amount` (admin-configurable, default 500).

```
Inside M14 markDelivered transaction:
  → Pre-check: tiffins_due >= 2 (before this delivery)
  → penalty = system_configs.get("tiffin_penalty_amount") — admin-defined, default 500
  → IF wallet.spendable >= penalty:
      DEBIT wallet: penalty (TIFFIN_PENALTY)
      security_deducted = true (tiffin_tracker)
      security_deposit_status = "DEDUCTED"
      wallet_transaction:
        type: DEBIT
        category: TIFFIN_PENALTY
        amount: penalty
        balance_before, balance_after
        reference_type: DELIVERY
      tiffin_event: PENALTY_APPLIED
      audit_log: DEPOSIT_PENALTY_DEDUCTED
  → ELSE (wallet.spendable < penalty):
      Admin alert: TIFFIN_PENALTY_FAILED_LOW_WALLET
      Block next pending delivery → BLOCKED_TIFFIN_DEBT
```

##### What Happens on Deduction

| Effect | Detail |
|--------|--------|
| `balance` | Decreased by penalty amount |
| `security_deposit_held` | Unchanged — deposit remains held separately |
| `security_deducted` (tiffin_tracker) | Set to true |
| `security_deposit_status` | Changed to DEDUCTED |
| Tiffins_due remain >= 2 | Customer must return tiffins to reduce count |

##### Business Rules for Penalty

| Rule | Detail |
|------|--------|
| Penalty = admin-defined amount | Configured via `system_configs.tiffin_penalty_amount` (default 500). Not tied to deposit amount. |
| Only applies once per subscription | `security_deducted` flag prevents double penalty. |
| Deposit stays held | `security_deposit_held` unchanged. Only penalty amount debited from balance. |
| Insufficient wallet | If spendable < penalty, penalty fails → admin alert + BLOCKED_TIFFIN_DEBT. |

#### 4. Security Restoration (ACTIVE — M14)

Triggered by M14 when tiffins return to 0 after having been previously deducted:

```
Inside M14 markDelivered transaction:
  → IF meal_delivered = true AND tiffin_returned = true:
      tiffins_due unchanged (net +1 -1 = 0)
      → Actually: tiffins_due += 1, then check if returned:
        IF tiffins_due > 0 AND tiffin_returned:
          tiffins_due -= 1 (net effect depends on starting value)
  
  → IF after update, tiffins_due == 0 AND security_deducted == true:
      security_deducted = false (tiffin_tracker)
      security_deposit_status = "ACTIVE"
      tiffin_event: SECURITY_RESTORED
      audit_log: DEPOSIT_RESTORED
      // Note: Penalty was already debited from balance. Restoration does not refund the penalty.
      // It only marks the deposit status back to ACTIVE.
```

##### Restoration Logic

| Condition | Action |
|-----------|--------|
| tiffins_due == 0 AND security_deducted == true | Status restored to ACTIVE. Deposit stays held. Penalty not refunded. |
| tiffins_due > 0 | No restoration. Deposit remains DEDUCTED until all tiffins returned. |
| tiffins_due == 0 BUT security_deducted == false | No restoration needed. Deposit was never deducted (ACTIVE throughout). |

#### 5. Refund at Cancellation (M4 Cancel Flow)

```
Inside cancelSubscription() transaction (M4):
  → IF tiffins_due == 0:
      wallet.balance += security_deposit_held
      security_deposit_status = "REFUNDED"
      security_deposit_held = 0
      wallet_transaction: CREDIT / SECURITY_DEPOSIT_REFUND
      audit_log: DEPOSIT_REFUNDED_CANCELLATION
  → ELSE (tiffins_due > 0):
      security_deposit_status = "PARTIALLY_DEDUCTED"
      // Deposit held — customer must return tiffins before refund
      audit_log: DEPOSIT_HELD_TIFFINS_OUTSTANDING
```

#### 6. Deposit at Expiry Settlement (M4)

```
Inside settleExpiredSubscription() transaction (M4):
  → IF security_deposit_status already "DEDUCTED" (penalty previously applied):
      // Already handled. No further action needed.
  → ELSE IF tiffins_due == 0:
      refund_security = security_deposit_held
      wallet.balance += refund_security
      security_deposit_status = "REFUNDED"
      security_deposit_held = 0
      wallet_transaction: CREDIT / SECURITY_DEPOSIT_REFUND
  → ELSE (tiffins_due > 0):
      // Deposit not refunded — forfeited due to outstanding tiffins
      security_deposit_status = "DEDUCTED"
      wallet.balance += security_deposit_held  // Release from held
      wallet.balance -= security_deposit_held  // Deduct from balance
      // Net effect: balance unchanged, deposit forfeited
      security_deposit_held = 0
      wallet_transaction: DEBIT / SECURITY_DEPOSIT_FORFEITED
      admin_alert: DEPOSIT_FORFEITED_TIFFINS_OUTSTANDING
```

#### 7. Deposit Handling at Renewal (M4 Renewal Flow)

```
Inside renewSubscription() transaction (M4):
  → Create new wallet for new subscription:
      security_deposit_held = new_plan.security_deposit (fresh snapshot)
      security_deposit_status = "ACTIVE"
      balance = old_wallet.balance (remaining after settlement)

  → Deposit comparison between old and new:
      IF old_wallet.security_deposit_held > new_deposit:
          surplus = old_deposit - new_deposit
          balance += surplus (credited to wallet)
      IF old_wallet.security_deposit_held < new_deposit:
          deficit = new_deposit - old_deposit
          balance -= deficit (deducted from wallet)
          (If balance insufficient, renewal blocked)

  → Old wallet: security_deposit_status = "REFUNDED" (as part of settlement)
```

#### 8. Admin Override — Manual Deposit Release

```
POST /admin/wallets/:subscriptionId/release-deposit { reason }
  → requireAuth (ADMIN)
  → Validate: subscription exists
  → BEGIN TRANSACTION:
    → Read current security_deposit_status
    → If status is "REFUNDED": return 400 DEPOSIT_ALREADY_RELEASED
    → wallet.balance += security_deposit_held
    → security_deposit_held = 0
    → security_deposit_status = "REFUNDED"
    → wallet_transaction: CREDIT / DEPOSIT_ADMIN_RELEASED
    → audit_log: ADMIN_RELEASED_DEPOSIT (reason captured in notes)
    → Clear any related BLOCKED_TIFFIN_DEBT if applicable
  → Returns: 200 { wallet }
```

#### 9. Admin Override — Manual Deposit Forfeit

```
POST /admin/wallets/:subscriptionId/forfeit-deposit { reason }
  → requireAuth (ADMIN)
  → Validate: subscription exists
  → BEGIN TRANSACTION:
    → If status is "REFUNDED" or "DEDUCTED": return 400 DEPOSIT_ALREADY_PROCESSED
    → balance -= security_deposit_held (but enforce balance >= 0)
    → security_deposit_held = 0
    → security_deposit_status = "DEDUCTED"
    → wallet_transaction: DEBIT / DEPOSIT_ADMIN_FORFEITED
    → audit_log: ADMIN_FORFEITED_DEPOSIT (reason captured)
  → Returns: 200 { wallet }
```

### Deposit Status Transition Summary

| Current Status | Event | New Status |
|----------------|-------|------------|
| ACTIVE | Tiffins_due becomes 1 (one tiffin not returned) | AT_RISK |
| ACTIVE | Cancel/expiry with tiffins_due == 0 | REFUNDED |
| ACTIVE | Cancel with tiffins_due > 0 | PARTIALLY_DEDUCTED |
| ACTIVE | Admin forfeit | DEDUCTED |
| AT_RISK | Tiffins_due drops to 0 (tiffin returned) | ACTIVE |
| AT_RISK | Tiffins_due >= 2 and penalty applied | DEDUCTED |
| AT_RISK | Cancel/expiry settle | PARTIALLY_DEDUCTED or REFUNDED |
| DEDUCTED | Tiffins_due == 0 AND security_deducted restored | ACTIVE |
| DEDUCTED | Expiry settlement (already deducted — no change) | DEDUCTED (remains) |
| DEDUCTED | Admin release | REFUNDED |
| PARTIALLY_DEDUCTED | All tiffins returned after cancel | Admin must trigger release → REFUNDED |
| REFUNDED | (Terminal) | — |

### system_configs Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `tiffin_penalty_amount` | `500` | Penalty amount debited from wallet when tiffins_due >= 2. Admin-configurable. |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `GET` | `/api/v1/admin/wallets/:subscriptionId` | JWT | ADMIN | View wallet + deposit status (exists) |
| `POST` | `/api/v1/admin/wallets/:subscriptionId/release-deposit` | JWT | ADMIN | Admin release deposit to balance |
| `POST` | `/api/v1/admin/wallets/:subscriptionId/forfeit-deposit` | JWT | ADMIN | Admin forfeit deposit |
| `GET` | `/api/v1/admin/wallets/:subscriptionId/deposit-history` | JWT | ADMIN | Full deposit audit trail |
| `GET` | `/api/v1/admin/deposits/at-risk` | JWT | ADMIN | All subscriptions with status AT_RISK |
| `GET` | `/api/v1/admin/deposits/forfeited` | JWT | ADMIN | All subscriptions with deposit for feature tracking |

### Transaction Categories (Additions to M6)

| Category | Type | When |
|----------|------|------|
| `TIFFIN_PENALTY` | DEBIT | M14 — tiffins_due >= 2, deposit deducted |
| `SECURITY_RESTORED` | CREDIT | M14 — tiffins returned after penalty |
| `SECURITY_DEPOSIT_REFUND` | CREDIT | M4 — full refund at cancel/expiry |
| `SECURITY_DEPOSIT_FORFEITED` | DEBIT | M4 — forfeited at expiry with tiffins_due > 0 |
| `DEPOSIT_ADMIN_RELEASED` | CREDIT | Admin override release |
| `DEPOSIT_ADMIN_FORFEITED` | DEBIT | Admin override forfeit |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M2** (Subscription Creation) | Deposit held at creation. `security_deposit_held = plan.security_deposit_snapshot`, status = ACTIVE. |
| **M4** (Subscription Lifecycle) | Cancel: refund if tiffins_due == 0, else PARTIALLY_DEDUCTED. Expiry settlement: refund or forfeit. Renewal: compare old vs new deposit, adjust balance. |
| **M6** (Wallet) | Spendable = balance - deposit_held. Deduction/credits share wallet transaction table. |
| **M14** (Delivery Completion) | AT_RISK, DEDUCTED, SECURITY_RESTORED transitions driven by tiffin return behavior. |
| **M15** (Delivery Reversal) | Reversal may need to unwind deposit status changes if they occurred in the original delivery. |

### Edge Cases

| Case | Handling |
|------|----------|
| Penalty deduction with insufficient wallet (spendable < penalty amount) | Admin alert raised. BLOCKED_TIFFIN_DEBT applied. Deposit remains ACTIVE. |
| Customer returns tiffin after DEDUCTED status | SECURITY_RESTORED flow re-holds deposit. Wallet credited. |
| Customer returns tiffin after PARTIALLY_DEDUCTED (cancel) | Admin must manually release remaining deposit. No auto-restoration after cancellation. |
| Admin releases deposit that was already refunded | Blocked: DEPOSIT_ALREADY_RELEASED. |
| Admin forfeits deposit that was already deducted | Blocked: DEPOSIT_ALREADY_PROCESSED. |
| Balance < penalty amount at penalty time | CHECK constraint balance >= 0 prevents negative. Penalty blocked. Admin alert raised. |
| Security deposit changes at plan level mid-cycle | Irrelevant — deposit is snapshotted at subscription creation. |
| Multiple tiffins returned on single delivery | tiffin_returned = true adds one return. tiffins_due -= 1. If multiple boxes returned, additional deliveries needed. |
| Concurrent penalty + refund attempt | `SELECT FOR UPDATE` serializes. One succeeds, other retries or fails. |
| Deposit_held > balance at creation | Impossible — balance starts at 0, deposit_held set to plan value. Wallet starts with balance < deposit. Customer must top-up before ordering. |
| Deposit_held exactly equals balance | spendable = 0. All deliveries blocked (BLOCKED_LOW_WALLET) until top-up. |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| AT_RISK monitoring query | Single query: `tiffin_tracker.tiffins_due = 1` JOIN subscriptions. Low cardinality. |
| Admin deposit-at-risk view | Paginated query with filter on security_deposit_status = AT_RISK. Index on status column. |
| Concurrent penalty at scale | SELECT FOR UPDATE per wallet. No batch deadlocks since each delivery is independent. |
| Deposit history audit | wallet_transactions already indexed by wallet_id + created_at. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Sub created → ACTIVE status, deposit_held set |
| | Delivered + not returned → AT_RISK (tiffins_due = 1) |
| | Delivered + not returned again → DEDUCTED (tiffins_due >= 2, penalty applied) |
| | Tiffin returned after DEDUCTED → SECURITY_RESTORED, deposit re-held |
| | Cancel with tiffins_due == 0 → REFUNDED |
| | Cancel with tiffins_due > 0 → PARTIALLY_DEDUCTED |
| | Expire with tiffins_due == 0 → REFUNDED |
| | Expire with tiffins_due > 0 → FORFEITED |
| **Penalty** | Penalty with sufficient wallet → deducted (amount = system_configs.tiffin_penalty_amount) |
| | Penalty with insufficient wallet → admin alert, BLOCKED_TIFFIN_DEBT |
| | Double penalty prevented (security_deducted flag) |
| | Admin changes tiffin_penalty_amount → next penalty uses new value |
| **Restoration** | Tiffin returned, tiffins_due 0, security_deducted true → restored |
| | Tiffin returned, tiffins_due still > 0 → no restoration |
| | Tiffin returned, security_deducted false → no-op |
| **Admin** | Admin release → deposit to balance, status REFUNDED |
| | Admin forfeit → deposit deducted, status DEDUCTED |
| | Admin release on already REFUNDED → 400 |
| **Renewal** | Renew with larger deposit → deficit deducted |
| | Renew with smaller deposit → surplus credited |
| | Renew with exact same deposit → no balance adjustment |
| **Edge** | AT_RISK → return one tiffin → back to ACTIVE |
| | DEDUCTED → return all tiffins → SECURITY_RESTORED |
| | PARTIALLY_DEDUCTED → admin manual release → REFUNDED |
| | Concurrent penalty + top-up → serialized by SELECT FOR UPDATE |
| | Deposit_held = balance → BLOCKED_LOW_WALLET |

---

## Module 10 — Skip Meal Management

**Status:** `FINALIZED`

### Objective

Enable customers to skip individual meal deliveries before cutoff time. Skipped meals consume from the subscription's skip balance and accumulate into a skipped meal pool, which funds the buffer period after the subscription end_date. The module supports both fixed-skip plans (weekly, half-monthly) and flexible-skip plans (monthly, unlimited with daily caps), as well as future skip scheduling.

### Schema

#### Relevant `subscriptions` Fields (from M2/M4)

| Field | Type | Notes |
|-------|------|-------|
| `skip_balance` | `Int @default(0)` | Remaining skips available. Decremented on each skip. |
| `skipped_meal_pool` | `Int @default(0)` | Accumulated skipped meals. Incremented on each skip. Transferred to buffer_meals_remaining at expiry. |
| `skip_limit_snapshot` | `Int` | Snapshotted from plan_configs at creation. `null` for flexible-skip plans. |

#### Relevant `plan_configs` Fields (from M3)

| Field | Type | Notes |
|-------|------|-------|
| `skip_limit` | `Int?` | Number of allowed skips. `null` = flexible skip. |
| `is_flexible_skip` | `Boolean @default(false)` | If true, customer can skip any number (subject to daily cap). |
| `flexible_skip_max_per_day` | `Int @default(1)` | Max skips per day for flexible skip plans. |

### Architecture

```
skip.service.ts (NEW — dedicated skip service)
  ├── skipDelivery(deliveryId, userId)              — Skip a single delivery
  ├── scheduleFutureSkip(subscriptionId, date, slot)  — Schedule skip in advance
  ├── cancelScheduledSkip(skipScheduleId, userId)     — Cancel a scheduled skip
  ├── getScheduledSkips(subscriptionId)               — List scheduled skips
  ├── getSkipHistory(userId, page, limit)             — Customer skip history
  ├── applyScheduledSkips(targetDate, slot)           — Cron: convert scheduled skips to actual skips
  └── getConsumableSkips(subscription)                — Compute remaining consumable skips
```

### Skip Behavior by Plan Type

| Plan Type | skip_limit | is_flexible_skip | Behavior |
|-----------|------------|------------------|----------|
| Trial | 0 | false | No skips allowed |
| Weekly | 2 (SINGLE), 4 (COMBO) | false | Fixed number for entire duration |
| Half-Monthly | 5 (SINGLE), 10 (COMBO) | false | Fixed number for entire duration |
| Monthly | null | true | Unlimited skips, capped at `flexible_skip_max_per_day` (1) per day |

### Flows

#### 1. Single Delivery Skip (Immediate)

```
POST /deliveries/:id/skip
  → requireAuth (CUSTOMER), ownership check via delivery.subscription.user_id
  → Validate: delivery.status === "PENDING"  (not already skipped/dispatched/delivered)
  → Validate: delivery.is_buffer_meal === false  (buffer meals cannot be skipped)
  → Validate: current time < delivery.cutoff_time  (cutoff not passed)
  → Validate: consumable skips available for this subscription today
      → Determine plan type:
          IF is_flexible_skip:
            Count today's skips already used (delivery.date = today, status = SKIPPED)
            IF count >= flexible_skip_max_per_day: → 400 DAILY_SKIP_LIMIT_EXCEEDED
          ELSE (fixed skip):
            IF skip_balance <= 0: → 400 NO_SKIPS_REMAINING
  → BEGIN TRANSACTION:
    → delivery.status = "SKIPPED"
    → subscription.skip_balance -= 1  (only for fixed-skip plans; flexible plans don't decrement)
    → subscription.skipped_meal_pool += 1
    → audit_log: CUSTOMER_SKIPPED_DELIVERY
      (log includes: delivery_id, slot, date, cutoff_time, skip_balance_after)
  → Returns: 200 { delivery }
```

##### Skip Validation Matrix

| Condition | Error | HTTP |
|-----------|-------|------|
| Delivery not found | `DELIVERY_NOT_FOUND` | 404 |
| Customer doesn't own subscription | `FORBIDDEN` | 403 |
| Status not PENDING (already DISPATCHED/DELIVERED/SKIPPED) | `INVALID_STATE` | 400 |
| Buffer meal | `CANNOT_SKIP_BUFFER_MEAL` | 400 |
| After cutoff time | `CUTOFF_TIME_PASSED` | 400 |
| Fixed-skip: skip_balance <= 0 | `NO_SKIPS_REMAINING` | 400 |
| Flexible-skip: daily limit reached | `DAILY_SKIP_LIMIT_EXCEEDED` | 400 |

#### 2. Cutoff Time Detail

Cutoff times are stored on each delivery record at generation time (M8). The skip endpoint compares `NOW()` against `delivery.cutoff_time`.

| Slot | Generation | Cutoff Time | Cutoff Description |
|------|------------|-------------|-------------------|
| BREAKFAST | 05:00 AM | 20:00 day before | 8 PM previous day |
| LUNCH | 09:00 AM | 09:00 same day | 9 AM same day |
| DINNER | 02:00 PM | 15:00 same day | 3 PM same day |

**Cutoff storage:** `deliveries.cutoff_time` is a `DateTime` field set during generation. The cron sets:
- BREAKFAST cutoff = targetDate - 1 day, 20:00
- LUNCH cutoff = targetDate, 09:00
- DINNER cutoff = targetDate, 15:00

**Server-time enforcement:**
```
IF NOW() >= delivery.cutoff_time → CUTOFF_TIME_PASSED
```

**Timezone:** All times are in IST (UTC+5:30). The server runs with `process.env.TZ = 'Asia/Kolkata'`.

#### 3. Flexible Skip — Daily Cap Logic

For monthly plans where `is_flexible_skip = true`:

```
consumableSkipsToday(subscriptionId, date):
  → Count deliveries for this subscription on this date with status = "SKIPPED"
  → IF count >= subscription.flexible_skip_max_per_day_snapshot (default 1):
      → DAILY_SKIP_LIMIT_EXCEEDED
  → ELSE: skip allowed
```

Key differences from fixed-skip:
- `skip_balance` is not decremented (it's null/ignored for flexible plans)
- `skipped_meal_pool` IS incremented (still funds buffer period)
- Daily cap resets at midnight IST

#### 4. Duplicate Skip Prevention

**Single delivery:** Once a delivery is `SKIPPED`, any subsequent skip attempt gets `INVALID_STATE` because status is no longer `PENDING`.

**Multi-meal subscriptions (COMBO plans):** Each meal slot (LUNCH, DINNER) is a separate delivery record. Customer can skip all, one, or none independently.

#### 5. Future Skip Scheduling

```
POST /subscriptions/:id/schedule-skip { date, slot }
  → requireAuth (CUSTOMER), ownership check
  → Validate: date >= today AND date <= subscription.end_date
  → Validate: slot IN ('BREAKFAST', 'LUNCH', 'DINNER') matching plan's meal_combination
  → Validate: not a buffer meal date (subscription must be ACTIVE on that date)
  → Validate: skip balance consumable on that date (same logic as immediate skip)
  → BEGIN TRANSACTION:
    → Create skip_schedule:
        subscription_id, scheduled_date, slot, status = "SCHEDULED"
    → Immediately decrement skip_balance (locked at scheduling time, not at execution)
      (For flexible: skip counts against that day's cap at scheduling time)
    → audit_log: CUSTOMER_SCHEDULED_SKIP
  → Returns: 201 { skip_schedule }
```

##### Cron: Apply Scheduled Skips (runs at 04:30 AM daily, before first generation)

```
applyScheduledSkips():
  → Query skip_schedules WHERE scheduled_date = today AND status = "SCHEDULED"
  → For each in batch (500):
    → IF delivery already exists for [subscription_id, date, slot]:
        → delivery.status = "SKIPPED"
        → subscription.skipped_meal_pool += 1
    → ELSE:
        → Create delivery with status = "SKIPPED"
          (skip means no meal was ever generated)
        → subscription.skipped_meal_pool += 1
    → skip_schedule.status = "APPLIED"
    → audit_log: SYSTEM_APPLIED_SCHEDULED_SKIP
```

##### Future Skip Schema

New table:

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `subscription_id` | `String` | FK to subscriptions |
| `scheduled_date` | `DateTime @db.Date` | Date to skip |
| `slot` | `String @db.VarChar(20)` | BREAKFAST, LUNCH, or DINNER |
| `status` | `String @default("SCHEDULED")` | `SCHEDULED \| APPLIED \| CANCELLED` |
| `created_at` | `DateTime @default(now())` | |

**Unique:** `[subscription_id, scheduled_date, slot]` — prevents double-scheduling.

```
POST /subscriptions/:id/schedule-skip/:scheduleId/cancel
  → requireAuth (CUSTOMER), ownership check
  → Validate: skip_schedule.status === "SCHEDULED"
  → BEGIN TRANSACTION:
    → skip_schedule.status = "CANCELLED"
    → IF NOT yet applied (status = "SCHEDULED"):
        → Refund the skip: subscription.skip_balance += 1 (if fixed-skip)
        → (For flexible: no balance to refund, daily cap freed up)
    → audit_log: CUSTOMER_CANCELLED_SCHEDULED_SKIP
  → Returns: 200 { skip_schedule }
```

##### Business Rules for Scheduled Skips

| Rule | Detail |
|------|--------|
| Skip balance locked at scheduling time | Immediate consumption. Prevents race with other skips. |
| Flexible skip daily cap | Locked at scheduling time against the target date's cap. |
| Cancel before execution | Refunds the skip balance (fixed plans only). Flexible: frees daily cap. |
| Cannot cancel after applied | Status must be SCHEDULED. APPLIED → block. |
| Scheduled skip survives pause/resume | Schedule remains. Applied when cron runs on target date. |
| Delivery may not exist yet | Cron creates delivery with SKIPPED status if generation hasn't run yet. |

#### 6. Skipped Meal Pool → Buffer Conversion

At plan expiry (M4/M8 flow):

```
Inside runPlanExpiryCron():
  → For each ACTIVE subscription WHERE end_date < today:
      IF skipped_meal_pool > 0:
          status = BUFFER
          buffer_meals_remaining = skipped_meal_pool
          // Pool becomes buffer meals — delivered during buffer period
      ELSE:
          status = EXPIRED (skip buffer)
```

The pool is the bridge between skips and buffer. Every skip = one buffer meal available after end_date.

#### 7. Skip History (Customer)

```
GET /my-skips?page=1&limit=20&from_date=&to_date=
  → requireAuth (CUSTOMER)
  → Fetch all deliveries for user's subscriptions
      WHERE status = "SKIPPED"
      AND delivery_date BETWEEN from_date AND to_date
  → Ordered by: delivery_date DESC, slot ASC
  → Include: subscription plan_code_snapshot, slot, delivery_date, cutoff_time
  → Returns: 200 { skips[], total, page, limit }
```

#### 8. Admin — Skip Monitoring

```
GET /admin/skips?subscription_id=&date=&page=&limit=
  → requireAuth (ADMIN)
  → Fetch all SKIPPED deliveries with filters
  → Include: customer name, plan, slot, date
  → Returns: 200 { skips[], total }

GET /admin/skip-summary?subscription_id=
  → requireAuth (ADMIN)
  → Returns skip usage stats for a subscription:
      total_skips, remaining_balance, skipped_meal_pool,
      scheduled_skips_count, daily_breakdown[]
```

### Integration with M4 (Subscription Lifecycle)

| M4 Event | Skip Impact |
|----------|-------------|
| **Cancel** | PENDING deliveries refunded. SKIPPED deliveries remain as-is (already consumed skip). No refund for skips. |
| **Expiry** | skipped_meal_pool → buffer_meals_remaining. Any undelivered buffer meals refunded at buffer expiry. |
| **Pause** | PENDING deliveries cancelled + refunded. Scheduled skips remain SCHEDULED. Applied on resume cron. |
| **Renewal** | skipped_meal_pool is refunded as wallet credit. New sub starts with fresh skip_balance = 0. |

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/deliveries/:id/skip` | JWT | CUSTOMER | Skip a delivery (exists) |
| `POST` | `/api/v1/subscriptions/:id/schedule-skip` | JWT | CUSTOMER | Schedule a future skip |
| `POST` | `/api/v1/subscriptions/:id/schedule-skip/:scheduleId/cancel` | JWT | CUSTOMER | Cancel a scheduled skip |
| `GET` | `/api/v1/my-skips` | JWT | CUSTOMER | Skip history |
| `GET` | `/api/v1/subscriptions/:id/scheduled-skips` | JWT | CUSTOMER | List scheduled skips |
| `GET` | `/api/v1/admin/skips` | JWT | ADMIN | All skips with filters |
| `GET` | `/api/v1/admin/skip-summary/:subscriptionId` | JWT | ADMIN | Skip usage summary |

### Business Rules

| Rule | Detail |
|------|--------|
| Buffer meals cannot be skipped | They're compensatory — already funded by a previous skip. |
| Skip = no wallet impact | Meal is not generated/delivered, so no deduction occurs. |
| Fixed-skip: skip_balance decremented | One skip consumes one unit from the plan's limit. |
| Flexible-skip: no balance decrement | Unlimited skips, capped daily at `flexible_skip_max_per_day`. |
| skip_balance never goes below 0 | Validated before decrement. DB CHECK constraint on subscription. |
| Skipped meal always funds the pool | Pool becomes buffer meals at expiry. |
| Scheduled skip locks balance at booking | Prevents oversubscription of skips on the same date. |
| Cancel scheduled skip refunds balance | Only for fixed-skip. Flexible skips free the daily cap slot. |
| Skip history = deliveries with status SKIPPED | Also includes scheduled skips that were APPLIED. |

### system_configs Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `skip_cutoff_breakfast_hours` | `20` | Hour of cutoff (24h) for BREAKFAST |
| `skip_cutoff_lunch_hours` | `9` | Hour of cutoff for LUNCH |
| `skip_cutoff_dinner_hours` | `15` | Hour of cutoff for DINNER |

### Edge Cases

| Case | Handling |
|------|----------|
| Customer skips all remaining meals in a day | Allowed — each slot is an independent skip. |
| Skip on subscription with TRIAL plan | `skip_limit_snapshot = 0` → NO_SKIPS_REMAINING. |
| Skip after subscription end_date | Delivery won't exist for that date (generation only for ACTIVE/BUFFER). |
| Skip while subscription is PAUSED | No PENDING deliveries to skip. Skip endpoint blocked (no delivery or status not PENDING). |
| Scheduled skip for buffer meal date | Blocked — subscription won't be ACTIVE on that date. |
| Schedule skip on a date before cutoff time | Valid — scheduling is independent of cutoff. Applied at cron execution (04:30 AM). |
| Concurrent skip + dispatch | Skip checks status = PENDING. If dispatch wins, skip → INVALID_STATE. |
| Delivery already skipped (double request) | SKIPPED status → INVALID_STATE on second call. |
| Flexible skip: daily cap = 2, user tries 3 skips | Third skip → DAILY_SKIP_LIMIT_EXCEEDED. |
| Scheduled skip, then sub cancelled before execution | Schedule cancelled automatically (cascade or cleanup cron). |
| Multiple scheduled skips on same date, different slots | Allowed — each slot independently scheduled. |
| Admin skip for customer | Not supported — skip is customer self-service only. Admin can cancel deliveries (M9 CANCELLED status). |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| Skip history queries | Index on `[subscriptions.user_id, deliveries.status, deliveries.delivery_date]`. |
| Scheduled skip cron | Runs once daily (04:30 AM). Batch of 500. |
| Flexible skip daily cap check | Count of SKIPPED deliveries for [subscription_id, date]. Index on `[subscription_id, delivery_date, status]`. |
| Concurrent skip on same subscription | `SELECT FOR UPDATE` on subscription row inside transaction serializes. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Skip PENDING delivery before cutoff → SKIPPED, skip_balance decremented, pool incremented |
| | Skip in flexible plan → No balance change, pool incremented |
| | Schedule skip → Appears in scheduled list |
| | Cron applies scheduled skip → delivery SKIPPED |
| | Cancel scheduled skip → Refunded, schedule CANCELLED |
| | Skip history → paginated list of all SKIPPED deliveries |
| **Validation** | Skip after cutoff → CUTOFF_TIME_PASSED |
| | Skip on buffer meal → CANNOT_SKIP_BUFFER_MEAL |
| | Skip without balance → NO_SKIPS_REMAINING |
| | Skip on DISPATCHED delivery → INVALID_STATE |
| | Skip on DELIVERED delivery → INVALID_STATE |
| | Flexible skip exceed daily cap → DAILY_SKIP_LIMIT_EXCEEDED |
| | Schedule skip on past date → 400 |
| | Schedule skip for invalid slot (unmatched plan) → 400 |
| **Scheduling** | Schedule + cancel → balance restored |
| | Schedule + cancel after applied → blocked |
| | Double schedule same date+slot → unique constraint |
| | Schedule across multiple dates → all independent |
| **Edge** | COMBO plan: skip LUNCH, keep DINNER → one SKIPPED, one PENDING |
| | Skip: skipped_meal_pool → buffer → meals delivered |
| | Skip + pause → deliveries cancelled, scheduled skips remain |
| | Skip + cancel → SKIPPED stays, PENDING refunded. Skip balance not refunded. |
| | Skip + expiry → skipped_meal_pool funds buffer |
| **Security** | Skip another customer's delivery → 403 FORBIDDEN |
| | Unauthenticated → 401 |
| | Cancel another's scheduled skip → 403 |

---

## Module 11 — Driver Management

**Status:** `FINALIZED`

### Objective

Manage the full lifecycle of delivery drivers (role = `DELIVERY_BOY`) from admin onboarding through profile management, availability tracking, workload monitoring, and deactivation. Drivers are users with extended profile fields for vehicle details, service areas, and operational capacity. This module feeds into M12 (Driver Assignment) and M9 (Delivery Dispatch).

### Schema Changes

#### `users` table — ADD driver-specific fields

| Field | Type | Notes |
|-------|------|-------|
| `avatar_url` | `String?` | Profile photo |
| `phone` | `String @unique @db.VarChar(20)` | Already exists — primary contact |
| `is_active` | `Boolean @default(true)` | Already exists — enables/disables driver |

#### `driver_profiles` table — NEW

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `user_id` | `String @unique` | FK to users |
| `vehicle_type` | `String @db.VarChar(30)` | `BIKE` / `SCOOTER` / `CAR` / `WALK` |
| `vehicle_number` | `String? @db.VarChar(20)` | License plate |
| `max_load` | `Int @default(20)` | Max deliveries per slot |
| `current_load` | `Int @default(0)` | Assigned deliveries for current slot (reset daily) |
| `availability_status` | `String @default("AVAILABLE") @db.VarChar(20)` | `AVAILABLE` / `BUSY` / `OFF_DUTY` / `ON_BREAK` |
| `service_pincodes` | `Json @default("[]")` | Array of pincodes this driver serves |
| `latitude` | `Decimal? @db.Decimal(10, 8)` | Current GPS lat |
| `longitude` | `Decimal? @db.Decimal(11, 8)` | Current GPS lng |
| `last_location_update` | `DateTime?` | Timestamp of last GPS ping |
| `total_deliveries_completed` | `Int @default(0)` | Lifetime counter |
| `total_deliveries_failed` | `Int @default(0)` | Lifetime counter |
| `rating` | `Decimal @default(0.0) @db.Decimal(2, 1)` | Average rating (0.0–5.0) |
| `verified_at` | `DateTime?` | When admin verified documents |
| `is_verified` | `Boolean @default(false)` | Document verification status |
| `joined_at` | `DateTime @default(now())` | When driver was onboarded |
| `updated_at` | `DateTime @updatedAt` | |

#### `driver_documents` table — NEW

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `user_id` | `String` | FK to users |
| `document_type` | `String @db.VarChar(50)` | `AADHAAR` / `DRIVING_LICENSE` / `VEHICLE_RC` |
| `document_url` | `String` | S3/file URL |
| `status` | `String @default("PENDING") @db.VarChar(20)` | `PENDING` / `VERIFIED` / `REJECTED` |
| `rejection_reason` | `String?` | Reason if rejected |
| `verified_by` | `String?` | Admin user ID who verified |
| `verified_at` | `DateTime?` | |
| `created_at` | `DateTime @default(now())` | |

### Architecture

```
driver.service.ts (NEW)
  ├── createDriver(adminId, data)              — Create DELIVERY_BOY user + profile
  ├── getDriverProfile(userId)                 — Get own profile (driver)
  ├── updateDriverProfile(userId, data)        — Update availability, vehicle, GPS
  ├── getDrivers(filters)                       — Admin list with filters
  ├── getDriverById(adminId, driverId)          — Admin detailed view
  ├── activateDriver(driverId, adminId)        — Set is_active = true
  ├── deactivateDriver(driverId, adminId)      — Set is_active = false
  ├── setAvailability(driverId, status)        — Change availability status
  ├── updateGPS(driverId, lat, lng)            — GPS location ping
  ├── uploadDocument(driverId, type, url)      — Upload verification document
  ├── verifyDocument(documentId, adminId)      — Admin approve/reject document
  ├── getDriverStats(driverId, date)           — Daily/weekly stats for driver
  └── getAvailableDrivers(pincode, slot)       — For M12: find eligible drivers
```

### Flows

#### 1. Driver Creation (Admin)

```
POST /admin/drivers { phone, first_name, last_name, password, vehicle_type, vehicle_number?, max_load?, service_pincodes[]? }
  → requireAuth (ADMIN)
  → Validate:
      phone: exactly 10 digits, starts with 6-9
      first_name: required, max 100 chars
      password: >= 8 chars
      vehicle_type: BIKE | SCOOTER | CAR | WALK
      max_load: optional, default 20, min 1, max 50
      service_pincodes: optional array of 6-digit pincode strings
  → Check: phone not already in use
  → BEGIN TRANSACTION:
    → Create user: role = "DELIVERY_BOY", is_active = true, is_temp_password = true
    → Create driver_profile:
        vehicle_type, vehicle_number, max_load,
        service_pincodes, availability_status = "AVAILABLE"
    → If service_pincodes provided: validate each pincode exists in service_areas
    → audit_log: ADMIN_CREATED_DRIVER
  → Returns: 201 { user (limited fields), driver_profile }
```

#### 2. Driver Profile (Self-Service)

```
GET /driver/profile
  → requireAuth (DELIVERY_BOY)
  → Fetch driver_profile joined with users (first_name, last_name, phone, is_active)
  → Include: current_load, max_load, availability_status, vehicle info, rating, stats
  → Returns: 200 { driver_profile, user }
```

#### 3. Update Driver Profile (Driver)

```
PUT /driver/profile { first_name?, last_name?, phone?, vehicle_type?, vehicle_number?, max_load? }
  → requireAuth (DELIVERY_BOY)
  → Validate: same rules as creation for updated fields
  → BEGIN TRANSACTION:
    → Update users: first_name, last_name, phone
    → Update driver_profile: vehicle_type, vehicle_number, max_load
    → audit_log: DRIVER_UPDATED_PROFILE
  → Returns: 200 { driver_profile, user }
```

#### 4. Availability & Status Management

```
PATCH /driver/availability { status }
  → requireAuth (DELIVERY_BOY)
  → Validate: status IN ('AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_BREAK')
  → BEGIN TRANSACTION:
    → driver_profile.availability_status = status
    → If status = 'OFF_DUTY':
        → Unassign all future PENDING deliveries for this driver
        → (Already DISPATCHED deliveries are not affected — driver must complete them)
    → audit_log: DRIVER_STATUS_CHANGED
  → Returns: 200 { availability_status }
```

##### Availability Rules

| Status | Meaning | Eligible for Assignment (M12) |
|--------|---------|------------------------------|
| `AVAILABLE` | Ready to accept deliveries | Yes |
| `BUSY` | Currently delivering, but can accept more if under max_load | Yes (if current_load < max_load) |
| `ON_BREAK` | Temporarily unavailable | No |
| `OFF_DUTY` | Shift ended | No — pending deliveries unassigned |

#### 5. Admin — Driver Listing

```
GET /admin/drivers?status=&vehicle_type=&is_verified=&is_active=&search=&page=&limit=
  → requireAuth (ADMIN)
  → Filters:
      status: availability_status (AVAILABLE, BUSY, OFF_DUTY, ON_BREAK)
      vehicle_type: BIKE, SCOOTER, CAR, WALK
      is_verified: true/false
      is_active: true/false
      search: name or phone (partial match)
  → Paginated (default 20, max 100)
  → Return fields:
      id, name, phone, vehicle_type, availability_status,
      current_load, max_load, load_percent, is_verified, is_active,
      rating, total_deliveries_completed
  → Returns: 200 { drivers[], total, page, limit }
```

#### 6. Admin — Driver Detail

```
GET /admin/drivers/:id
  → requireAuth (ADMIN)
  → Fetch full driver detail:
      - user: all fields
      - driver_profile: all fields
      - driver_documents: all documents with status
      - today's delivery stats: assigned, delivered, failed, pending
  → Returns: 200 { driver }
```

#### 6b. Admin — Update Driver Config

```
PATCH /admin/drivers/:id/config { max_load?, service_pincodes[]? }
  → requireAuth (ADMIN)
  → Validate: max_load >= 1 and <= 50
  → Validate: service_pincodes[] — each pincode exists in service_areas
  → Update driver_profile.max_load and/or driver_profile.service_pincodes
  → audit_log: ADMIN_UPDATED_DRIVER_CONFIG
  → Returns: 200 { driver_profile }
```

#### 7. Admin — Activate/Deactivate Driver

```
PATCH /admin/drivers/:id/status { is_active }
  → requireAuth (ADMIN)
  → Validate: target user role === DELIVERY_BOY
  → If deactivating (is_active = false):
      → Unassign all PENDING and DISPATCHED deliveries
      → Set availability_status = OFF_DUTY
  → Update user.is_active
  → audit_log: ADMIN_DRIVER_ACTIVATED or ADMIN_DRIVER_DEACTIVATED
  → Returns: 200 { message }
```

#### 8. Admin — Document Verification

```
POST /admin/drivers/:id/documents  (driver upload)
  → requireAuth (DELIVERY_BOY)
  → Body: { document_type, document_url }
  → Validate: document_type IN ('AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_RC')
  → Create driver_document with status = PENDING
  → Returns: 201 { document }

GET /admin/drivers/:id/documents
  → requireAuth (ADMIN)
  → List all documents for driver with status
  → Returns: 200 { documents[] }

PATCH /admin/documents/:documentId/verify { status, rejection_reason? }
  → requireAuth (ADMIN)
  → Validate: status IN ('VERIFIED', 'REJECTED')
  → If VERIFIED and all required documents verified:
      → driver_profile.is_verified = true
      → driver_profile.verified_at = NOW()
  → If REJECTED: rejection_reason required
  → audit_log: ADMIN_VERIFIED_DOCUMENT or ADMIN_REJECTED_DOCUMENT
  → Returns: 200 { document }
```

#### 9. GPS Location Update

```
PATCH /driver/gps { lat, lng }
  → requireAuth (DELIVERY_BOY)
  → Validate: lat (-90 to 90), lng (-180 to 180)
  → driver_profile.latitude = lat
  → driver_profile.longitude = lng
  → driver_profile.last_location_update = NOW()
  → Returns: 200 { message: "Location updated" }
```

#### 10. Driver Stats

```
GET /driver/stats?date=YYYY-MM-DD
  → requireAuth (DELIVERY_BOY)
  → Fetch for today (or specified date):
      - assigned: count of deliveries where driver_id = this driver
      - delivered: count where status = DELIVERED
      - failed: count where status = FAILED
      - skipped: count where status = SKIPPED (not assigned to this driver)
      - pending: count where status IN (PENDING, DISPATCHED)
  → Fetch lifetime stats from driver_profile:
      - total_deliveries_completed, total_deliveries_failed, rating
  → Returns: 200 { daily, lifetime }
```

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/admin/drivers` | JWT | ADMIN | Create driver |
| `GET` | `/api/v1/admin/drivers` | JWT | ADMIN | List drivers with filters |
| `GET` | `/api/v1/admin/drivers/:id` | JWT | ADMIN | Driver detail |
| `PATCH` | `/api/v1/admin/drivers/:id/config` | JWT | ADMIN | Update max_load / service_pincodes |
| `PATCH` | `/api/v1/admin/drivers/:id/status` | JWT | ADMIN | Activate/deactivate |
| `GET` | `/api/v1/admin/drivers/:id/documents` | JWT | ADMIN | List driver documents |
| `PATCH` | `/api/v1/admin/documents/:id/verify` | JWT | ADMIN | Verify/reject document |
| `GET` | `/api/v1/driver/profile` | JWT | DELIVERY_BOY | Get own profile |
| `PUT` | `/api/v1/driver/profile` | JWT | DELIVERY_BOY | Update own profile |
| `PATCH` | `/api/v1/driver/availability` | JWT | DELIVERY_BOY | Set availability status |
| `PATCH` | `/api/v1/driver/gps` | JWT | DELIVERY_BOY | Update GPS location |
| `GET` | `/api/v1/driver/stats` | JWT | DELIVERY_BOY | Daily + lifetime stats |
| `POST` | `/api/v1/driver/documents` | JWT | DELIVERY_BOY | Upload document |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M9** (Delivery Dispatch) | Dispatch sets `delivery.driver_id`. Driver must exist, be ACTIVE, role = DELIVERY_BOY, availability != OFF_DUTY. |
| **M12** (Driver Assignment) | `getAvailableDrivers(pincode, slot)` returns eligible drivers based on availability, max_load, current_load, service_pincodes. |
| **M13** (Driver Dashboard) | Consumes driver stats, profile, assigned deliveries. Updates GPS. |
| **M14** (Delivery Completion) | Updates `total_deliveries_completed` or `total_deliveries_failed` on driver_profile. |
| **M8** (Delivery Generation) | Route grouping by address for driver efficiency. |

### Business Rules

| Rule | Detail |
|------|--------|
| Driver = user with role DELIVERY_BOY | Created via admin-only endpoint. Separate from CUSTOMER registration. |
| max_load = max deliveries per slot | Hard limit. Admin-configurable per driver via PATCH /admin/drivers/:id/config. M12 will not assign more than max_load. |
| current_load resets daily | At midnight, current_load = 0 for all drivers. |
| Driver can be assigned to any pincode they serve | service_pincodes array defines coverage area. Empty array = all pincodes. Driver can set via profile, admin can set via config endpoint. |
| Deactivation unassigns deliveries | All PENDING and DISPATCHED deliveries reassigned or cancelled. |
| OFF_DUTY blocks new assignment | But already DISPATCHED deliveries must be completed. |
| Document verification required before dispatch | M12 should check is_verified before assignment. Unverified drivers are skipped. |
| GPS updates are fire-and-forget | No validation of accuracy. Stored for route optimization (future). |

### Edge Cases

| Case | Handling |
|------|----------|
| Admin creates driver with existing phone | 409 PHONE_ALREADY_EXISTS. |
| Driver goes OFF_DUTY mid-slot | Already DISPATCHED deliveries unaffected. Future PENDING deliveries unassigned. |
| Driver exceeds max_load via manual dispatch | Admin can override. System auto-assignment (M12) enforces max_load. |
| Driver deactivated with active deliveries | All deliveries unassigned (status → PENDING, driver_id = NULL). Admin notified. |
| Driver uploads duplicate document type | Last upload wins — previous PENDING document marked REPLACED. |
| GPS ping fails | No retry. Location stale. last_location_update shows age. |
| Driver suspended after partial delivery completion | Already DELIVERED stays. Only future assignments blocked. |
| Driver assigned to pincode outside service_areas | Blocked at assignment time (M12). |
| No drivers available for a pincode | Admin alert: NO_DRIVER_AVAILABLE. Manual dispatch required. |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| 10K drivers | Driver list queries paginated (max 100). Filters indexed. |
| GPS pings every 30s from 1K active drivers | Write-heavy but trivial (single row update). No read contention. |
| getAvailableDrivers for M12 | Filter by availability_status, JOIN to check current_load < max_load. Index on availability_status. |
| Document storage | URLs stored in DB. Actual files in S3/cloud storage. |

### Seed Data

No seed drivers. First driver must be created by admin via the create endpoint.

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Admin creates driver → driver logs in → updates profile → sets availability |
| | Driver uploads documents → admin verifies → is_verified = true |
| | Driver sets OFF_DUTY → pending deliveries unassigned |
| | Driver updates GPS → location stored |
| | Driver views daily stats → correct counts |
| **Admin** | List drivers with filters → correct results |
| | Activate/deactivate → status changes, deliveries unassigned |
| | Verify document → is_verified updated |
| | Update driver config → max_load/service_pincodes changed |
| | Create duplicate phone → 409 |
| **Availability** | Set AVAILABLE → eligible for assignment |
| | Set BUSY → eligible if under max_load |
| | Set ON_BREAK → not eligible |
| | Set OFF_DUTY → not eligible, pending unassigned |
| **Validation** | Create with invalid vehicle_type → 400 |
| | Create with invalid phone → 400 |
| | Set invalid availability status → 400 |
| | Update max_load to 0 → 400 |
| | Upload invalid document_type → 400 |
| **Edge** | Deactivate while on delivery → DISPATCHED deliveries preserved |
| | Max_load reached → M12 skips this driver |
| | Driver sets OFF_DUTY while at max_load → pending unassigned |
| | All documents verified → is_verified = true, verified_at set |
| | Document rejected → driver can re-upload |
| **Security** | Driver tries to create another driver → 403 |
| | Unauthenticated → 401 |
| | Customer accesses driver endpoint → 403 |

---

## Module 12 — Driver Assignment Engine

**Status:** `FINALIZED`

### Objective

Automatically assign the most suitable driver to each PENDING delivery based on driver availability, current workload, pincode coverage, and verification status. Support manual dispatch by admin for override scenarios, and handle reassignment when drivers go off-duty or are deactivated. The engine runs on a cron schedule before each meal slot and can be triggered manually.

### Architecture

```
assignment.service.ts (NEW)
  ├── autoAssignSlot(date, slot)                — Cron entry: assign all PENDING for a slot
  ├── assignDeliveryToDriver(deliveryId, driverId) — Single delivery assignment (admin + auto)
  ├── reassignDeliveries(deliveryIds[], newDriverId) — Bulk reassignment
  ├── unassignDriverDeliveries(driverId)         — Unassign all PENDING for a driver
  ├── getEligibleDrivers(pincode, slot)          — Find candidate drivers
  ├── getCurrentLoad(driverId, date, slot)      — Count current assigned deliveries
  ├── resetCurrentLoads()                        — Daily reset at midnight cron
  └── getAssignmentHistory(deliveryId)           — Audit trail of driver assignments
```

### Driver Eligibility Rules

For a driver to be eligible for auto-assignment, ALL of these must be true:

| # | Rule | Check | Source |
|---|------|-------|--------|
| 1 | Active account | `users.is_active === true` | users table |
| 2 | DELIVERY_BOY role | `users.role === "DELIVERY_BOY"` | users table |
| 3 | Verified documents | `driver_profiles.is_verified === true` | driver_profiles |
| 4 | Available for assignment | `driver_profiles.availability_status IN ('AVAILABLE', 'BUSY')` | driver_profiles |
| 5 | Under max capacity | `driver_profiles.current_load < driver_profiles.max_load` | driver_profiles |
| 6 | Pincode covered | Delivery's pincode is in driver's `service_pincodes` OR driver's `service_pincodes` is empty | driver_profiles |
| 7 | Not currently assigned to this delivery | No duplicate assignment | deliveries table |

### Assignment Strategies

The engine supports three strategies, configurable via `system_configs`:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `LOAD_BALANCED` (default) | Pick the driver with the lowest `current_load / max_load` ratio among eligible candidates | Even workload distribution |
| `PINCODE_PRIORITY` | Pick the driver whose `service_pincodes` contains ONLY this pincode (specialized local driver) | Dense urban zones with local drivers |
| `ROUND_ROBIN` | Pick the driver who was assigned the fewest deliveries in the last 7 days | Fairness across shifts |

If multiple drivers tie under the chosen strategy, the driver with the higher `rating` wins.

### Flows

#### 1. Auto-Assignment Cron

```
runAutoAssignmentCron(date, slot):
  Run schedule:
    BREAKFAST: 05:30 AM (30 min after generation)
    LUNCH:     09:30 AM (30 min after generation)
    DINNER:    02:30 PM (30 min after generation)

  → Query deliveries WHERE:
      status = "PENDING"
      delivery_date = date
      slot = slot
      subscription.status IN ('ACTIVE', 'BUFFER')
      (Exclude BLOCKED_TIFFIN_DEBT and BLOCKED_LOW_WALLET — those need admin action)
  → Group by pincode (from subscription.delivery_addresses.pincode)
  → For each pincode group, process in batches of 500:

      eligibleDrivers = getEligibleDrivers(pincode, slot)
      
      IF eligibleDrivers.length === 0:
          → Create admin_alert: NO_DRIVERS_AVAILABLE (pincode, date, slot, count)
          → Skip this pincode group (deliveries remain PENDING)

      FOR each delivery in group:
          driver = selectDriver(eligibleDrivers, strategy)
          assignDeliveryToDriver(delivery.id, driver.id)
          → Increment driver.current_load += 1

      → Log assignment summary:
          total_assigned, total_skipped_no_driver, total_errors
```

#### 2. Manual Dispatch (Admin)

```
POST /deliveries/:id/dispatch  { driver_id }
  → requireAuth (ADMIN)
  → Validate: delivery.status IN ('PENDING', 'BLOCKED_TIFFIN_DEBT')
      (BLOCKED_LOW_WALLET remains blocked — admin must top-up wallet first)
  → Validate: driver exists + is_active + role = DELIVERY_BOY
  → Validate: driver availability not OFF_DUTY (warn if ON_BREAK but allow override)
  → Validate: driver.current_load < driver.max_load (warn but allow override for admin)
  → BEGIN TRANSACTION:
    → delivery.status = "DISPATCHED"
    → delivery.driver_id = driver_id
    → driver.current_load += 1
    → route_log: DISPATCHED (kitchen lat/lng)
    → audit_log: ADMIN_DISPATCHED_DELIVERY (admin_id, driver_id, delivery_id)
  → Returns: 200 { delivery }

  Admin override warnings (non-blocking):
    "Driver is ON_BREAK — confirm override?"
    "Driver at max_load (X/Y) — confirm override?"
    "Delivery is BLOCKED_TIFFIN_DEBT — confirm override?"
```

#### 3. Reassignment

```
POST /admin/deliveries/:id/reassign  { new_driver_id, reason }
  → requireAuth (ADMIN)
  → Validate: delivery.status IN ('PENDING', 'DISPATCHED')
      (DELIVERED/FAILED cannot be reassigned)
  → Validate: new driver exists + active + is DELIVERY_BOY
  → BEGIN TRANSACTION:
    → Record old driver_id in assignment_history
    → IF delivery.status === "DISPATCHED":
        → Decrement old_driver.current_load -= 1
        → Increment new_driver.current_load += 1
    → delivery.driver_id = new_driver_id
    → IF delivery.status === "PENDING":
        → (status stays PENDING, will be DISPATCHED at auto cron or next manual dispatch)
    → route_log: REASSIGNED (old_driver → new_driver)
    → audit_log: ADMIN_REASSIGNED_DELIVERY (reason captured)
  → Returns: 200 { delivery }
```

#### 4. Bulk Reassignment

```
POST /admin/deliveries/bulk-reassign  { delivery_ids[], new_driver_id, reason }
  → requireAuth (ADMIN)
  → Validate: all deliveries belong to same date+slot (or validate individually)
  → BEGIN TRANSACTION (process each delivery):
    → For each delivery_id in delivery_ids:
        → Same logic as single reassignment
        → If any delivery is DELIVERED: skip with warning
    → audit_log: ADMIN_BULK_REASSIGNED (count, driver_id, reason)
  → Returns: 200 { reassigned: count, skipped: [...] }
```

#### 5. Unassign (Triggered by M11 — OFF_DUTY / Deactivation)

```
unassignDriverDeliveries(driverId, reason):
  → Called when:
      - Driver sets availability_status = "OFF_DUTY"
      - Admin deactivates driver (is_active = false)
  → BEGIN TRANSACTION:
    → Query deliveries WHERE:
        driver_id = driverId
        status = "PENDING"
    → For each:
        → driver_id = NULL
        → status remains PENDING (available for reassignment)
        → route_log: UNASSIGNED (reason)
    → driver.current_load = COUNT(where status IN ('DISPATCHED', 'DELIVERED'))
      (Only completed/in-progress deliveries count toward load after unassign)
    → audit_log: SYSTEM_UNASSIGNED_DRIVER (driverId, count, reason)
  → Returns: { unassigned_count }

  Note: Already DISPATCHED deliveries remain with the driver.
  Driver must complete them even after going off-duty.
```

#### 6. Current Load Tracking

```
getCurrentLoad(driverId, date, slot):
  → COUNT deliveries WHERE:
      driver_id = driverId
      delivery_date = date
      slot = slot
      status IN ('PENDING', 'DISPATCHED')
  → This is the "active load" — assigned but not yet completed.

resetCurrentLoads():
  → Runs daily at 00:00 AM (midnight)
  → UPDATE all driver_profiles SET current_load = 0
  → (Assigned deliveries from yesterday are now complete or carried over)
```

**Important:** `current_load` resets daily. It represents the number of deliveries assigned to the driver for today's slots. Completed deliveries (DELIVERED/FAILED) are excluded from the count.

#### 7. getEligibleDrivers Detail

```
getEligibleDrivers(pincode, slot):
  → Fetch all driver_profiles WHERE:
      user.is_active === true
      user.role === "DELIVERY_BOY"
      availability_status IN ('AVAILABLE', 'BUSY')
      current_load < max_load
      is_verified === true
      (service_pincodes === "[]" OR service_pincodes CONTAINS pincode)
  → JOIN users for is_active and role checks
  → For LOAD_BALANCED strategy: ORDER BY (current_load / max_load) ASC, rating DESC
  → For PINCODE_PRIORITY strategy: ORDER BY
      CASE WHEN service_pincodes = JSON_ARRAY(pincode) THEN 0 ELSE 1 END,
      rating DESC
  → For ROUND_ROBIN strategy: ORDER BY
      (SELECT COUNT(*) FROM deliveries WHERE driver_id = driver_profiles.user_id AND delivery_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)) ASC,
      rating DESC
  → Returns: Driver[] (sorted by strategy)
```

#### 8. Assignment History

New table for tracking all assignment changes:

#### `assignment_history` table — NEW

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `delivery_id` | `String` | FK to deliveries |
| `driver_id` | `String` | FK to users (driver) |
| `action` | `String @db.VarChar(30)` | `ASSIGNED` / `REASSIGNED` / `UNASSIGNED` / `MANUAL_OVERRIDE` |
| `previous_driver_id` | `String?` | Previous driver if reassigned |
| `reason` | `String?` | Why the change occurred |
| `performed_by` | `String?` | Admin ID if admin action, "SYSTEM" if cron |
| `created_at` | `DateTime @default(now())` | |

```
GET /admin/deliveries/:id/assignments
  → requireAuth (ADMIN)
  → Fetch assignment_history for this delivery, ordered by created_at
  → Include: driver name for each entry
  → Returns: 200 { history[] }
```

### Cron Schedule

| Time | Cron | Action |
|------|------|--------|
| 00:00 AM | `resetCurrentLoads()` | Reset all driver current_load to 0 |
| 05:30 AM | `autoAssignSlot(today, BREAKFAST)` | Assign breakfast deliveries |
| 09:30 AM | `autoAssignSlot(today, LUNCH)` | Assign lunch deliveries |
| 02:30 PM | `autoAssignSlot(today, DINNER)` | Assign dinner deliveries |

Each auto-assignment runs 30 minutes after the corresponding delivery generation cron (M8), giving time for any manual dispatch before auto-assignment.

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/deliveries/:id/dispatch` | JWT | ADMIN | Manual dispatch (exists, enhanced) |
| `POST` | `/api/v1/admin/deliveries/:id/reassign` | JWT | ADMIN | Reassign driver |
| `POST` | `/api/v1/admin/deliveries/bulk-reassign` | JWT | ADMIN | Bulk reassign |
| `GET` | `/api/v1/admin/deliveries/:id/assignments` | JWT | ADMIN | Assignment history |
| `POST` | `/api/v1/admin/assignments/auto-run` | JWT | ADMIN | Manual trigger auto-assignment |
| `GET` | `/api/v1/admin/assignments/eligible-drivers?pincode=&slot=` | JWT | ADMIN | Preview eligible drivers |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M9** (Delivery Dispatch) | Delivery status → DISPATCHED. Driver_id set. Route log created. |
| **M11** (Driver Management) | Consumes driver_profiles: availability, max_load, current_load, is_verified, service_pincodes. Triggers unassign when driver goes OFF_DUTY. |
| **M8** (Delivery Generation) | Consumes generated PENDING deliveries. Runs 30 min after each slot generation. |
| **M14** (Delivery Completion) | On DELIVERED/FAILED: driver.current_load decremented (actually load resets daily, but completion updates total_deliveries_completed/failed counters). |
| **M13** (Driver Dashboard) | Driver sees assigned deliveries via M9 endpoint. |

### system_configs Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `assignment_strategy` | `LOAD_BALANCED` | `LOAD_BALANCED` / `PINCODE_PRIORITY` / `ROUND_ROBIN` |
| `auto_assign_enabled` | `true` | Master toggle for auto-assignment cron |
| `max_drivers_per_pincode` | `20` | Limit on eligible drivers returned per pincode (prevents large queries) |

### Edge Cases

| Case | Handling |
|------|----------|
| No eligible drivers for a pincode | Admin alert created. Deliveries remain PENDING for manual dispatch. |
| All drivers at max_load | Deliveries remain PENDING. Next cron retries. |
| Driver goes OFF_DUTY mid-assignment | PENDING deliveries unassigned. DISPATCHED deliveries unaffected. |
| Driver deactivated mid-slot | Same as OFF_DUTY — PENDING unassigned, DISPATCHED completes. |
| Manual dispatch assigns driver over max_load | Warning shown, admin override allowed. |
| Two admin reassignments in quick succession | Serialized by transaction. Last write wins. History captures both. |
| Reassign DISPATCHED delivery | Old driver's current_load decremented. New driver's incremented. Route log for both. |
| Auto-assign same delivery twice | `delivery.status` check prevents (status = DISPATCHED after first assign). |
| Driver unassigned, then re-added | PENDING deliveries available for reassignment. New assignment creates new history entry. |
| BREAKFAST auto-assign at 05:30 AM — no drivers | Admin alerted. Manual dispatch needed. |

### Scalability Considerations (100K+)

| Concern | Approach |
|---------|----------|
| 100K PENDING deliveries per day | Auto-assignment processes in batches of 500 per pincode group. |
| 10K drivers | `getEligibleDrivers` filtered by availability + max_load — small subset queried at any time. |
| Pincode grouping | Each pincode processed independently. Drivers for dense pincodes limited by `max_drivers_per_pincode`. |
| Assignment history bloat | Index on `[delivery_id, created_at]`. Retention: 90 days. Old records archived. |
| Concurrent manual + auto assign | `SELECT FOR UPDATE` on delivery row serializes. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Auto-assignment cron assigns all PENDING → DISPATCHED |
| | Manual dispatch → driver assigned, load incremented |
| | Reassign → old driver decremented, new driver incremented, history recorded |
| | Bulk reassign → all selected deliveries updated |
| | Driver OFF_DUTY → PENDING deliveries unassigned |
| **Eligibility** | Driver unverified → not eligible |
| | Driver OFF_DUTY → not eligible |
| | Driver at max_load → not eligible |
| | Driver outside pincode → not eligible |
| | Driver BUSY + under max_load → eligible |
| **Strategies** | LOAD_BALANCED assigns to least-loaded driver |
| | PINCODE_PRIORITY assigns to pincode-local driver |
| | ROUND_ROBIN assigns to driver with fewest recent deliveries |
| | Tie → higher rating wins |
| **Admin override** | Manual dispatch over max_load → warning + allowed |
| | Manual dispatch ON_BREAK driver → warning + allowed |
| | Manual dispatch BLOCKED_TIFFIN_DEBT → warning + allowed |
| | Manual dispatch BLOCKED_LOW_WALLET → blocked |
| **No driver** | No drivers for pincode → alert created, deliveries stay PENDING |
| **Edge** | Reassign while delivery in progress → old driver's DISPATCHED deliveries stay |
| | Deactivate driver → PENDING unassigned, alert |
| | Auto-assign at BREAKFAST with 0 drivers → retry at LUNCH cron |
| | Concurrent manual + auto → serialized, no double assign |
| **Security** | Non-admin dispatch → 403 |
| | Assign to non-driver user → 400 |
| | Unauthenticated → 401 |

---

## Module 13 — Driver Dashboard (Frontend)

**Status:** `FINALIZED`

### Objective

Provide delivery drivers with a mobile-first dashboard to manage their daily deliveries. The dashboard is the primary driver interface covering: viewing assigned deliveries, executing the arrive → deliver/fail flow, managing availability, updating profile/vehicle/GPS, uploading verification documents, and viewing daily stats. This module documents the frontend pages, components, API integration, and UI states per the F4 standard.

### Architecture

```
src/
  app/driver/
    layout.tsx                                     — ProtectedRoute layout (DELIVERY_BOY role)
    page.tsx                                       — Main dashboard (assigned deliveries)
    deliveries/
      [id]/
        page.tsx                                   — Single delivery execution screen
    profile/
      page.tsx                                     — Profile view + edit
    documents/
      page.tsx                                     — Document upload list
    stats/
      page.tsx                                     — Daily + lifetime stats
  components/driver/
    DeliveryCard.tsx                               — Delivery card in list
    DeliveryActions.tsx                            — Arrive / Deliver / Fail buttons
    TiffinReturnSection.tsx                        — Tiffin box ID input (return + new)
    GpsCapture.tsx                                 — GPS lat/lng capture component
    AvailabilityToggle.tsx                         — Status toggle (AVAILABLE/BUSY/ON_BREAK/OFF_DUTY)
    DailyStatsCard.tsx                             — Stats summary card
    DocumentUploadCard.tsx                         — Document upload + status display
  services/
    driver/
      delivery.service.ts                          — API calls for driver delivery operations
      profile.service.ts                           — API calls for driver profile
      document.service.ts                          — API calls for document upload
      stats.service.ts                             — API calls for driver stats
```

### Pages

#### 1. Login (Shared — exists)

| Aspect | Detail |
|--------|--------|
| Route | `/login` |
| API | `POST /auth/login { email, password }` |
| Role redirect | After login, redirect to `/driver/dashboard` if role = DELIVERY_BOY |
| States | Loading (spinner), Error (invalid credentials), Success (redirect) |

#### 2. Dashboard — Assigned Deliveries

| Aspect | Detail |
|--------|--------|
| Route | `/driver` |
| API | `GET /deliveries/driver/assigned?date=YYYY-MM-DD&slot=BREAKFAST\|LUNCH\|DINNER` |
| Refresh | Auto-refresh every 60s + pull-to-refresh |
| Filters | Date picker + slot tabs (All / Breakfast / Lunch / Dinner) |

**UI States (F4 Standard):**

| State | Render |
|-------|--------|
| **Loading** | Skeleton cards (3-5 placeholder cards with pulse animation) |
| **Error** | Red banner with error message + Retry button |
| **Empty** | Illustration + "No deliveries assigned" + date/slot info |
| **Success** | List of DeliveryCard components grouped by address order |

**DeliveryCard Component:**

```
┌─────────────────────────────────────────┐
│ [SLOT] [STATUS_BADGE]                   │
│ Customer: Rahul Sharma                  │
│ Address: 42, MG Road, Jaipur            │
│ Phone: +91-9876543210                   │
│ Subscription: WEEKLY_COMBO              │
│ ┌─────────────────────────────────────┐ │
│ │   [Arrive]  [Deliver]  [Fail]      │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

| State | DeliveryCard Behavior |
|-------|-----------------------|
| **PENDING** | All action buttons enabled. Arrive must be clicked first (logs GPS). |
| **DISPATCHED** | Same as PENDING |
| **ARRIVED** (conceptual — status remains PENDING/DISPATCHED, route_log records arrival) | "Arrived" badge shown. Deliver/Fail enabled. |
| **DELIVERED** | Green badge. All buttons disabled. "Delivered at 10:32 AM" shown. |
| **FAILED** | Red badge. Retry button if same slot still active. |
| **BLOCKED_TIFFIN_DEBT** | Orange badge + warning icon. Actions disabled. "Contact admin" note. |

#### 3. Delivery Execution Screen

| Aspect | Detail |
|--------|--------|
| Route | `/driver/deliveries/[id]` |
| API | See flow below |
| Purpose | Step-by-step delivery execution with GPS + tiffin box capture |

**Step-by-step flow:**

```
1. LOAD delivery details (customer name, address, phone, slot, meal info)
   → API: GET /deliveries/:id (with ownership middleware)

2. DRIVER clicks "Arrive at Location"
   → Captures GPS (browser geolocation API)
   → API: POST /deliveries/:id/driver/arrive { lat, lng }
   → State: arrival logged, proceed to step 3

3. DRIVER executes handover:
   ┌─────────────────────────────────────┐
   │  Meal Delivered?  [Yes] [No]        │
   │                                     │
   │  [If Yes] New Tiffin Box ID:        │
   │  [__________] (scan QR or manual)   │
   │                                     │
   │  Tiffin Returned?  [Yes] [No]       │
   │                                     │
   │  [If Yes] Returned Box ID:          │
   │  [__________] (scan QR or manual)   │
   │                                     │
   │  GPS: 26.9124, 75.7873 (auto)      │
   │                                     │
   │  [Confirm Deliver]  [Mark Failed]   │
   └─────────────────────────────────────┘

4a. CONFIRM DELIVER:
   → API: POST /deliveries/:id/driver/deliver
       { meal_delivered: true, tiffin_returned: bool,
         tiffin_box_id, returned_tiffin_box_id?, lat, lng }
   → Success: green confirmation, auto-navigate back to dashboard after 2s

4b. MARK FAILED:
   → API: POST /deliveries/:id/driver/fail { lat, lng }
   → Success: red/orange confirmation, navigate back
```

**UI States:**

| State | Render |
|-------|--------|
| **Loading** | Full-page skeleton with delivery info placeholders |
| **Error** | Red alert with retry + "Go back to dashboard" |
| **Success (Delivered)** | Green checkmark animation + "Delivery Complete!" + auto-redirect |
| **Success (Failed)** | Amber warning + "Delivery marked as failed" |
| **Blocked (Tiffin Debt)** | Lock screen with "Contact admin" message |
| **Blocked (Already Processed)** | Info toast + navigate back |

#### 4. Availability Toggle

| Aspect | Detail |
|--------|--------|
| Location | Bottom sheet / sticky header on dashboard |
| API | `PATCH /driver/availability { status }` |

**Component states:**

| Current Status | Button label | Available actions |
|----------------|--------------|-------------------|
| AVAILABLE | 🟢 Available | → BUSY, ON_BREAK, OFF_DUTY |
| BUSY | 🟡 Busy | → AVAILABLE, ON_BREAK, OFF_DUTY |
| ON_BREAK | 🔴 On Break (tap to resume) | → AVAILABLE |
| OFF_DUTY | ⚪ Off Duty (end shift) | → AVAILABLE |

**Confirmation dialogs:**
- OFF_DUTY: "End shift? Pending deliveries will be unassigned." [Cancel] [End Shift]
- ON_BREAK: "Go on break? New deliveries won't be assigned." [Cancel] [Take Break]

#### 5. GPS Auto-Update

| Aspect | Detail |
|--------|--------|
| Implementation | `navigator.geolocation.watchPosition()` in background |
| Interval | Every 30 seconds while app is in foreground |
| API | `PATCH /driver/gps { lat, lng }` |
| Error handling | Silent failure on permission denied. Show warning banner. |
| Battery optimization | Stop watching when tab is hidden (Page Visibility API). Resume on visibility. |

#### 6. Driver Profile

| Aspect | Detail |
|--------|--------|
| Route | `/driver/profile` |
| API | `GET /driver/profile` (view), `PUT /driver/profile` (edit) |

**Fields:**
- First name, Last name (editable)
- Phone (read-only, contact admin to change)
- Vehicle type (BIKE/SCOOTER/CAR/WALK — dropdown)
- Vehicle number (editable)
- Max load capacity (editable, number)
- Rating (read-only, star display)
- Joined date (read-only)
- Verification status badge (Verified / Pending / Not Submitted)

**UI States:**

| State | Render |
|-------|--------|
| **Loading** | Skeleton form |
| **Error** | Red alert |
| **Empty** | N/A (profile always exists for drivers) |
| **Success** | Profile form with save button |
| **Saving** | Button shows spinner + "Saving..." |

#### 7. Document Upload

| Aspect | Detail |
|--------|--------|
| Route | `/driver/documents` |
| API | `GET /admin/drivers/:id/documents`, `POST /driver/documents`, `PATCH /admin/documents/:id/verify` |

**Document Types:**
| Type | Label | Required |
|------|-------|----------|
| AADHAAR | Aadhaar Card | Yes |
| DRIVING_LICENSE | Driving License | Yes (if vehicle type requires) |
| VEHICLE_RC | Vehicle RC | Yes (if has vehicle) |

**UI States per document:**

| State | Render |
|-------|--------|
| **Not uploaded** | Upload button + file picker |
| **PENDING** | Yellow badge "Under Review" |
| **VERIFIED** | Green badge "Verified" + checkmark |
| **REJECTED** | Red badge "Rejected" + reason + re-upload button |
| **Uploading** | Progress bar + filename |
| **Upload error** | Red alert + retry |

#### 8. Daily Stats

| Aspect | Detail |
|--------|--------|
| Route | `/driver/stats` |
| API | `GET /driver/stats?date=YYYY-MM-DD` |

**Stats cards:**

```
┌──────────────────────────────────────┐
│  Today's Stats — 12 Jun 2026        │
│                                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│  │   8  │ │   6  │ │   1  │ │   1  ││
│  │Assig.│ │Deliv.│ │Failed│ │Pending││
│  └──────┘ └──────┘ └──────┘ └──────┘│
│                                      │
│  Lifetime: 1,247 delivered          │
│  Rating: ★★★★☆ (4.2)               │
└──────────────────────────────────────┘
```

### API Integration Map

| Frontend Action | API Endpoint | Method | Module |
|-----------------|--------------|--------|--------|
| Fetch assigned deliveries | `/deliveries/driver/assigned?date=&slot=` | GET | M9 |
| Get delivery detail | `/deliveries/:id` | GET | M9 |
| Log arrival | `/deliveries/:id/driver/arrive` | POST | M9/M14 |
| Mark delivered | `/deliveries/:id/driver/deliver` | POST | M9/M14 |
| Mark failed | `/deliveries/:id/driver/fail` | POST | M9/M14 |
| Get driver profile | `/driver/profile` | GET | M11 |
| Update driver profile | `/driver/profile` | PUT | M11 |
| Set availability | `/driver/availability` | PATCH | M11 |
| Update GPS | `/driver/gps` | PATCH | M11 |
| Get daily stats | `/driver/stats?date=` | GET | M11 |
| Upload document | `/driver/documents` | POST | M11 |
| List documents | `/admin/drivers/:id/documents` | GET | M11 |

### Navigation Structure

```
Driver App
├── Login (shared)
├── Bottom Tab Navigation
│   ├── 📋 Routes (Dashboard)      ← default tab
│   │   └── Delivery Detail        ← push navigation
│   ├── 📊 Stats
│   └── 👤 Profile
│       ├── Edit Profile
│       └── Documents
└── Availability Toggle (sticky header on all tabs)
```

### Error Handling (Per F4)

| Scenario | Frontend Behavior |
|----------|-------------------|
| Network offline | Banner: "You're offline. Last updated: 10:32 AM" + cached data display |
| API 401 (token expired) | Auto-redirect to login + toast: "Session expired" |
| API 403 | Toast: "Access denied" + disable action |
| API 404 (delivery gone) | Toast + navigate to dashboard |
| API 500 | Toast: "Server error. Try again." + retry button |
| GPS permission denied | Warning banner + manual lat/lng input fallback |
| QR scan failure | Manual text input fallback for tiffin box ID |

### Integration with Finalized Modules

| Module | Integration |
|--------|-------------|
| **M9** (Delivery Lifecycle) | Consumes assigned deliveries endpoint. Executes arrive/deliver/fail. |
| **M11** (Driver Management) | Consumes profile, GPS, availability, documents, stats endpoints. |
| **M12** (Driver Assignment) | Availability toggle affects eligibility. GPS helps route planning. |
| **M14** (Delivery Completion) | Delivery execution screen calls markDelivered/markFailed with full tiffin decision tree. |

### Testing Strategy (Frontend)

| Type | Cases |
|------|-------|
| **Render** | Dashboard shows skeleton on load → deliveries appear |
| | Empty state when no deliveries assigned |
| | Error state with retry button |
| **Navigation** | Tab switching preserves state |
| | Delivery detail → back → list retains scroll position |
| | Deep link to `/driver/deliveries/:id` works |
| **Delivery flow** | Arrive → GPS captured → logged |
| | Deliver with tiffin box → success state |
| | Fail → failure state → return to dashboard |
| | Blocked by tiffin debt → lock screen |
| **Availability** | Toggle opens confirmation dialog |
| | OFF_DUTY shows warning about unassigned deliveries |
| | Status reflected in header immediately |
| **GPS** | Background ping every 30s |
| | Stops on tab hide, resumes on focus |
| | Permission denied → fallback input |
| **Profile** | Load profile data → form populated |
| | Edit → save → updated values shown |
| | Validation errors shown inline |
| **Documents** | List shows all document types with status |
| | Upload shows progress |
| | Verified badge shown |
| **Offline** | App shows offline banner |
| | Cached deliveries displayed |
| | Actions disabled with "Go online to continue" |

---

## Module 15 — Delivery Reversal Management

**Status:** `FINALIZED`

### Objective

Provide an admin-only mechanism to undo a completed (DELIVERED or FAILED) delivery. Reversal rolls back all side effects of the original completion: delivery status, wallet deduction, tiffin tracker changes, tiffin box statuses, security deposit state, and route/audit logs. Reversal is a privileged operation with strict time windows, reason requirements, and full audit trail.

### Pre-Conditions

| # | Check | Failure |
|---|-------|---------|
| 1 | Delivery exists | `DELIVERY_NOT_FOUND` — 404 |
| 2 | Status is DELIVERED or FAILED | `INVALID_STATE` — 400 |
| 3 | Not already reversed in last 24h | `ALREADY_REVERSED` — 400 |
| 4 | Delivery date within reversal window | `REVERSAL_WINDOW_EXPIRED` — 400 |
| 5 | Admin authentication + authorization | `FORBIDDEN` — 403 |
| 6 | Reason provided (min 10 chars) | `VALIDATION_ERROR` — 400 |
| 7 | Subscription still exists and not CANCELLED/EXPIRED settled | `SUBSCRIPTION_CLOSED` — 400 |

### Reversal Windows

| Scenario | Window | Rationale |
|----------|--------|-----------|
| Regular meal DELIVERED | Within 24 hours of `delivered_at` | Customer complaint / wrong address |
| Buffer meal DELIVERED | Within 2 hours of `delivered_at` | Buffer meals expire fast |
| FAILED (not rescheduled) | Within 48 hours of failure | Driver error — restore for redispatch |
| FAILED_RESCHEDULED | Cannot reverse | Already replaced by new delivery — reverse the replacement instead |
| EXPIRED_BUFFER_FAILED | Cannot reverse | Already refunded — reversal would double-refund |
| Past 7 days from delivery_date | Never | Data integrity — subscription may be settled |

Configurable via `system_configs`:
- `reversal_window_delivered_hours` — default `24`
- `reversal_window_buffer_delivered_hours` — default `2`
- `reversal_window_failed_hours` — default `48`
- `reversal_absolute_max_days` — default `7`

### Reversal Decision Tree

The reversal action depends on the ORIGINAL completion branch (M14 decision tree):

```
reverseDelivery(deliveryId, adminId, reason):
  → Read full delivery record with all relations
  → Determine which M14 branch was originally executed:
      Branch 1: meal_delivered=true, tiffin_returned=true
      Branch 2: meal_delivered=true, tiffin_returned=false
      Branch 3: meal_delivered=false (FAILED)
```

#### Branch 1 Reversal — Delivered + Returned (Net tiffins_due unchanged)

Original M14 effect: `tiffins_due +1, tiffins_due -1 = net unchanged. Wallet deducted: mealCost. Tiffin box: new → WITH_CUSTOMER, returned → IN_KITCHEN.`

```
Reversal:
  → delivery.status = "PENDING"
  → delivered_at = NULL, tiffin_box_id = NULL, location_locked = false
  → CREDIT wallet: mealCost (DELIVERY_REVERSAL)
  → tiffins_due: unchanged (was net 0 change)
  → Tiffin boxes:
      new_box: WITH_CUSTOMER → IN_KITCHEN
      returned_box: IN_KITCHEN → WITH_CUSTOMER (put it back)
  → Security deposit: NO CHANGE (no penalty was applied)
  → tiffin_event: DELIVERY_REVERSED (original events kept for audit)
```

#### Branch 2 Reversal — Delivered + Not Returned (tiffins_due +1)

Original M14 effect: `tiffins_due += 1. Wallet deducted: mealCost. If tiffins_due >= 2 and security_deducted=false: penalty applied.`

```
Reversal:
  → delivery.status = "PENDING"
  → delivered_at = NULL, tiffin_box_id = NULL, location_locked = false
  → CREDIT wallet: mealCost (DELIVERY_REVERSAL)

  → tiffins_due -= 1 (min 0)

  → IF original triggered penalty (security_deducted == true after delivery):
      → REVERSE penalty:
          → CREDIT wallet: tiffin_penalty_amount (TIFFIN_PENALTY_REVERSAL)
          → security_deducted = false
          → security_deposit_status = ACTIVE (or AT_RISK if tiffins_due > 0)
          → tiffin_event: PENALTY_REVERSED

  → Tiffin box: new_box: WITH_CUSTOMER → IN_KITCHEN
  → (No returned box to handle)

  → If reversal brings tiffins_due to 0 AND security_deducted was set to true by another non-reversed delivery:
      → Do NOT restore — security_deducted flag belongs to other delivery's penalty
```

**Critical:** Security deposit restoration on reversal only happens if THIS delivery's completion was the one that triggered the penalty. If penalty was triggered by a different (earlier) delivery, reversal of this delivery does not undo it.

#### Branch 3 Reversal — Failed (no wallet/tiffin changes)

Original M14 effect: `delivery.status = FAILED. No wallet changes. No tiffin changes. If buffer: FAILED_RESCHEDULED or EXPIRED_BUFFER_FAILED.`

```
Reversal (simple FAILED):
  → delivery.status = "PENDING"
  → delivery is available for redispatch

Reversal (FAILED_RESCHEDULED):
  → Cannot reverse the FAILED_RESCHEDULED directly.
  → Instead, reverse the REPLACEMENT delivery (the new PENDING one created by reschedule).
  → If replacement was also delivered/failed, reverse that one.

Reversal (EXPIRED_BUFFER_FAILED):
  → Cannot reverse. Refund already issued.
  → DEBIT wallet: price_per_meal_snapshot (take back the refund)
  → delivery.status = "PENDING" (but buffer already expired — admin should not do this)
  → Warning: "Buffer period has expired. Reversal may create orphan delivery."
```

### Complete Reversal Transaction

```
prisma.$transaction([
  // Step 1: Lock wallet row
  SELECT ... FOR UPDATE ON subscription_wallets

  // Step 2: Optimistic lock on delivery
  UPDATE deliveries SET status = "PENDING", delivered_at = NULL,
    tiffin_box_id = NULL, location_locked = false, location_locked_at = NULL
    WHERE id = deliveryId AND status = "DELIVERED"
    // If count === 0 → throw DELIVERY_ALREADY_REVERSED

  // Step 3: Wallet credit for meal deduction
  IF NOT is_buffer_meal:
    UPDATE subscription_wallets SET balance += mealCost
    INSERT wallet_transactions (CREDIT, DELIVERY_REVERSAL, balance_before, balance_after)

  // Step 4: Tiffin penalty reversal (if applicable)
  IF penalty_was_applied_by_this_delivery:
    UPDATE subscription_wallets SET balance += tiffin_penalty_amount
    INSERT wallet_transactions (CREDIT, TIFFIN_PENALTY_REVERSAL, balance_before, balance_after)
    UPDATE tiffin_tracker SET security_deducted = false
    UPDATE subscription_wallets SET security_deposit_status = "ACTIVE"

  // Step 5: Tiffin tracker reversal
  UPDATE tiffin_tracker SET tiffins_due = GREATEST(0, tiffins_due - tiffin_increment)

  // Step 6: Tiffin box statuses
  IF new_tiffin_box_id:
    UPDATE tiffin_boxes SET status = "IN_KITCHEN" WHERE id = new_tiffin_box_id
  IF returned_tiffin_box_id:
    UPDATE tiffin_boxes SET status = "WITH_CUSTOMER" WHERE id = returned_tiffin_box_id

  // Step 7: Tiffin event (reversal event — original events preserved)
  INSERT tiffin_events (event_type = "DELIVERY_REVERSED", ...)

  // Step 8: Route log
  INSERT route_logs (event = "DELIVERY_REVERSED", admin_id, lat, lng)

  // Step 9: Audit log
  INSERT audit_log (action = "ADMIN_REVERSED_DELIVERY", actor_type = "ADMIN",
    entity_type = "DELIVERY", entity_id, previous_state, new_state, reason)
])
```

### API Endpoints

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| `POST` | `/api/v1/admin/deliveries/:id/reverse` | JWT | ADMIN | Reverse a delivery |
| `GET` | `/api/v1/admin/deliveries/:id/reversal-history` | JWT | ADMIN | View reversal audit trail |

### Business Rules

| Rule | Detail |
|------|--------|
| Admin-only operation | No driver or customer can reverse. Only ADMIN role. |
| Reason required | Minimum 10 characters. Stored in audit log. |
| Time window enforced | Configurable per delivery type via system_configs. |
| No double reversal | Optimistic lock using `status = "DELIVERED"` in UPDATE WHERE clause. |
| Buffer meal reversal | Wallet NOT credited (buffer meals don't deduct wallet). Tiffin changes still reversed. |
| FAILED reversal | Simple status change back to PENDING. No financial impact. |
| FAILED_RESCHEDULED cannot be reversed | Already replaced. Reverse the replacement delivery instead. |
| EXPIRED_BUFFER_FAILED reversal | Admin override only (terminal state — debits back the refund). |
| Subscription must be open | Reversal blocked if subscription is CANCELLED/EXPIRED with settled_at set. Wallet may be closed. |
| Original tiffin events preserved | Reversal creates a new DELIVERY_REVERSED event. Original PENALTY_APPLIED/NOT_RETURNED events are kept for audit. |

### Edge Cases

| Case | Handling |
|------|----------|
| Delivery reversed, then reversed again | Second attempt → DELIVERY_ALREADY_REVERSED (status is PENDING, not DELIVERED). |
| Reversal after subscription settlement | Blocked: SUBSCRIPTION_CLOSED. Wallet may be zeroed. |
| Penalty was applied by Delivery A, reversal of unrelated Delivery B | No security deposit impact on B's reversal. Only THIS delivery's tiffin_increment is rolled back. |
| Reversal brings tiffins_due below 0 | Protected by `GREATEST(0, tiffins_due - increment)`. |
| Wallet balance insufficient for EXPIRED_BUFFER_FAILED reversal | Blocked: `INSUFFICIENT_BALANCE` — admin must top-up wallet first. |
| Reversal of buffer meal delivered with tiffin returned | No wallet credit (buffer meal costs are not deducted). Tiffin boxes reversed. |
| Concurrent reversal + new delivery for same sub | Lock wallet row. Reversal completes. New delivery generation sees updated state. |
| Admin reverses delivery from 6 days ago | Allowed if within 7-day absolute window. Warning shown. |
| Tiffin box was reassigned to another delivery after original completion | Box status reversal blocked. Admin alert: BOX_ALREADY_IN_USE. Manual box management required. |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | Reverse DELIVERED (Branch 1) → PENDING, wallet credited, tiffins_due unchanged |
| | Reverse DELIVERED (Branch 2) → PENDING, wallet + penalty credited, tiffins_due decremented |
| | Reverse FAILED → PENDING, no financial impact |
| | Reverse DELIVERED buffer meal → PENDING, wallet NOT credited, tiffins_due decremented |
| **Pre-conditions** | Reverse non-DELIVERED delivery → INVALID_STATE |
| | Reverse with no reason → 400 |
| | Reverse by non-admin → 403 |
| | Reverse after window expired → REVERSAL_WINDOW_EXPIRED |
| | Reverse after subscription settled → SUBSCRIPTION_CLOSED |
| **Penalty reversal** | Penalty applied by THIS delivery → penalty fully reversed |
| | Penalty applied by DIFFERENT delivery → penalty NOT reversed |
| | Penalty reversed → security_deducted = false, status = ACTIVE |
| **Double reversal** | Reverse → Reverse again → ALREADY_REVERSED |
| | Concurrent reversal → second fails optimistic lock |
| **Box reversal** | New box returned to kitchen |
| | Returned box returned to customer |
| | Box already in use → warning + manual action |
| **Edge** | Reverse FAILED_RESCHEDULED → blocked |
| | Reverse EXPIRED_BUFFER_FAILED → wallet debited back (admin warning) |
| | Reversal brings tiffins_due to 0 after penalty applied by another delivery → no restoration |
| | Wallet insufficient for EXPIRED_BUFFER refund clawback → blocked |

---

## Module 16 — Buffer Meal Management

**Status:** `FINALIZED`

### Objective

Manage the full lifecycle of buffer meals — from activation (when a subscription's skipped_meal_pool converts to buffer meals at plan expiry), through consumption (delivery generation for BUFFER subscriptions), to final expiry (refund or forfeiture of undelivered buffer meals). Buffer meals are compensatory — they exist solely to ensure customers don't lose value from skipped meals.

### Buffer Overview

```
┌─────────────────────────────────────────────────────────┐
│                    SUBSCRIPTION TIMELINE                  │
│                                                          │
│  ┌─────────┐         ┌──────────┐         ┌──────────┐  │
│  │  ACTIVE  │ end_date │  BUFFER  │ buffer  │ EXPIRED  │  │
│  │ (skips → │ ───────→ │ (buffer  │ expiry  │ (refund  │  │
│  │  pool)   │         │  meals)  │ ───────→ │  remaining│  │
│  └─────────┘         └──────────┘         └──────────┘  │
│       │                    │                    │         │
│       │ skipped_meal_pool  │ buffer_meals_      │ refund  │
│       │ > 0 → BUFFER       │ remaining drained  │ uncon-  │
│       │ = 0 → EXPIRED      │ over buffer period │ sumed   │
│       │ (skip buffer)      │ (buffer_days)      │ meals   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Buffer Activation (M4 Alignment)

```
Trigger: Daily cron at 12:01 AM (runPlanExpiryCron)

For each subscription WHERE status = "ACTIVE" AND end_date < today:

  IF skipped_meal_pool > 0:
    status = "BUFFER"
    buffer_start_date = end_date
    buffer_expiry_date = end_date + buffer_days_snapshot
    buffer_meals_remaining = skipped_meal_pool
    skipped_meal_pool = 0  (reset — pool transferred to buffer_meals_remaining)
    audit_log: SYSTEM_BUFFER_ACTIVATED
    notification: BUFFER_ACTIVATED

  ELSE (skipped_meal_pool == 0):
    status = "EXPIRED"
    settled_at = NOW()
    process financial settlement (M4 — skip buffer entirely)
```

**Key activation rules:**
- Buffer only activates if the customer actually skipped meals during the subscription
- If no meals were skipped, the subscription goes directly to EXPIRED — no buffer period
- Buffer_days_snapshot determines the window length (3, 7, or 15 days depending on plan)
- Buffer eats from the pool — each buffer meal delivered reduces buffer_meals_remaining by 1

### Buffer Consumption (M8 Alignment)

Buffer subscriptions are included in the daily delivery generation cron:

```
Inside delivery generation (M8):
  → Query subscriptions WHERE:
      status = "BUFFER"
      AND buffer_expiry_date >= today
      AND buffer_meals_remaining > 0

  → For each qualifying subscription:
      → Create delivery with:
          is_buffer_meal = true
          status = "PENDING" (or BLOCKED_* if conditions met)
      → Decrement: buffer_meals_remaining -= 1
```

**Buffer delivery rules:**

| Rule | Detail |
|------|--------|
| Wallet check skipped | Buffer meals are pre-paid via skips. No wallet deduction at completion. |
| Tiffin tracking applies | Buffer meals still follow tiffin return/penalty rules. Tiffin boxes must be tracked. |
| Cannot be skipped | Buffer meals are compensatory — skipping would defeat their purpose. |
| Subject to tiffin debt | If tiffins_due >= 2, buffer delivery is BLOCKED_TIFFIN_DEBT just like regular meals. |
| Slot matching | Buffer subs use their original `meal_combination` for slot matching (same as ACTIVE). |

### Buffer Meal Consumption Priority

Buffer meals are consumed per delivery slot (BREAKFAST/LUNCH/DINNER). The order of consumption matches the delivery generation order:

```
Inside M8 cron (per slot):
  → ACTIVE subscriptions processed first (regular meals)
  → BUFFER subscriptions processed second (buffer meals)
  → Buffer meals count toward the driver's load for the slot
```

### Buffer Meal Failure Handling (M9/M14 Alignment)

```
Buffer meal delivery → FAILED:

  First failure:
    → Create replacement delivery for next day (same slot)
    → New delivery status = PENDING
    → buffer_meals_remaining unchanged (replacement still counts)
    → delivery.status = FAILED_RESCHEDULED

  Second failure (of same original buffer meal):
    → No further reschedule
    → CREDIT wallet: price_per_meal_snapshot (BUFFER_MEAL_EXPIRED_REFUND)
    → delivery.status = EXPIRED_BUFFER_FAILED
    → buffer_meals_remaining -= 1 (meal is forfeited after second failure)
    → audit_log: BUFFER_MEAL_EXPIRED_FAILED
```

### Buffer Expiry (M4 Alignment)

```
Trigger: Daily cron at 12:02 AM (runBufferExpiryCron)

For each subscription WHERE status = "BUFFER" AND buffer_expiry_date < today:

  → Refund remaining meals:
      refund = buffer_meals_remaining * price_per_meal_snapshot
      wallet.balance += refund
      wallet_transaction: CREDIT / BUFFER_MEAL_EXPIRED_REFUND

  → Cancel pending buffer deliveries:
      UPDATE deliveries SET status = "EXPIRED_BUFFER"
      WHERE subscription_id = sub.id AND status = "PENDING" AND is_buffer_meal = true

  → Update subscription:
      status = "EXPIRED"
      buffer_meals_remaining = 0
      settled_at = NOW()

  → audit_log: SYSTEM_BUFFER_EXPIRED
  → notification: BUFFER_EXPIRED
```

### Buffer Expiry Refund Calculation

```
refund_amount = buffer_meals_remaining × price_per_meal_snapshot

Example:
  skipped_meal_pool = 5 meals
  price_per_meal_snapshot = ₹80
  Buffer period: 7 days
  Meals delivered during buffer: 3
  buffer_meals_remaining at expiry: 2
  Refund: 2 × ₹80 = ₹160
```

### Buffer and Wallet Interaction

| Operation | Wallet Impact |
|-----------|---------------|
| Buffer activation | None (wallet unchanged) |
| Buffer meal delivered | No deduction (pre-paid via original skip) |
| Buffer meal failed (2nd time) | CREDIT: price_per_meal_snapshot (refund) |
| Buffer meal expired | CREDIT: price_per_meal_snapshot × remaining (refund) |
| Buffer meal delivered + tiffin penalty | DEBIT: TIFFIN_PENALTY (standard tiffin rules apply) |
| Buffer meal reversal | No wallet credit (buffer meals don't deduct) |

### Buffer and Tiffin Tracking

Buffer meals follow the same tiffin tracking as regular meals:

- `tiffins_due` increments for buffer meals where `tiffin_returned = false`
- Penalty applies at `tiffins_due >= 2` same as regular
- AT_RISK/DEDUCTED/ACTIVE transitions all apply
- The only difference: no wallet deduction for the meal cost itself

### Scheduling Conflict: Buffer Expiry vs. Delivery Generation

The buffer expiry cron runs at 12:02 AM, AFTER delivery generation runs at 12:01 AM (plan expiry) and BEFORE slot-specific generation at 5/9/2 AM.

**This ordering means:**
- A buffer subscription expiring TODAY will have its last buffer delivery generated yesterday
- Buffer_expiry_date is checked with `>= today`, so if today is the expiry date, it's still eligible for generation
- The 12:02 AM cron catches subscriptions where `buffer_expiry_date < today` (expired yesterday)

**Edge case: buffer_expiry_date == today at generation time:**
- 12:01 AM: plan expiry cron runs (not relevant for BUFFER)
- 5:00 AM: BREAKFAST generation — this buffer sub is eligible (`buffer_expiry_date >= today`)
- Delivery created for today
- 12:02 AM next day: buffer expiry cron runs — sub now expired

This means the last buffer meal is always generated on the expiry date itself (if a slot exists for it). This is correct behavior.

### Buffer Duration by Plan

| Plan | buffer_days | buffer_expiry_date buffer | Max buffer meals |
|------|-------------|--------------------------|-----------------|
| TRIAL_STD / TRIAL_SPL | 0 | No buffer | 0 |
| WEEKLY_SINGLE | 3 | end_date + 3 days | Up to 2 |
| WEEKLY_COMBO | 3 | end_date + 3 days | Up to 4 |
| WEEKLY_BREAKFAST | 3 | end_date + 3 days | Up to 2 |
| HALF_SINGLE | 7 | end_date + 7 days | Up to 5 |
| HALF_COMBO | 7 | end_date + 7 days | Up to 10 |
| HALF_BREAKFAST | 7 | end_date + 7 days | Up to 5 |
| MONTHLY_SINGLE | 15 | end_date + 15 days | Unlimited (flexible) |
| MONTHLY_COMBO | 15 | end_date + 15 days | Unlimited (flexible) |
| MONTHLY_BREAKFAST | 15 | end_date + 15 days | Unlimited (flexible) |

### Buffer Meal Statuses

| Status | Meaning | Set By |
|--------|---------|--------|
| `PENDING` | Buffer delivery created, awaiting dispatch | M8 generation |
| `DISPATCHED` | Buffer delivery out for delivery | M12 dispatch |
| `DELIVERED` | Buffer meal successfully delivered | M14 completion |
| `FAILED` | Buffer meal not delivered (first attempt) | M14 failure |
| `FAILED_RESCHEDULED` | Buffer meal first failure → replaced next day | M14 buffer logic |
| `EXPIRED_BUFFER_FAILED` | Buffer meal second failure → refunded | M14 buffer logic |
| `EXPIRED_BUFFER` | Buffer meal expired before delivery | M4 buffer expiry cron |

All buffer deliveries have `is_buffer_meal = true`.

### API Endpoints

No dedicated API endpoints for buffer management. Buffer is entirely system-managed via cron. Read-only visibility:

| Method | Path | Purpose | Existing |
|--------|------|---------|----------|
| `GET` | `/admin/subscriptions?status=BUFFER` | List active buffer subscriptions | Exists |
| `GET` | `/admin/subscriptions/:id` | View buffer fields (buffer_meals_remaining, buffer_expiry_date) | Exists |

### Notification Triggers

| Event | Trigger | Message |
|-------|---------|---------|
| Buffer activated | 12:01 AM cron | "Your subscription has entered the buffer period. You have X buffer meals remaining until [date]." |
| Buffer expiry in 3 days | Daily check | "Your buffer period ends in 3 days. Use your remaining X buffer meals or renew now." |
| Buffer expired | 12:02 AM cron | "Your buffer period has ended. X unused meals refunded to wallet." |
| Buffer meal failed (1st) | M14 failure | "Your buffer meal could not be delivered. Rescheduled for tomorrow." |
| Buffer meal failed (2nd) | M14 failure | "Your buffer meal could not be delivered again. Refund of ₹X issued to wallet." |

### Edge Cases

| Case | Handling |
|------|----------|
| skipped_meal_pool > buffer_days * meals_per_day | Buffer can hold at most skipped_meal_pool meals. Duration is fixed by buffer_days. If pool is huge, not all meals may be deliverable within buffer window. Excess refunded at expiry. |
| Customer renews during buffer | Buffer sub status → EXPIRED (settled). New sub → ACTIVE. Remaining buffer meals refunded. |
| Customer cancels during buffer | Allowed — remaining buffer meals forfeited (no refund). Security deposit handled per tiffins_due. |
| Buffer activated but customer has 0 skip_balance remaining | skipped_meal_pool is independent of skip_balance. Pool is the accumulated skipped meals. Balance could be 0 but pool > 0. |
| Buffer delivery created, then buffer expires before delivery time (same day) | Buffer expiry cron runs at 12:02 AM — delivery was created the day before or earlier. If buffer expires today, the last meal is generated at the slot time. Cron runs next day to expire. |
| buffer_meals_remaining > 0 but buffer_expiry_date < today | Buffer expiry cron catches these. Remaining meals refunded. |
| Buffer meal not delivered due to BLOCKED_TIFFIN_DEBT | Same as regular — delivery blocked. buffer_meals_remaining not decremented. Meal retried next day. |
| Buffer meal not delivered due to BLOCKED_LOW_WALLET | Not applicable — buffer meals skip wallet check. Buffer delivery always PENDING (unless tiffin debt). |
| Buffer period for paused subscription | Buffer is only entered AFTER end_date. If paused, end_date passes → direct to BUFFER (paused status not compatible — resume → BUFFER per M4). |
| Wallet refund at buffer expiry but wallet doesn't exist | Wallet always exists (created at subscription creation). Protected by FK. |
| Concurrent buffer expiry and renewal | Renewal sets status = EXPIRED. Buffer expiry cron skips (status no longer BUFFER). |

### Testing Strategy

| Type | Cases |
|------|-------|
| **Happy path** | ACTIVE with skipped_meal_pool > 0 → end_date passes → BUFFER activated |
| | BUFFER sub → delivery generated → DELIVERED → buffer_meals_remaining decremented |
| | BUFFER sub → buffer_expiry_date passes → remaining meals refunded |
| | ACTIVE with skipped_meal_pool = 0 → end_date passes → EXPIRED (skip buffer entirely) |
| **Buffer activation** | Multiple skips → pool = 5 → buffer_meals_remaining = 5 |
| | Zero skips → pool = 0 → EXPIRED (no buffer) |
| | buffer_days_snapshot = 7 → buffer_expiry_date = end_date + 7 |
| **Buffer consumption** | Buffer meals generated for BUFFER subs only |
| | is_buffer_meal = true on delivery record |
| | Wallet NOT deducted on delivery completion |
| | buffer_meals_remaining decremented per delivery |
| **Buffer failure** | First failure → FAILED_RESCHEDULED + replacement created next day |
| | Second failure → EXPIRED_BUFFER_FAILED + refund |
| | Cannot skip buffer meal → CANNOT_SKIP_BUFFER_MEAL |
| **Buffer expiry** | Expired buffer → refund = remaining × price_per_meal_snapshot |
| | Pending buffer deliveries → EXPIRED_BUFFER |
| | Subscription status → EXPIRED, settled_at set |
| **Wallet interaction** | Buffer meal delivered → no wallet change |
| | Buffer meal expired → wallet credited refund |
| | Buffer meal tiffin penalty → wallet DEBIT |
| **Buffer + lifecycle** | Renew during buffer → buffer refunded, new sub ACTIVE |
| | Cancel during buffer → buffer forfeited |
| | Buffer with 0 meals remaining → no deliveries generated |
| **Edge** | Buffer expiry on same day as last generation → last meal generated before expiry |
| | Buffer meal blocked by tiffin debt → not decremented, retried next day |
| | Large pool, short buffer → partial consumption, partial refund |

---

*Next module flows will be appended below as they are finalized.*
