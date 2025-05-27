# Nostria API Documentation

## Overview

The Nostria backend service provides APIs for managing user accounts with Premium and Premium+ subscriptions. Users are identified by their Nostr public keys (pubkey).

## Authentication

### Public APIs (No Authentication Required)
- User signup
- Pricing information
- User existence check

### Protected APIs (NIP-98 Authentication Required)
- Account management
- Subscription management
- User operations

### Admin APIs (NIP-98 + Admin Pubkey Required)
- User administration
- System statistics
- Manual subscription adjustments

## API Endpoints

### Public Signup APIs

#### POST /api/signup
Create a new user account.

**Request Body:**
```json
{
  "pubkey": "user_public_key",
  "email": "user@example.com", // optional
  "referralCode": "REFERRAL123", // optional
  "metadata": {} // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Account created successfully",
  "user": {
    "pubkey": "shortened_pubkey...",
    "tier": "free",
    "signupDate": "2025-05-27T...",
    "dailyNotificationLimit": 5
  }
}
```

#### GET /api/signup/check/:pubkey
Check if a public key is already registered.

**Response:**
```json
{
  "exists": false,
  "pubkey": "shortened_pubkey..."
}
```

#### GET /api/signup/pricing
Get subscription tiers and pricing information.

**Response:**
```json
{
  "success": true,
  "pricing": {
    "free": { "tier": "free", "price": 0, "dailyLimit": 5, "features": [...] },
    "premium": { "tier": "premium", "dailyLimit": 50, "features": [...], "pricing": {...} },
    "premium_plus": { "tier": "premium_plus", "dailyLimit": 500, "features": [...], "pricing": {...} }
  }
}
```

### Account Management APIs (NIP-98 Auth Required)

#### GET /api/account/profile
Get own account information.

**Headers:**
```
Authorization: Nostr <nip98_token>
```

**Response:**
```json
{
  "success": true,
  "account": {
    "pubkey": "user_pubkey",
    "email": "user@example.com",
    "signupDate": "2025-05-27T...",
    "tier": "premium",
    "subscription": {...},
    "recentPayments": [...],
    "totalNotificationsSent": 150
  }
}
```

#### PUT /api/account/profile
Update account profile.

**Headers:**
```
Authorization: Nostr <nip98_token>
```

**Request Body:**
```json
{
  "email": "newemail@example.com",
  "metadata": { "preferences": {...} }
}
```

#### GET /api/account/subscription
Get subscription details.

#### GET /api/account/payments
Get payment history.

**Query Parameters:**
- `limit`: Maximum number of payments to return (default: 25, max: 100)

#### GET /api/account/usage
Get notification usage statistics.

**Response:**
```json
{
  "success": true,
  "usage": {
    "current24Hours": 12,
    "dailyLimit": 50,
    "totalAllTime": 1250,
    "percentageUsed": 24,
    "tier": "premium"
  }
}
```

#### DELETE /api/account
Delete own account.

**Request Body:**
```json
{
  "confirmPubkey": "user_pubkey"
}
```

### Subscription Management APIs (NIP-98 Auth Required)

#### GET /api/subscription-management/pricing
Get subscription pricing (same as public pricing endpoint).

#### GET /api/subscription-management/status/:pubkey?
Get subscription status for authenticated user.

#### POST /api/subscription-management/upgrade
Upgrade or change subscription.

**Request Body:**
```json
{
  "tier": "premium",
  "billingCycle": "monthly",
  "paymentMethod": "stripe",
  "paymentToken": "payment_token"
}
```

#### POST /api/subscription-management/cancel
Cancel subscription.

**Request Body:**
```json
{
  "immediate": false // true for immediate cancellation, false for end of period
}
```

#### GET /api/subscription-management/payments
Get payment history for authenticated user.

### Admin APIs (NIP-98 Auth + Admin Pubkey Required)

#### GET /api/admin/users
Get all users with pagination.

**Query Parameters:**
- `limit`: Maximum number of users to return
- `skip`: Number of users to skip for pagination

#### GET /api/admin/users/:pubkey
Get detailed information about a specific user.

#### GET /api/admin/users/:pubkey/activity
Get user activity logs.

**Query Parameters:**
- `limit`: Maximum number of activity logs (default: 50, max: 200)
- `type`: Filter by activity type

#### GET /api/admin/users/:pubkey/subscription-history
Get user subscription change history.

#### PUT /api/admin/users/:pubkey/subscription
Manually adjust user subscription.

**Request Body:**
```json
{
  "tier": "premium",
  "billingCycle": "yearly",
  "expiryDate": "2026-05-27T...",
  "reason": "Customer service adjustment"
}
```

#### GET /api/admin/users/:pubkey/payments
Get payment history for a specific user.

#### GET /api/admin/statistics
Get system-wide statistics.

