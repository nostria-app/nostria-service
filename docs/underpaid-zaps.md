# Handling Underpaid Zaps

## Overview

When a user sends a zap payment for a gifted premium subscription, the service validates that the payment amount matches the expected price (with 10% tolerance for BTC price fluctuations). If the payment is too low, the zap is saved with status `underpaid` for manual review by support.

## Database Schema

The `processed_zap_events` table tracks all processed zap receipts:

```sql
CREATE TABLE processed_zap_events (
  id              TEXT PRIMARY KEY,
  event_id        TEXT UNIQUE NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  gifted_by       TEXT NOT NULL,
  tier            TEXT NOT NULL,      -- 'premium' or 'premium-plus'
  months          INTEGER NOT NULL,
  amount_sats     INTEGER NOT NULL,
  status          TEXT NOT NULL,      -- 'success', 'underpaid', 'failed'
  error_message   TEXT,               -- Details about the issue
  processed       BIGINT NOT NULL,
  created         BIGINT NOT NULL
);
```

## Status Values

- **`success`**: Payment was sufficient and subscription was activated
- **`underpaid`**: Payment was below the minimum threshold (saved for manual review)
- **`failed`**: Processing failed due to an error during subscription activation

## Finding Underpaid Zaps

### Query underpaid zaps

```sql
SELECT 
  event_id,
  recipient_pubkey,
  gifted_by,
  tier,
  months,
  amount_sats,
  error_message,
  TO_TIMESTAMP(processed / 1000) as processed_at
FROM processed_zap_events
WHERE status = 'underpaid'
ORDER BY processed DESC;
```

### Example output

```
event_id                          | recipient_pubkey | tier    | months | amount_sats | error_message
----------------------------------|------------------|---------|--------|-------------|-------------------------------------------
abc123...                         | d1bd3333...      | premium | 1      | 971         | Underpaid by ~900.87 cents (expected 1000 cents...)
```

## Manual Resolution Process

### Option 1: User pays the difference

1. Contact the user who sent the gift (check `gifted_by` pubkey)
2. Request additional payment for the shortfall amount
3. Once received, manually activate the subscription (see below)

### Option 2: Accept as-is (business decision)

For small shortfalls (e.g., <5%), you may choose to accept the payment and activate the subscription anyway.

## Manually Activating a Subscription

### Check if account exists

```sql
SELECT id, pubkey, username, tier, expires
FROM accounts
WHERE pubkey = '<recipient_pubkey>';
```

### Option A: Account doesn't exist - create it

```sql
INSERT INTO accounts (
  id, 
  pubkey, 
  username, 
  tier, 
  expires, 
  created, 
  modified, 
  subscription
)
VALUES (
  gen_random_uuid()::text,
  '<recipient_pubkey>',
  NULL,  -- User will set username later
  '<tier>',  -- 'premium' or 'premium_plus'
  EXTRACT(EPOCH FROM NOW() + INTERVAL '<months> months') * 1000,
  EXTRACT(EPOCH FROM NOW()) * 1000,
  EXTRACT(EPOCH FROM NOW()) * 1000,
  jsonb_build_object(
    'type', '<tier>',
    'recurring', false,
    'giftedBy', '<gifted_by_pubkey>',
    'zapEventId', '<event_id>',
    'amountSats', <amount_sats>
  )
);
```

### Option B: Account exists - extend subscription

```sql
-- For free tier accounts, set initial expiry
UPDATE accounts
SET 
  tier = '<tier>',
  expires = EXTRACT(EPOCH FROM NOW() + INTERVAL '<months> months') * 1000,
  modified = EXTRACT(EPOCH FROM NOW()) * 1000,
  subscription = jsonb_build_object(
    'type', '<tier>',
    'recurring', false,
    'giftedBy', '<gifted_by_pubkey>',
    'zapEventId', '<event_id>',
    'amountSats', <amount_sats>
  )
WHERE pubkey = '<recipient_pubkey>' 
  AND (expires IS NULL OR expires < EXTRACT(EPOCH FROM NOW()) * 1000);

-- For active premium accounts, extend expiry
UPDATE accounts
SET 
  tier = '<tier>',
  expires = COALESCE(expires, EXTRACT(EPOCH FROM NOW()) * 1000) + (<months> * 30 * 24 * 60 * 60 * 1000),
  modified = EXTRACT(EPOCH FROM NOW()) * 1000,
  subscription = jsonb_build_object(
    'type', '<tier>',
    'recurring', false,
    'giftedBy', '<gifted_by_pubkey>',
    'zapEventId', '<event_id>',
    'amountSats', <amount_sats>
  )
WHERE pubkey = '<recipient_pubkey>'
  AND expires >= EXTRACT(EPOCH FROM NOW()) * 1000;
```

### Update the zap event status

After manually activating the subscription, update the status:

```sql
UPDATE processed_zap_events
SET 
  status = 'success',
  error_message = 'Manually activated by support after payment verification'
WHERE event_id = '<event_id>';
```

## Payment Record

You may also want to create a payment record for tracking:

```sql
INSERT INTO payments (
  id,
  pubkey,
  tier,
  provider,
  status,
  "amountCents",
  "lnInvoice",
  "lnHash",
  "isPaid",
  created,
  modified
)
VALUES (
  gen_random_uuid()::text,
  '<recipient_pubkey>',
  '<tier>',
  'nostr-zap',
  'succeeded',
  <amount_in_cents>,
  NULL,
  '<event_id>',
  true,
  EXTRACT(EPOCH FROM NOW()) * 1000,
  EXTRACT(EPOCH FROM NOW()) * 1000
);
```

## Preventing Future Underpayments

If underpayments become common due to BTC volatility:

1. **Increase tolerance**: Modify the 10% tolerance in `NostrZapService.validatePaymentAmount()`
2. **Adjust pricing**: Update tier pricing in configuration files
3. **Better UX**: Ensure the gifting UI shows current BTC amount needed in real-time

## Monitoring

### Count by status

```sql
SELECT 
  status, 
  COUNT(*) as count,
  SUM(amount_sats) as total_sats
FROM processed_zap_events
GROUP BY status;
```

### Recent underpayments

```sql
SELECT 
  event_id,
  tier,
  months,
  amount_sats,
  error_message,
  TO_TIMESTAMP(processed / 1000) as processed_at
FROM processed_zap_events
WHERE status = 'underpaid'
  AND processed > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
ORDER BY processed DESC;
```
