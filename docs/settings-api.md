# User Settings API

The User Settings API provides CRUD operations for managing generic user settings in the Nostria service. It uses NIP-98 authentication for all operations.

## Base URL
```
/api/settings
```

## Authentication
All endpoints require NIP-98 authentication. Include the authorization token in the `Authorization` header:
```
Authorization: Bearer <nip98-token>
```

## Endpoints

### 1. Create/Update User Settings
**POST** `/api/settings/:pubkey`

Creates or updates user settings for the specified pubkey.

#### Parameters
- `pubkey` (path): User's public key

#### Request Body
```json
{
  "releaseChannel": "stable" | "beta" | "alpha",
  "socialSharing": boolean
}
```

#### Response
```json
{
  "success": true,
  "message": "User settings saved successfully",
  "data": {
    "pubkey": "string",
    "releaseChannel": "stable" | "beta" | "alpha",
    "socialSharing": boolean,
    "created": "2025-06-24T10:30:00.000Z",
    "modified": "2025-06-24T10:30:00.000Z"
  }
}
```

#### Example
```bash
curl -X POST "https://api.nostria.app/api/settings/npub123..." \
  -H "Authorization: Bearer <nip98-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "releaseChannel": "beta",
    "socialSharing": false
  }'
```

### 2. Get User Settings
**GET** `/api/settings/:pubkey`

Retrieves user settings for the specified pubkey. Returns default settings if none exist.

#### Parameters
- `pubkey` (path): User's public key

#### Response
```json
{
  "success": true,
  "message": "User settings retrieved successfully",
  "data": {
    "pubkey": "string",
    "releaseChannel": "stable" | "beta" | "alpha",
    "socialSharing": boolean,
    "created": "2025-06-24T10:30:00.000Z",
    "modified": "2025-06-24T10:30:00.000Z"
  },
  "isDefault": false // true if default settings are returned
}
```

#### Example
```bash
curl -X GET "https://api.nostria.app/api/settings/npub123..." \
  -H "Authorization: Bearer <nip98-token>"
```

### 3. Update Specific Settings
**PATCH** `/api/settings/:pubkey`

Updates specific user settings fields without affecting others.

#### Parameters
- `pubkey` (path): User's public key

#### Request Body
```json
{
  "releaseChannel": "alpha"
  // Only include fields you want to update
}
```

#### Response
```json
{
  "success": true,
  "message": "User settings updated successfully",
  "data": {
    "pubkey": "string",
    "releaseChannel": "alpha",
    "socialSharing": true, // unchanged from previous value
    "created": "2025-06-24T10:30:00.000Z",
    "modified": "2025-06-24T10:35:00.000Z"
  }
}
```

#### Example
```bash
curl -X PATCH "https://api.nostria.app/api/settings/npub123..." \
  -H "Authorization: Bearer <nip98-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "releaseChannel": "alpha"
  }'
```

### 4. Delete User Settings
**DELETE** `/api/settings/:pubkey`

Deletes all user settings for the specified pubkey.

#### Parameters
- `pubkey` (path): User's public key

#### Response
```json
{
  "success": true,
  "message": "User settings deleted successfully"
}
```

#### Example
```bash
curl -X DELETE "https://api.nostria.app/api/settings/npub123..." \
  -H "Authorization: Bearer <nip98-token>"
```

### 5. Get Users by Release Channel (Admin)
**GET** `/api/settings/admin/release-channel/:channel`

Retrieves all users using a specific release channel. This is an admin endpoint for feature rollout management.

#### Parameters
- `channel` (path): Release channel ("stable", "beta", or "alpha")

#### Response
```json
{
  "success": true,
  "message": "Users with release channel 'beta' retrieved successfully",
  "data": {
    "releaseChannel": "beta",
    "userCount": 25,
    "users": ["npub123...", "npub456...", "npub789..."]
  }
}
```

#### Example
```bash
curl -X GET "https://api.nostria.app/api/settings/admin/release-channel/beta"
```

## Settings Fields

### Release Channel
- **Type**: `string`
- **Values**: `"stable"`, `"beta"`, `"alpha"`
- **Default**: `"stable"`
- **Description**: Determines which version/features the user receives
  - `stable`: Production-ready features only
  - `beta`: Pre-release features for testing
  - `alpha`: Experimental features (may be unstable)

### Social Sharing
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Whether the user allows social sharing features

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request parameter",
  "message": "Detailed error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid or missing authorization token",
  "message": "NIP-98 authorization required"
}
```

### 404 Not Found
```json
{
  "error": "Settings not found",
  "message": "No user settings found for the specified pubkey"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Failed to process request"
}
```

## Usage Examples

### Setting up a beta tester
```javascript
// User opts into beta channel
await fetch('/api/settings/npub123...', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + nip98Token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    releaseChannel: 'beta',
    socialSharing: true
  })
});
```

### Disabling social sharing
```javascript
// User disables social sharing
await fetch('/api/settings/npub123...', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer ' + nip98Token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    socialSharing: false
  })
});
```

### Getting beta testers for feature rollout
```javascript
// Admin gets list of beta users
const response = await fetch('/api/settings/admin/release-channel/beta');
const { data } = await response.json();
console.log(`Found ${data.userCount} beta testers`);
```