#### POST /api/admin/users/:pubkey/refund
Issue a refund or credit.

**Request Body:**
```json
{
  "amount": 999, // amount in cents
  "reason": "Customer service refund",
  "transactionId": "original_transaction_id" // optional
}
```

#### GET /api/admin/audit-logs
Get admin audit logs.

**Query Parameters:**
- `limit`: Maximum number of logs to return
- `admin`: Filter by specific admin pubkey

## Subscription Tiers

### Free Tier
- 5 notifications per day
- Basic web push notifications
- Community support
- Price: $0

### Premium Tier
- 50 notifications per day
- Advanced notification filtering
- Priority support
- Custom notification templates
- Pricing:
  - Monthly: $9.99
  - Quarterly: $24.97 (17% savings)
  - Yearly: $99.99 (17% savings)

### Premium+ Tier
- 500 notifications per day
- All Premium features
- API access
- Webhook integrations
- Advanced analytics
- Pricing:
  - Monthly: $19.99
  - Quarterly: $49.97 (17% savings)
  - Yearly: $199.99 (17% savings)

## Environment Variables

### Required
- `ADMIN_PUBKEYS`: Comma-separated list of admin public keys
- `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT`: Azure Table Storage connection

### Optional (with defaults)
- `PORT`: Server port (default: 3000)
- `TABLE_NAME`: Accounts table name (default: "accounts")
- `SUBSCRIPTIONS_TABLE_NAME`: Subscriptions table name (default: "subscriptions")
- `PAYMENTS_TABLE_NAME`: Payments table name (default: "payments")
- `ADMIN_AUDIT_TABLE_NAME`: Admin audit table name (default: "adminaudit")
- `SUBSCRIPTION_HISTORY_TABLE_NAME`: Subscription history table name (default: "subscriptionhistory")
- `USER_ACTIVITY_TABLE_NAME`: User activity table name (default: "useractivity")

### Subscription Limits
- `FREE_TIER_DAILY_LIMIT`: Free tier daily notification limit (default: 5)
- `PREMIUM_TIER_DAILY_LIMIT`: Premium tier daily notification limit (default: 50)
- `PREMIUM_PLUS_TIER_DAILY_LIMIT`: Premium+ tier daily notification limit (default: 500)

### Pricing (in cents)
- `PREMIUM_MONTHLY_PRICE`: Premium monthly price (default: 999)
- `PREMIUM_QUARTERLY_PRICE`: Premium quarterly price (default: 2497)
- `PREMIUM_YEARLY_PRICE`: Premium yearly price (default: 9999)
- `PREMIUM_PLUS_MONTHLY_PRICE`: Premium+ monthly price (default: 1999)
- `PREMIUM_PLUS_QUARTERLY_PRICE`: Premium+ quarterly price (default: 4997)
- `PREMIUM_PLUS_YEARLY_PRICE`: Premium+ yearly price (default: 19999)

## Azure Tables Structure

### accounts
- **PartitionKey**: User pubkey
- **RowKey**: Entity type ("profile", "notification-{timestamp}")
- Contains user profiles and notification logs

### subscriptions
- **PartitionKey**: User pubkey
- **RowKey**: "current"
- Contains current subscription information

### payments
- **PartitionKey**: User pubkey
- **RowKey**: "payment-{timestamp}-{random}"
- Contains payment history and refunds

### adminaudit
- **PartitionKey**: Admin pubkey
- **RowKey**: "audit-{timestamp}-{random}"
- Contains admin action logs

### subscriptionhistory
- **PartitionKey**: User pubkey
- **RowKey**: "history-{timestamp}-{random}"
- Contains subscription change history

### useractivity
- **PartitionKey**: User pubkey
- **RowKey**: "activity-{timestamp}-{random}"
- Contains user activity logs

## Error Responses

All API endpoints return errors in the following format:

```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (missing or invalid authentication)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource not found)
- `409`: Conflict (resource already exists)
- `500`: Internal Server Error

## Rate Limiting

No rate limiting is currently implemented, but it's recommended to add rate limiting in production environments.

## Security Notes

1. All admin operations are logged with pubkey, timestamp, and action details
2. User operations are logged for audit purposes
3. Payment information is stored securely in separate tables
4. Public keys are partially masked in logs for privacy
5. Admin pubkeys are configured via environment variables
6. NIP-98 tokens are validated for all protected endpoints

## Monitoring and Logging

The service uses Winston for logging with the following log levels:
- `error`: Error conditions
- `warn`: Warning conditions (failed auth attempts, etc.)
- `info`: General information (successful operations)
- `debug`: Debug information (detailed operation logs)

Logs include:
- User operations with pubkey (masked)
- Admin operations with full audit trail
- Payment processing events
- Subscription changes
- Authentication events
