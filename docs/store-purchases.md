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

| Variable | Required | Description |
| --- | --- | --- |
| `APPLE_IAP_BUNDLE_ID` | yes | Bundle id (default `app.nostria`) |
| `APPLE_IAP_APP_APPLE_ID` | no | Numeric App Store app id (diagnostics only) |
| `APPLE_IAP_ISSUER_ID` | yes | App Store Connect **In-App Purchase key** issuer id (UUID) |
| `APPLE_IAP_KEY_ID` | yes | Key id of the `.p8` key |
| `APPLE_IAP_PRIVATE_KEY` | yes | `.p8` contents — real newlines, `\n` escaped, or base64 of the file |
| `APPLE_IAP_ENVIRONMENT` | no | `production` \| `sandbox` \| `auto` (default `auto`) |
| `APPLE_IAP_ALLOW_UNVERIFIED_DECODE` | no | **Dev only** — decode JWS without Server API (ignored when `NODE_ENV=production`) |

#### Creating the App Store Connect key

1. App Store Connect → **Users and Access** → **Integrations** → **In-App Purchase**.
2. **Generate In-App Purchase Key**, name it e.g. `nostria-service`.
3. Copy the **Issuer ID** shown above the table → `APPLE_IAP_ISSUER_ID`.
4. Copy the **Key ID** of the new row → `APPLE_IAP_KEY_ID`.
5. Download `AuthKey_<KEYID>.p8` (**one download only**) → `APPLE_IAP_PRIVATE_KEY`.

> Use the **In-App Purchase** key type, not a generic App Store Connect API key.
> The In-App Purchase key is the one accepted by the App Store Server API
> (`/inApps/v1/...`).

For single-line secret stores (Azure App Service app settings, GitHub secrets), base64 the file:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_ABCD1234.p8"))
```

The verifier auto-detects base64 and `\n` escaped values.

`APPLE_IAP_ENVIRONMENT=auto` tries production first, then sandbox. **TestFlight purchases
run in the sandbox environment**, so leave it on `auto` in production so both work.

Also required in App Store Connect before any purchase can succeed:

- Paid Applications agreement active, plus banking and tax details.
- Subscription group with `nostria_premium_monthly` (auto-renewable, 1 month) in
  "Ready to Submit" or approved state, with localization, price, and review screenshot.

### App Store Server Notifications (V2)

Renewals happen on Apple's servers, so the backend must be told about them:

```
POST https://api.nostria.app/api/store/apple/notifications
```

Configure in App Store Connect → your app → **App Information** →
**App Store Server Notifications**: set both **Production Server URL** and
**Sandbox Server URL** to the URL above, version **V2**.

Handled notification types:

| Type | Effect |
| --- | --- |
| `SUBSCRIBED`, `DID_RENEW`, `OFFER_REDEEMED`, `ONE_TIME_CHARGE` | New payment row + subscription extended |
| `REFUND`, `REVOKE`, `EXPIRED`, `GRACE_PERIOD_EXPIRED` | Subscription expiry cut to the store expiry |
| `TEST` | Acknowledged (use "Request a Test Notification" in App Store Connect) |
| Everything else | Logged and ignored |

The webhook never trusts the POST body: the transaction id is decoded from the payload and
then re-fetched from the App Store Server API over TLS before it is applied. The endpoint is
unauthenticated by design (Apple cannot send credentials) but is rate limited.

Renewals are matched to accounts via `payments.storeOriginalTransactionId`, so the user's
**first** purchase must have gone through `/api/account/verify-store-purchase`.

### Diagnostics

```
GET https://api.nostria.app/api/store/config
```

Returns whether App Store verification is configured, which env vars are missing, the bundle
id, environment preference, and the product catalog. No secrets are exposed. The iOS debug
panel in the app (Settings → About → In-App Purchase Debug) reads this endpoint.

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
