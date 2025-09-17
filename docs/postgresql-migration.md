# PostgreSQL Migration Guide

This guide explains how to migrate the Nostria service from CosmosDB to PostgreSQL using Prisma ORM while maintaining backwards compatibility.

## Overview

The migration implementation provides:

- **Dual Database Support**: Run both CosmosDB and PostgreSQL simultaneously
- **Gradual Migration**: Migrate data incrementally with validation
- **Backwards Compatibility**: Existing functionality continues to work during migration
- **Repository Pattern**: Clean abstraction layer for database operations
- **Migration Utilities**: Tools to transfer and validate data

## Architecture

### Database Layer Structure

```
src/database/
├── CosmosDbBaseRepository.ts     # Original CosmosDB base repository
├── PrismaBaseRepository.ts       # New PostgreSQL base repository
├── RepositoryFactory.ts          # Factory to switch between databases
├── prismaClient.ts              # PostgreSQL connection management
├── accountRepository.ts         # Original CosmosDB account repository
├── PrismaAccountRepository.ts   # New PostgreSQL account repository
└── ... (other repositories)
```

### Configuration

Database behavior is controlled by environment variables:

```bash
# PostgreSQL connection
DATABASE_URL="postgresql://username:password@localhost:5432/nostria"

# Database selection flags
USE_POSTGRESQL=true              # Use PostgreSQL as primary database
DUAL_DATABASE_MODE=true          # Support both databases during migration
MIGRATION_MODE=true              # Enable migration utilities

# CosmosDB connection (existing)
AZURE_COSMOSDB_CONNECTION_STRING="..."
AZURE_COSMOSDB_ENDPOINT="..."
```

## Migration Process

### Phase 1: Setup PostgreSQL

1. **Install Dependencies** (Already done)
   ```bash
   npm install @prisma/client prisma pg @types/pg
   ```

2. **Initialize Prisma Schema** (Already done)
   ```bash
   npx prisma init
   npx prisma generate
   ```

3. **Set up PostgreSQL Database**
   ```bash
   # Create database
   createdb nostria
   
   # Run migrations
   npx prisma migrate dev --name init
   ```

### Phase 2: Dual Database Mode

Enable dual database mode to run both systems simultaneously:

```bash
# Environment configuration
USE_POSTGRESQL=false            # Keep CosmosDB as primary
DUAL_DATABASE_MODE=true         # Enable both databases
MIGRATION_MODE=true             # Enable migration tools
DATABASE_URL="postgresql://..."
```

### Phase 3: Data Migration

#### Migration Commands

```bash
# Check current state
npm run migrate:stats

# Perform dry run to see what would be migrated
npm run migrate:dry-run

# Migrate all accounts
npm run migrate:accounts

# Migrate specific user's data
npm run migrate:user <pubkey>

# Verify data consistency
npm run migrate:verify <pubkey>

# Full migration with verification
npm run migrate:full
```

#### Manual Migration

```typescript
import { DataMigrationUtility } from './utils/DataMigrationUtility';

// Migrate accounts in batches
const progress = await DataMigrationUtility.migrateAccounts({
  batchSize: 100,
  skipExisting: true,
  dryRun: false
});

// Migrate specific user's backup jobs
await DataMigrationUtility.migrateUserBackupJobs('user-pubkey');

// Verify migration
const isConsistent = await DataMigrationUtility.verifyAccountMigration('user-pubkey');
```

### Phase 4: Switch to PostgreSQL

Once data is migrated and verified:

```bash
# Switch to PostgreSQL as primary
USE_POSTGRESQL=true
DUAL_DATABASE_MODE=false        # Optional: keep for rollback capability
MIGRATION_MODE=false            # Disable migration tools
```

### Phase 5: Cleanup

After confirming PostgreSQL works correctly:

```bash
# Disable CosmosDB completely
USE_POSTGRESQL=true
DUAL_DATABASE_MODE=false
MIGRATION_MODE=false

# Remove CosmosDB environment variables
# AZURE_COSMOSDB_CONNECTION_STRING=""
# AZURE_COSMOSDB_ENDPOINT=""
```

