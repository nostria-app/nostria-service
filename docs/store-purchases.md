# Native Store Purchases (App Store / Play Store)

Endpoint used by the Nostria iOS/Android clients after a successful in-app purchase:

```
POST /api/account/verify-store-purchase
```

## Request

```json
{
  "purchaseToken": "<jws or purchase token>",
  "pubkey": "<64 hex chars>",
  "store": "app-store",
  "productId": "nostria_premium_monthly",
  "username": "optional",
  "jwsRepresentation": "<optional StoreKit 2 JWS>"
}
```

| Field | Notes |
| --- | --- |
| `store` | `app-store` or `play-store` |
| `purchaseToken` | App Store: StoreKit 2 JWS (preferred) or transaction id. Play: purchase token |
| `productId` | Required for Play. Validated against App Store payload when present |
| `username` | Claimed on first upgrade when the tier includes `USERNAME` |

## Response

```json
{
  "success": true,
  "alreadyProcessed": false,
  "paymentId": "payment-store-…",
  "store": "app-store",
  "productId": "nostria_premium_monthly",
  "transactionId": "…",
  "account": { "pubkey": "…", "tier": "premium", "expires": 0, "…": "…" }
}
```

Idempotent on `storeTransactionId` (same transaction returns `alreadyProcessed: true`).

## Product catalog

Defined in `src/services/storeProductCatalog.ts`. Primary App Store SKU:

| Product ID | Tier | Cycle | Price (cents) |
| --- | --- | --- | --- |
| `nostria_premium_monthly` | premium | monthly | 999 |

## Environment variables

### App Store

| Variable | Description |
| --- | --- |
| `APPLE_IAP_BUNDLE_ID` | Bundle id (default `app.nostria`) |
| `APPLE_IAP_ISSUER_ID` | App Store Connect API issuer id |
| `APPLE_IAP_KEY_ID` | App Store Connect API key id |
| `APPLE_IAP_PRIVATE_KEY` | `.p8` private key PEM (`\n` escaped OK) |
| `APPLE_IAP_ALLOW_UNVERIFIED_DECODE` | **Dev only** — decode JWS without Server API (`NODE_ENV!=production`) |

Create an **App Store Connect API** key with **In-App Purchase** / App Manager access, then download the `.p8` key.

### Google Play

| Variable | Description |
| --- | --- |
| `GOOGLE_PLAY_PACKAGE_NAME` | Package name (default `app.nostria`) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Full service account JSON string |
| `GOOGLE_PLAY_ALLOW_UNVERIFIED` | **Dev only** |

Link the Play Console app to a Google Cloud service account with **Android Publisher** permission.

## Flow

1. Client completes StoreKit / Play Billing purchase.
2. Client posts token + pubkey to this endpoint.
3. Service verifies with Apple/Google.
4. Creates a paid `payments` row (`paymentType` = `app-store` \| `play-store`).
5. Creates or extends the `accounts` subscription (uses store `expiresDate` when present).

## Database

Migration adds:

- `payments.storeTransactionId` (unique)
- `payments.storeOriginalTransactionId`
- `payments.storeProductId`
