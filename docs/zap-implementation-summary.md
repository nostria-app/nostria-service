# Nostr Zap-based Premium Subscription - Implementation Summary

## Overview
Implemented a complete system for handling gifted premium subscriptions through Nostr zap payments (Lightning Network). The system listens to zap receipt events, validates payments, and automatically activates premium subscriptions.

## Files Created

### 1. `src/services/NostrZapService.ts`
Main service that handles Nostr zap event subscriptions:
- Connects to configurable Nostr relays
- Subscribes to kind 9735 zap receipt events (all historical events)
- Implements event deduplication via database tracking
- Parses zap content to extract subscription details
- Validates payment amounts using real-time BTC/USD pricing from LightningService
- Allows 10% tolerance for BTC price fluctuations
- Activates or extends premium subscriptions
- Creates accounts without usernames for gifted subscriptions

### 2. `src/services/NostrZapService.test.ts`
Unit tests for the zap service:
- Tests zap content parsing (valid/invalid formats)
- Tests payment amount validation
- Tests subscription type validation
- Tests edge cases (multi-line messages, missing fields)

### 3. `docs/nostr-zap-subscriptions.md`
Comprehensive documentation covering:
- System architecture
- Event format specifications
- Configuration options
- Security considerations
- Testing procedures
- Future improvements

## Files Modified

### 1. `src/config/types.ts`
- Added `nostrZap` configuration type with relay settings

### 2. `src/config/config.production.ts`
- Added `nostrZap` configuration with default relay URLs
- Supports `NOSTR_ZAP_RELAYS` environment variable

### 3. `src/config/config.development.ts`
- Added `nostrZap` configuration (same as production)

### 4. `src/index.ts`
- Imported and initialized `NostrZapService`
- Added service startup after database initialization
- Added graceful shutdown for the service
- Service continues running in background, non-blocking

### 5. `src/routes/account.ts`
- Enhanced username validation in account update endpoint
- Added validation to ensure username is not already taken by another user
- Supports setting username for accounts that don't have one yet (gifted subscriptions)

### 6. `prisma/schema.prisma`
- Added `ProcessedZapEvent` model to track processed zap events
- Prevents duplicate processing of the same zap
- Stores event ID, recipient, gifter, tier, months, amount, and timestamps

## Key Features

### 1. Nostr Event Subscription
- Listens to kind 9735 (zap receipt) events
- Filters for events sent to Nostria Payment pubkey: `3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658`
- Configurable relay list (default: 5 relays including Nostria and public relays)
- **Processes all historical events on startup** (no time filter)
- Continues listening for new events in real-time

### 2. Event Deduplication
- All processed events stored in `processed_zap_events` database table
- Checks event ID before processing to prevent duplicates
- Records: event ID, recipient pubkey, gifter pubkey, tier, months, amount, timestamps
- Failed events can be retried on service restart

### 3. Real-time BTC Pricing
- Fetches current BTC/USD rate from `https://pay.ariton.app/price` via LightningService
- Caches rate to avoid excessive API calls
- Re-fetches if cache is empty
- Uses accurate conversion: `satToCents = (btcUsdRate * 100) / 100,000,000`
- Allows 10% tolerance for price fluctuations

### 4. Payment Validation
- Parses bolt11 invoice and zap request from event tags
- Extracts amount from zap request tags
- Validates amount matches subscription tier pricing using real-time BTC rate
- Validates subscription type (premium or premium_plus)
- Validates duration (1-12 months)

### 5. Subscription Activation
- Creates new account if user doesn't exist
- Extends existing subscription if not expired
- Upgrades tier if gifted tier is higher
- Supports accounts without usernames (for gifts)

### 6. Username Setting
Expected zap request content format:
```
🎁 Nostria Premium Gift
<recipient_pubkey>
<premium|premium_plus>
<months>
<optional_message>
```

### 5. Username Setting
- Users can set username later via existing account update endpoint
- Validation ensures username meets requirements:
  - Minimum 2 characters
  - Alphanumeric and underscore only
  - Not reserved
  - Not already taken by another user

## Configuration

### Environment Variables
- `NOSTR_ZAP_RELAYS`: Comma-separated relay URLs (optional, uses config defaults)

### Default Relays
1. wss://ribo.eu.nostria.app
2. wss://ribo.af.nostria.app
3. wss://ribo.us.nostria.app
4. wss://relay.damus.io
5. wss://relay.primal.net

## Pricing Reference
- Premium: $10/month ($1000 cents)
- Premium+: $25/month ($2500 cents)
- Quarterly and yearly pricing also supported

## Security Features
1. **Pubkey Validation**: Ensures 64 hex character format
2. **Payment Verification**: Validates amount matches expected price
3. **Type Validation**: Only accepts 'premium' or 'premium_plus'
4. **Duration Limits**: Only 1-12 months accepted
5. **Username Validation**: Enforces username rules when setting

## Error Handling
Comprehensive logging for:
- Connection issues
- Invalid event formats
- Payment validation failures
- Database errors
- Service lifecycle events

All errors are logged but don't crash the service - it continues processing subsequent events.

## Testing
Run tests with:
```bash
npm test NostrZapService
```

Tests cover:
- Valid zap content parsing
- Invalid format rejection
- Payment amount validation
- Edge cases and boundary conditions

## Future Enhancements
1. ~~Real-time BTC/USD price fetching from LightningService~~ ✅ Implemented
2. ~~Event deduplication to prevent double-processing~~ ✅ Implemented
3. Notification system for gift recipients
4. Gift message storage and display
5. Admin dashboard for monitoring gifted subscriptions
6. Support for other billing cycles (quarterly, yearly)
7. Periodic BTC price refresh (e.g., every 5 minutes)

## API Endpoints

### Set Username (for gifted accounts)
```http
PUT /api/account
Authorization: Nostr <NIP-98 token>
Content-Type: application/json

{
  "username": "myusername"
}
```

Response:
```json
{
  "pubkey": "...",
  "username": "myusername",
  "tier": "premium",
  "expires": 1762431233,
  "entitlements": {...}
}
```

## Deployment Notes
1. Service starts automatically with the application
2. Non-blocking - app continues if service fails to start
3. Gracefully shuts down with the application
4. No additional setup required beyond environment variables
5. Works with existing PostgreSQL database schema

## Summary
Successfully implemented a complete Nostr zap-based premium subscription system that:
- ✅ Listens to zap receipts on configured relays
- ✅ Parses and validates zap events
- ✅ Activates premium subscriptions automatically
- ✅ Supports gifted subscriptions without usernames
- ✅ Allows username setting later
- ✅ Includes comprehensive error handling and logging
- ✅ Has unit tests for core functionality
- ✅ Fully documented
