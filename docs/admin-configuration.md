# Admin Configuration Guide

## Overview

This application now supports admin-only access to certain list endpoints. Admin users are identified by their public keys which must be configured in the environment variables.

## Environment Configuration

### Setting Up Admin Users

Add the following environment variable to your `.env` file:

```bash
# Admin Configuration
# Comma-separated list of public keys that have admin access to list endpoints
ADMIN_PUBKEYS=your_admin_pubkey_1,your_admin_pubkey_2,your_admin_pubkey_3
```

### Example

```bash
ADMIN_PUBKEYS=a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890,b2c3d4e5f6789012345678901234567890123456789012345678901234567890a1
```

## Admin-Only Endpoints

The following endpoints now require admin authentication:

### 1. Account List
- **Endpoint**: `GET /api/account/list`
- **Description**: Lists all user accounts
- **Parameters**: 
  - `limit` (optional): Maximum number of accounts to return (1-1000, default: 100)

### 2. Payment List
- **Endpoint**: `GET /api/payment`
- **Description**: Lists all payment records
- **Parameters**:
  - `limit` (optional): Maximum number of payments to return (1-1000, default: 100)

### 3. Subscription List
- **Endpoint**: `GET /api/subscription/list`
- **Description**: Lists all notification subscriptions
- **Parameters**:
  - `limit` (optional): Maximum number of subscriptions to return (1-1000, default: 100)

## Authentication

All admin endpoints require:

1. **NIP-98 Authentication**: Standard authentication using the user's private key to sign the request
2. **Admin Authorization**: The authenticated user's public key must be included in the `ADMIN_PUBKEYS` configuration

## Response Codes

- **200**: Success - Admin access granted and data returned
- **401**: Unauthorized - Missing or invalid NIP-98 authentication
- **403**: Forbidden - Valid authentication but user is not an admin
  - `Admin access required` - User's public key is not in the admin list
  - `Admin access not configured` - No admin public keys are configured in the environment

## Implementation Details

### Middleware

The `requireAdminAuth` middleware:
1. First validates NIP-98 authentication (delegates to `requireNIP98Auth`)
2. Checks if the authenticated user's public key is in the admin list
3. Grants access only if both conditions are met

### Configuration Structure

The admin configuration is loaded from environment variables during application startup:

```typescript
{
  admin: {
    pubkeys: string[] // Array of admin public keys
  }
}
```

## Security Considerations

1. **Public Key Management**: Keep admin public keys secure and rotate them periodically
2. **Environment Variables**: Ensure `.env` files with admin keys are not committed to version control
3. **Access Logging**: Admin access is logged for audit purposes
4. **Principle of Least Privilege**: Only assign admin access to users who need it

## Testing

To test admin endpoints:

1. Configure test admin keys in your test environment
2. Generate NIP-98 tokens using the admin private keys
3. Make requests to admin endpoints with proper authentication headers

Example test setup:
```typescript
const adminPubkey = 'your_test_admin_pubkey';
const adminAuth = await generateNIP98WithPubkey(adminPubkey);
const response = await request(app)
  .get('/api/account/list')
  .set('Authorization', `Nostr ${adminAuth.token}`);
```

## Troubleshooting

### Common Issues

1. **403 Forbidden - Admin access required**
   - Verify the user's public key is correctly added to `ADMIN_PUBKEYS`
   - Check for typos in the public key (must be exact match)
   - Ensure the environment variable is loaded correctly

2. **403 Forbidden - Admin access not configured**
   - Verify `ADMIN_PUBKEYS` environment variable is set
   - Check that the application has restarted after adding the variable
   - Ensure the variable is not empty

3. **401 Unauthorized**
   - Check NIP-98 authentication is working correctly
   - Verify the request signature and headers are valid

### Debug Steps

1. Check application logs for admin authentication attempts
2. Verify environment variable loading: `console.log(process.env.ADMIN_PUBKEYS)`
3. Confirm the exact public key format matches what's in the environment variable