## Repository Factory Pattern

The `RepositoryFactory` provides a clean abstraction:

```typescript
import RepositoryFactory from './database/RepositoryFactory';

// Get account repository (CosmosDB or PostgreSQL based on config)
const accountRepo = RepositoryFactory.getAccountRepository();

// Use the same interface regardless of underlying database
const account = await accountRepo.getByPubkey('user-pubkey');
await accountRepo.update(account);
```

## Data Model Mapping

### Timestamps

- **CosmosDB**: Uses `number` (milliseconds since epoch)
- **PostgreSQL**: Uses `BigInt` for storage, converted to `number` for API

### JSON Fields

- **CosmosDB**: Native JSON support in documents
- **PostgreSQL**: Uses Prisma's `Json` type for complex objects (e.g., `subscription`, `metadata`)

### Primary Keys

- **CosmosDB**: Uses document ID and partition key (pubkey)
- **PostgreSQL**: Uses single primary key with foreign key relationships

### Type Field

- **CosmosDB**: Requires `type` field for document filtering
- **PostgreSQL**: Added automatically by repositories for compatibility

## Testing

### PostgreSQL Repository Tests

```bash
# Set up test database
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/nostria_test"

# Run PostgreSQL-specific tests
npm test src/database/postgres.test.ts
```

### Integration Tests

```bash
# Run all tests with dual database mode
DUAL_DATABASE_MODE=true npm test
```

## Monitoring and Validation

### Health Checks

```typescript
import RepositoryFactory from './database/RepositoryFactory';

// Check database health
const cosmosHealthy = await RepositoryFactory.checkCosmosHealth();
const postgresHealthy = await RepositoryFactory.checkPostgresHealth();
```

### Migration Statistics

```bash
# View migration progress
npm run migrate:stats
```

Output example:
```
=== Migration Statistics ===
CosmosDB:
  Accounts: 1,523
  Backup Jobs: 342
PostgreSQL:
  Accounts: 1,523
  Backup Jobs: 342

Migration Progress:
  Accounts: 100.0%
  Backup Jobs: 100.0%
```

## Rollback Strategy

If issues arise, you can rollback by:

1. **Switch back to CosmosDB**:
   ```bash
   USE_POSTGRESQL=false
   DUAL_DATABASE_MODE=true
   ```

2. **Fix issues and re-migrate**:
   ```bash
   npm run migrate:full
   ```

3. **Verify and switch again**:
   ```bash
   USE_POSTGRESQL=true
   ```

## Performance Considerations

### Migration Performance

- Use appropriate batch sizes (50-100 records)
- Run migrations during low-traffic periods
- Monitor database performance during migration

### Production Deployment

1. **Deploy with dual database mode first**
2. **Migrate data in production**
3. **Validate thoroughly**
4. **Switch to PostgreSQL**
5. **Monitor for issues**

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Verify DATABASE_URL format
   - Check PostgreSQL server status
   - Ensure database exists

2. **Migration Failures**
   - Check foreign key constraints
   - Verify data types match
   - Review error logs

3. **Type Mismatches**
   - Ensure BigInt conversion is working
   - Check JSON field serialization
   - Validate timestamp formats

### Debug Commands

```bash
# Check Prisma connection
npx prisma db pull

# Validate schema
npx prisma validate

# Reset database (development only)
npx prisma migrate reset
```

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `USE_POSTGRESQL` | Use PostgreSQL as primary DB | `false` |
| `DUAL_DATABASE_MODE` | Support both databases | `false` |
| `MIGRATION_MODE` | Enable migration utilities | `false` |
| `AZURE_COSMOSDB_CONNECTION_STRING` | CosmosDB connection | Required for CosmosDB |
| `AZURE_COSMOSDB_ENDPOINT` | CosmosDB endpoint | Alternative to connection string |

## Next Steps

1. **Complete Repository Implementation**: Add remaining repositories (notifications, payments, etc.)
2. **Enhanced Migration Tools**: Add support for incremental syncing
3. **Performance Optimization**: Add connection pooling and query optimization
4. **Monitoring**: Add metrics and alerting for database operations