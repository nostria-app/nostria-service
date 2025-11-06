# Nostr Zap-based Premium Subscription

This document describes the implementation of the Nostr Zap-based premium subscription feature, which allows users to receive gifted premium subscriptions through Lightning Network zap payments.

## Overview

The system listens to Nostr zap receipt events (kind 9735) sent to the Nostria Payment public key. When a valid payment is detected for a premium subscription, it automatically activates or extends the premium subscription for the recipient.

## Key Components

### 1. NostrZapService (`src/services/NostrZapService.ts`)

The main service that:
- Subscribes to zap receipt events (kind 9735) on configured Nostr relays
- Processes all historical events on startup (no time filter)
- Tracks processed events in database to prevent duplicates
- Parses zap events to extract subscription details
- Validates payment amounts using real-time BTC/USD pricing
- Activates or extends premium subscriptions

**Configuration:**
- Nostria Payment Pubkey: `3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658`
- Relays can be configured via environment variable `NOSTR_ZAP_RELAYS` or use defaults from config

**Event Deduplication:**
- All processed zap events are stored in the `processed_zap_events` table
- Events are checked before processing to prevent duplicate activations
- Tracks: event ID, recipient, gifter, tier, months, amount, and timestamps

### 2. Configuration Updates

Updated both `config.production.ts` and `config.development.ts` to include:
```typescript
nostrZap: {
  relays: [
    'wss://ribo.eu.nostria.app',
    'wss://ribo.af.nostria.app',
    'wss://ribo.us.nostria.app',
    'wss://relay.damus.io',
    'wss://relay.primal.net'
  ]
}
```

### 3. Account Repository Updates

The account update functionality now supports:
- Creating accounts without usernames (for gifted subscriptions)
- Setting username later for accounts that don't have one
- Username validation when updating accounts

### 4. Username Setting

Users who receive gifted subscriptions can set their username later through the existing account update endpoint:
```
PUT /api/account
Authorization: Nostr <NIP-98 auth token>
Content-Type: application/json

{
  "username": "desired_username"
}
```

## Zap Event Format

### Expected Event Structure

The service expects zap receipt events (kind 9735) with the following structure:

```json
{
  "kind": 9735,
  "pubkey": "be1d89794bf92de5dd64c1e60f6a2c70c140abac9932418fee30c5c637fe9479",
  "tags": [
    ["p", "3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658"],
    ["bolt11", "lnbc..."],
    ["description", "{...zap request...}"],
    ["preimage", "..."]
  ]
}
```

### Zap Request Content Format

The description tag contains a JSON-encoded zap request (kind 9734) with content in the following format:

```
🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
1
Enjoy!
```

Lines:
1. Title (ignored)
2. Recipient public key (64 hex characters)
3. Subscription type: `premium` or `premium-plus`
4. Number of months (1-12)
5. Optional message

### Payment Validation

The service validates:
- Payment amount matches the subscription tier and duration
- Uses real-time BTC/USD exchange rate from LightningService
- Recipient pubkey is valid (64 hex characters)
- Subscription type is valid (`premium` or `premium-plus`)
- Number of months is between 1 and 12
- Event hasn't already been processed (deduplication)

**Price Calculation:**
- Premium: $10/month
- Premium+: $25/month
- Fetches current BTC/USD rate from `https://pay.ariton.app/price`
- Converts sats to USD cents using real-time rate
- Allows 10% tolerance for price fluctuations

**Formula:**
```
satToCents = (btcUsdRate * 100) / 100,000,000
estimatedPriceCents = amountSats * satToCents
minAcceptableCents = expectedPriceCents * 0.9
```

## Subscription Activation Logic

When a valid zap event is received:

1. **New User (No Account)**
   - Creates a new account with the subscription
   - No username is set initially
   - User can set username later through account update

2. **Existing User (Active Subscription)**
   - Extends the existing subscription expiry date
   - Upgrades tier if the gifted tier is higher

3. **Existing User (Expired Subscription)**
   - Activates a new subscription starting from now
   - Updates the tier to match the gifted subscription

## Service Lifecycle

The service is automatically started when the server starts and gracefully shut down when the server stops:

```typescript
// Started in src/index.ts after database initialization
nostrZapService.start();

// Stopped during graceful shutdown
nostrZapService.stop();
```

**Startup Behavior:**
1. Fetches current BTC/USD exchange rate
2. Connects to all configured Nostr relays
3. Subscribes to all historical zap events (no time filter)
4. Processes each event, skipping those already in database
5. Continues listening for new events in real-time

**Event Processing:**
- Historical events are processed on every startup
- Database tracks which events have been processed
- Duplicate events are automatically skipped
- Failed events can be retried on next restart

## Logging

The service provides comprehensive logging for:
- Service start/stop events
- Relay connections
- Received zap events
- Parsing errors
- Validation failures
- Subscription activations

Log levels:
- `info`: Normal operations, successful activations
- `warn`: Validation failures, missing data
- `error`: Parsing errors, service failures

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NOSTR_ZAP_RELAYS` | Comma-separated list of Nostr relay URLs | Uses config defaults |

Example:
```bash
NOSTR_ZAP_RELAYS=wss://relay1.com,wss://relay2.com,wss://relay3.com
```

## Testing

To test the zap subscription feature:

1. Create a zap payment to the Nostria Payment pubkey
2. Include the properly formatted content in the zap request
3. Monitor the server logs for processing

Example test event structure is provided in the implementation request.

## Security Considerations

1. **Payment Validation**: All payments are validated against expected amounts with a 10% tolerance
2. **Pubkey Validation**: Recipient pubkeys are validated for correct format
3. **Amount Verification**: The service checks that the payment amount matches the subscription tier
4. **Username Validation**: Usernames must meet validation criteria (3+ chars, alphanumeric + underscore)

## Future Improvements

1. ~~Real-time BTC Price~~: ✅ Implemented - fetches from LightningService
2. ~~Event Deduplication~~: ✅ Implemented - tracks processed events in database
3. **Notification**: Notify recipients when they receive a gifted subscription
4. **Gift Message**: Store and display the optional gift message from the zap
5. **Admin Dashboard**: View gifted subscriptions and their status
6. **Periodic Price Updates**: Refresh BTC price every N minutes instead of caching
7. **Retry Failed Events**: Automatic retry logic for temporarily failed events
