# CosmosDB Migration

This document describes the migration from Azure Table Storage to CosmosDB for the notification system.

## Changes Made

### 1. New Models Created
- **NotificationSubscription** (`src/models/notificationSubscription.ts`): Represents Web Push subscriptions stored in CosmosDB
- **NotificationSettings** (`src/models/notificationSettings.ts`): Represents user notification preferences stored in CosmosDB  
- **NotificationLog** (`src/models/notificationLog.ts`): Represents notification history stored in CosmosDB

### 2. New Repositories Created
- **NotificationSubscriptionRepository** (`src/database/notificationSubscriptionRepository.ts`): Handles subscription CRUD operations
- **NotificationSettingsRepository** (`src/database/notificationSettingsRepository.ts`): Handles settings CRUD operations
- **NotificationLogRepository** (`src/database/notificationLogRepository.ts`): Handles logging and notification history

### 3. Unified Service
- **NotificationService** (`src/database/notificationService.ts`): Provides backward compatibility with the old `tableStorage` interface while using CosmosDB internally

### 4. Updated Routes
- **subscription.ts**: Updated to use the new NotificationService instead of tableStorage
- **notification.ts**: Updated to use the new NotificationService instead of tableStorage

### 5. Updated Utilities
- **webPush.ts**: Updated to use the new NotificationService instead of tableStorage

## Key Differences from Table Storage

1. **No Partition Key**: CosmosDB uses `pubkey` as the partition key and `type` to differentiate document types
2. **Document Structure**: All entities now have a `type` field to identify the document schema
3. **ID Strategy**: 
   - Subscriptions: `{pubkey}-{deviceKey}` for unique identification
   - Settings: `{pubkey}-settings` for user settings
   - Logs: `{pubkey}-{timestamp}-{random}` for notification logs

## Environment Variables

Ensure these environment variables are set for CosmosDB:
- `AZURE_COSMOSDB_CONNECTION_STRING` or `AZURE_COSMOSDB_ENDPOINT`
- `AZURE_COSMOSDB_DATABASE_NAME` (defaults to 'NostriaDB')
- `AZURE_COSMOSDB_CONTAINER_NAME` (defaults to 'Documents')

## Backward Compatibility

The NotificationService maintains backward compatibility with the old tableStorage interface, so existing code should continue to work without changes.
