# Backup API

The Backup API provides functionality for users to request backups of their data, which are processed asynchronously by background workers.

## Overview

The backup system uses Azure CosmosDB to store backup job metadata and tracks the lifecycle of backup requests from submission to completion.

## API Endpoints

### Create Backup Job
```
POST /api/backup
```

Request a new backup job. Requires NIP-98 authentication.

**Request Body:**
```json
{
  "backupType": "full|incremental|selective",
  "scheduledAt": "2025-01-01T00:00:00Z", // Optional
  "metadata": {
    "description": "Monthly backup", // Optional
    // Additional metadata fields
  }
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "backupType": "full",
  "requestedAt": "2025-06-23T10:30:00Z",
  "scheduledAt": "2025-01-01T00:00:00Z",
  "metadata": {
    "description": "Monthly backup"
  }
}
```

### Get Backup Job Details
```
GET /api/backup/{jobId}
```

Retrieve details for a specific backup job. Requires NIP-98 authentication.

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "backupType": "full",
  "requested": "2025-06-23T10:30:00Z",
  "started": "2025-06-23T11:00:00Z",
  "completed": "2025-06-23T11:45:00Z",
  "resultUrl": "https://example.com/download/backup.zip",
  "expires": "2025-06-30T11:45:00Z",
  "metadata": {
    "originalSize": 1048576,
    "compressedSize": 524288,
    "fileCount": 150
  }
}
```

### List User Backup Jobs
```
GET /api/backup?limit=50
```

Get a list of all backup jobs for the authenticated user. Requires NIP-98 authentication.

**Response (200):**
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "backupType": "full",
      "requestedAt": "2025-06-23T10:30:00Z",
      "completedAt": "2025-06-23T11:45:00Z",
      "resultUrl": "https://example.com/download/backup.zip"
    }
  ],
  "total": 1
}
```

## Backup Job Status Flow

1. **pending** - Job has been created and is waiting to be processed
2. **scheduled** - Job is scheduled for future execution
3. **in_progress** - Background worker has started processing the backup
4. **completed** - Backup has been successfully created and is available for download
5. **failed** - Backup processing failed (error message will be included)
6. **expired** - Backup download link has expired

## Environment Configuration

Add the following environment variables to your `.env` file:

```bash
# Azure CosmosDB (for backup jobs)
AZURE_COSMOSDB_CONNECTION_STRING=your_cosmosdb_connection_string_here
# For managed identity (recommended for production)
# AZURE_COSMOSDB_ENDPOINT=https://your-account.documents.azure.com:443/
AZURE_COSMOSDB_DATABASE_NAME=NostriaDB
AZURE_COSMOSDB_CONTAINER_NAME=Documents
```

## Rate Limiting

- **Backup Creation**: 10 requests per hour per IP
- **Backup Queries**: 100 requests per 15 minutes per IP

## Background Worker Integration

The API creates backup job records that are intended to be processed by a separate background worker service. The worker should:

1. Poll for pending jobs using `getPendingBackupJobs()`
2. Update job status to `in_progress` when starting
3. Perform the actual backup process
4. Update the job with completion status and result URL
5. Set expiration time for download links

## Security Considerations

- All endpoints require NIP-98 authentication
- Users can only access their own backup jobs (filtered by pubkey)
- Backup scheduling is limited to 30 days in the future
- Download URLs should be temporary and expire after a reasonable time

## CosmosDB Container Setup

The container is automatically created with:
- **Partition Key**: `/pubkey` (partitioned by user's public key)
- **Database**: `nostria` (configurable via env var)
- **Container**: `Documents` (shared container for all document types)
- **Document Type**: All backup jobs have `type: "backup-job"` for filtering

The backup system uses a single "Documents" container to store all entities, with a `type` field to distinguish between different document types. This allows for efficient querying and management of all data in a single container while maintaining clear separation by document type.

For production deployments, consider setting up:
- Appropriate throughput (RU/s) based on usage patterns
- TTL policies for automatic cleanup of old backup jobs
- Backup and restore policies for the CosmosDB container itself
