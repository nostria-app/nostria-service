# Gift Subscription Notifications

## Overview

When a premium subscription is successfully gifted via a Nostr zap, the service automatically posts a notification event to Nostr informing the recipient about their new subscription.

## How It Works

1. **Zap Receipt Processed**: Service detects a valid zap receipt for a gift subscription
2. **Subscription Activated**: Premium subscription is activated for the recipient
3. **Notification Posted**: A kind 1 event is published to Nostr relays
4. **Recipient Notified**: The recipient sees the notification in their Nostr client

## Configuration

### Environment Variable

Add the following to your `.env` file:

```bash
# Private key for "Nostria Premium" account to post gift notifications
# Can be in hex format or nsec format
NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY=your_private_key_here
```

### Supported Key Formats

- **Hex format**: 64-character hexadecimal string
- **nsec format**: Nostr private key in bech32 format (e.g., `nsec1...`)

### Generating a Key Pair

You can generate a new key pair using nostr-tools:

```bash
npm install -g nostr-tools
npx nostr-tools generate-key
```

Or use any Nostr key generation tool. Make sure to:
1. Keep the private key secure
2. Set a profile for the public key with name "Nostria Premium"
3. Consider using a dedicated keypair just for these notifications

## Notification Event Format

The notification is a **kind 1** (text note) event with the following structure:

### Tags
- `p` tag: Contains the recipient's pubkey (ensures they see the notification)

### Content Example

```
🎁 Congratulations! You've received a Nostria Premium subscription as a gift!

Duration: 3 months
Gifted by: npub1zl...abc123

Your premium subscription is now active! As a premium member, you can claim your unique username.

👉 Set up your username here: https://nostria.app/premium

Enjoy your premium features! 🚀
```

### Content Components

- **Tier name**: "Premium" or "Premium+"
- **Duration**: Number of months
- **Gifted by**: Shortened npub of the gifter (first 12 + last 6 chars)
- **Call to action**: Link to https://nostria.app/premium for username setup

## Relays

The notification is published to a combination of relays:

1. **Relays from zap request**: Extracted from the `relays` tag in the kind 9734 zap request
2. **Nostria relays** (always included):
   - `wss://ribo.eu.nostria.app`
   - `wss://ribo.af.nostria.app`
   - `wss://ribo.us.nostria.app`

The relay lists are merged and deduplicated to ensure the notification reaches both:
- The gifter's preferred relays (where they're likely to see responses)
- Nostria's core infrastructure relays (for reliability)

### Example

If the zap request contains:
```json
["relays", "wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"]
```

The notification will be published to:
- `wss://relay.damus.io/`
- `wss://nos.lol/`
- `wss://relay.primal.net/`
- `wss://ribo.eu.nostria.app`
- `wss://ribo.af.nostria.app`
- `wss://ribo.us.nostria.app`

(6 unique relays total)

## Error Handling

- If `NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY` is not configured, a warning is logged and the notification is skipped
- If posting fails, an error is logged but the subscription activation continues
- Notification failures do not affect the subscription activation process

## Testing

### Manual Test

1. Configure the private key in your `.env` file
2. Send a test zap to the Nostria Payment pubkey with valid gift format
3. Check the logs for: `Posted gift notification to Nostr for <pubkey>`
4. Verify the event appears on Nostr relays using a client or relay query

### Query Posted Events

You can query the posted events using nostr-tools or any Nostr client:

```typescript
import { SimplePool } from 'nostr-tools';

const pool = new SimplePool();
const relays = ['wss://relay.damus.io'];

const events = await pool.list(relays, [{
  kinds: [1],
  authors: ['<your_notification_pubkey>'],
  limit: 10
}]);

console.log(events);
```

## Security Considerations

### Private Key Storage

- **Never commit** the private key to version control
- Use environment variables or secure key management services
- Consider using Azure Key Vault or similar for production
- Rotate keys periodically

### Account Setup

Recommended setup for the "Nostria Premium" notification account:

1. **Profile (kind 0)**:
   ```json
   {
     "name": "Nostria Premium",
     "display_name": "Nostria Premium",
     "about": "Official Nostria Premium subscription notifications",
     "picture": "https://nostria.app/logo.png",
     "nip05": "premium@nostria.app"
   }
   ```

2. **Verify NIP-05**: Set up `premium@nostria.app` to point to this pubkey

3. **Follow recommendation**: Suggest users follow this account for updates

## Monitoring

### Log Messages

Successful notification:
```
Posted gift notification to Nostr for <pubkey> (event <event_id>) to 5 relays
```

Warning if not configured:
```
NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY not configured, skipping notification post
```

Error if posting fails:
```
Failed to post gift notification to Nostr: <error_message>
```

### Database Tracking

While notifications themselves are not stored in the database, you can track successful gift activations via the `processed_zap_events` table:

```sql
SELECT 
  recipient_pubkey,
  tier,
  months,
  TO_TIMESTAMP(processed / 1000) as notified_at
FROM processed_zap_events
WHERE status = 'success'
ORDER BY processed DESC
LIMIT 10;
```

## Troubleshooting

### Notification not appearing

1. **Check private key**: Verify `NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY` is set correctly
2. **Check logs**: Look for error messages in the service logs
3. **Test relays**: Ensure the relays are accessible and accepting events
4. **Verify pubkey**: Confirm recipient's pubkey is correct in the zap content

### Key format errors

If you see "Invalid nsec format" errors:
- Verify the key is correctly formatted (hex or nsec)
- Check for extra whitespace or newlines
- Try converting between formats using nostr-tools

### Relay connection issues

If notifications aren't reaching all relays:
- Check relay connectivity
- Monitor relay health and response times
- Consider adjusting relay configuration in `NOSTR_ZAP_RELAYS`
