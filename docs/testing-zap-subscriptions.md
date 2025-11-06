# Testing Nostr Zap Subscriptions

This guide explains how to test the Nostr zap subscription feature.

## Test Event Structure

Here's an example zap receipt event that the service will process:

```json
{
  "content": "",
  "created_at": 1762431233,
  "id": "05a34fde39dd4ee92e6af3761a71cc63feb54656d5f37a0434d93fddaa0ec4e2",
  "kind": 9735,
  "pubkey": "be1d89794bf92de5dd64c1e60f6a2c70c140abac9932418fee30c5c637fe9479",
  "sig": "bd57c8c83b838db87d3d9f4ce963d3461f0de8aae2c810ad7e05cc23818ae922ffbecda7467521b7fccf5c6ee1b65577a3d68a17368d737971ee4fb213368484",
  "tags": [
    [
      "p",
      "3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658"
    ],
    [
      "bolt11",
      "lnbc9710n1p5sey8lpp55688dwn5tqgwz0st8n4y59ktekt4s6au7d6948mu7e9dar6emh4qhp5sp896hqqsmuehvrlpvsvva366hty7shf86jvht8cz29h6s9ahdlqcqzzsxqyz5vqsp58rjvk6sxvelvddryt62rzs63zq0e2dup78tf4h3n4ycykjcrmcfq9qxpqysgqdn3cy93np4xwyekrqg3mpj2qjmcmh4ktkn9ml82j9cshtxd7yw4jszf7zuewmv2e3rdda8f6jl8matvjw5hnu6xx50z09xuc79hff4qpsc5kjx"
    ],
    [
      "description",
      "{\"kind\":9734,\"created_at\":1762431212,\"tags\":[[\"relays\",\"wss://relay.damus.io/\",\"wss://nos.lol/\",\"wss://relay.primal.net/\"],[\"amount\",\"971000\"],[\"p\",\"3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658\"]],\"content\":\"🎁 Nostria Premium Gift\\nd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b\\npremium\\n1\\nEnjoy!\",\"pubkey\":\"17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515\",\"id\":\"4acfe3a7cf0815344b13f71a954799fc7ee60ad8d2e0fa29fbb5a09032385eb9\",\"sig\":\"6d40abe6772a3a3b6f1c18a463913618cc20172c99c0a98729b2b5a71efc8da939789dab21c87dfc157e5ce36dedd084ebab4cb2930027e55bc70db1ec88684b\"}"
    ],
    [
      "preimage",
      "e96135b7cea71f86c365614944cbda0f68b05b9242262b06e0aa0d012806cd0c"
    ]
  ]
}
```

## Zap Request Content Breakdown

The `description` tag contains a JSON-encoded zap request. Here's the decoded content:

```json
{
  "kind": 9734,
  "created_at": 1762431212,
  "tags": [
    ["relays", "wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"],
    ["amount", "971000"],
    ["p", "3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658"]
  ],
  "content": "🎁 Nostria Premium Gift\nd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b\npremium\n1\nEnjoy!",
  "pubkey": "17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515",
  "id": "4acfe3a7cf0815344b13f71a954799fc7ee60ad8d2e0fa29fbb5a09032385eb9",
  "sig": "6d40abe6772a3a3b6f1c18a463913618cc20172c99c0a98729b2b5a71efc8da939789dab21c87dfc157e5ce36dedd084ebab4cb2930027e55bc70db1ec88684b"
}
```

### Content Format:
```
🎁 Nostria Premium Gift
d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
premium
1
Enjoy!
```

This means:
- **Recipient**: d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
- **Subscription Type**: premium (or premium-plus for Premium+)
- **Duration**: 1 month
- **Message**: Enjoy!

## Testing Locally

### 1. Start the Service
```bash
npm run dev
```

You should see in the logs:
```
NostrZapService configured with relays: wss://ribo.eu.nostria.app, ...
Starting NostrZapService...
NostrZapService started successfully
```

### 2. Monitor Logs

Watch for these log messages:
- `Received zap receipt event <id> from <pubkey>` - Event received
- `Payment validation: expected X cents, received ~Y cents` - Amount check
- `Successfully activated <tier> subscription for X month(s)` - Success
- `Created new account with gifted <tier> subscription` - New account

### 3. Verify Database

Check the account was created:
```sql
SELECT pubkey, username, tier, expires 
FROM "Account" 
WHERE pubkey = 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b';
```

Expected result:
- `pubkey`: d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
- `username`: NULL (not set yet)
- `tier`: premium
- `expires`: timestamp ~31 days from now

### 4. Set Username

The recipient can now set their username:

```bash
curl -X PUT http://localhost:3000/api/account \
  -H "Authorization: Nostr <NIP-98 token>" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser"}'
```

## Testing with Custom Events

To publish a test zap event to the relays:

1. Create a zap request (kind 9734) with the proper content format
2. Pay the Lightning invoice
3. The wallet/service will create a zap receipt (kind 9735)
4. The NostrZapService will pick it up from the relays

## Unit Tests

Run the unit tests:
```bash
npm test NostrZapService
```

Tests verify:
- Content parsing logic
- Payment validation
- Error handling for invalid data

## Troubleshooting

### Service Not Starting
Check logs for:
```
Failed to start NostrZapService: <error>
```

Common issues:
- No internet connection
- Relay connection issues
- Invalid relay URLs

### Events Not Being Processed
Check that:
1. Event has correct kind (9735)
2. Event has 'p' tag with Nostria pubkey
3. Description tag has valid JSON
4. Content format matches expected structure

### Payment Validation Failing
Check logs for:
```
Invalid payment amount for <type> <months> month(s): <sats> sats received
```

Ensure:
- Amount in millisats is correct (971000 millisats = 971 sats)
- Subscription type matches payment amount
- Calculation accounts for BTC price (currently uses $100k/BTC estimate)

## Example Test Scenarios

### Scenario 1: New User, 1 Month Premium
- Amount: 10,000 sats (~$10 at $100k/BTC)
- Type: premium
- Months: 1
- Expected: New account created, expires in 31 days

### Scenario 2: Existing User, 3 Month Premium+
- Amount: 75,000 sats (~$75 at $100k/BTC)
- Type: premium-plus
- Months: 3
- Expected: Subscription extended by 93 days

### Scenario 3: Invalid Amount
- Amount: 1,000 sats (too low)
- Type: premium
- Months: 1
- Expected: Validation fails, logged but not processed

### Scenario 4: Invalid Pubkey
- Recipient pubkey: "invalid"
- Expected: Parsing fails, logged error

## Monitoring

### Success Indicators
- Log: `Successfully activated <tier> subscription`
- Database: Account created/updated with correct tier and expiry
- No errors in logs

### Failure Indicators
- Log: `Failed to parse zap content`
- Log: `Invalid payment amount`
- Log: `Zap event missing bolt11 or description tag`

## Production Considerations

1. **Relay Reliability**: Use multiple reliable relays
2. **Price Updates**: Consider implementing real-time BTC price fetching
3. **Deduplication**: Track processed event IDs to prevent duplicates
4. **Monitoring**: Set up alerts for service failures
5. **Logging**: Ensure logs are properly collected and searchable
