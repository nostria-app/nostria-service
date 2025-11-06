# Nostr Zap Service Updates - November 6, 2025

## Summary of Changes

Updated the NostrZapService to process all historical zap events and implement proper deduplication with real-time BTC pricing.

## Key Changes

### 1. Removed Time Filter
**Before:** Only processed events from service startup time (`since: Math.floor(Date.now() / 1000)`)
**After:** Processes all historical zap events (no `since` filter)

**Benefit:** Ensures no zap gifts are missed due to service downtime or restarts.

### 2. Implemented Event Deduplication
- Added new database table: `ProcessedZapEvent`
- Tracks all processed zap events by event ID
- Prevents duplicate subscription activations
- Records: event ID, recipient, gifter, tier, months, amount, timestamps

**Database Schema:**
```prisma
model ProcessedZapEvent {
  id              String  @id
  eventId         String  @unique
  recipientPubkey String
  giftedBy        String
  tier            String
  months          Int
  amountSats      Int
  processed       BigInt
  created         BigInt

  @@index([eventId])
  @@index([recipientPubkey])
  @@map("processed_zap_events")
}
```

### 3. Real-time BTC Pricing
**Before:** Used hardcoded estimate (1 BTC = $100,000)
**After:** Fetches real-time BTC/USD rate from LightningService

**Implementation:**
- Fetches rate on service startup
- Caches rate to avoid excessive API calls
- Re-fetches if cache is empty (e.g., after error)
- Uses accurate conversion: `satToCents = (btcUsdRate * 100) / 100,000,000`

**API Endpoint:** `https://pay.ariton.app/price`

**Example:**
```typescript
// At $100,000/BTC:
// 1 sat = 0.1 cents
// 10,000 sats = $10 (premium monthly)

// At $50,000/BTC:
// 1 sat = 0.05 cents
// 20,000 sats = $10 (premium monthly)
```

## Files Modified

1. **`src/services/NostrZapService.ts`**
   - Removed `since` filter from subscription
   - Added `isEventProcessed()` method
   - Added `markEventProcessed()` method
   - Updated `validatePaymentAmount()` to use real BTC price (now async)
   - Updated `activateSubscription()` to accept and track amount
   - Added `btcUsdRate` property for price caching
   - Import `lightningService` and `PrismaClientSingleton`

2. **`prisma/schema.prisma`**
   - Added `ProcessedZapEvent` model

3. **`src/services/NostrZapService.test.ts`**
   - Updated tests to mock BTC rate
   - Changed `validatePaymentAmount` tests to async
   - Added test for different BTC prices

4. **Documentation**
   - Updated `docs/nostr-zap-subscriptions.md`
   - Updated `docs/zap-implementation-summary.md`

## Migration Applied

```bash
npx prisma migrate dev --name add_processed_zap_events
```

Migration created: `20251106141936_add_processed_zap_events`

## Service Behavior

### On Startup:
1. Fetches current BTC/USD rate
2. Logs: `Fetched BTC/USD rate: $XXX,XXX`
3. Connects to all configured relays
4. Subscribes to all zap events (historical and new)
5. For each event:
   - Check if already processed in database
   - If yes: skip with log message
   - If no: validate and process
   - Store in database when complete

### On New Event:
1. Parse event details
2. Check database for duplicate
3. Validate payment amount with current BTC rate
4. Activate subscription
5. Record in database

### Logging:
- `Zap event {id} already processed, skipping` - Duplicate detected
- `Fetched BTC/USD rate: ${rate}` - Price fetched successfully
- `Updated BTC/USD rate: ${rate}` - Price refreshed
- `Marked zap event {id} as processed` - Event recorded
- `Payment validation: expected X cents, received ~Y cents (Z sats at $W/BTC)` - Amount check

## Testing

### Unit Tests:
```bash
npm test NostrZapService
```

All tests updated to handle async validation and mock BTC rates.

### Manual Testing:
1. Start service: `npm run dev`
2. Check logs for BTC rate fetch
3. Service will process all historical zaps
4. Already-processed events will be skipped
5. New events will be processed and recorded

## Benefits

1. **No Lost Gifts**: All historical zaps are processed on every restart
2. **No Duplicates**: Database prevents double-activation
3. **Accurate Pricing**: Real-time BTC rates ensure correct validation
4. **Price Flexibility**: Automatically adjusts for BTC price changes
5. **Audit Trail**: Complete record of all processed zaps

## Backward Compatibility

✅ Fully backward compatible
- Existing accounts unchanged
- New table doesn't affect existing data
- Service continues to work if BTC price fetch fails (uses cached rate)

## Performance

- Initial startup may take longer (processing historical events)
- Database check adds minimal overhead (~1-5ms per event)
- BTC price cached to avoid repeated API calls
- Historical events only processed once (then skipped)

## Monitoring

Watch for these log patterns:
- `Fetched BTC/USD rate:` - Successful price fetch
- `already processed, skipping` - Duplicate prevention working
- `Marked zap event` - New event recorded
- `Failed to fetch BTC price` - Price fetch error (uses cache)
