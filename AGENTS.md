# AGENTS.md - AI Coding Agent Guidelines

This document provides guidance for AI coding agents working in the nostria-service codebase.

## Project Overview

Nostria Service is a Node.js/TypeScript backend service for the Nostria platform, providing account management, subscriptions, payments, and notifications for Nostr users. It uses Express 5, PostgreSQL via Prisma ORM, and implements NIP-98 authentication.

## Build/Run/Test Commands

### Building
```bash
npm run build              # Generate Prisma client + compile TypeScript
```

### Running
```bash
npm run dev                # Development mode with hot reload (tsx watch)
npm run start              # Build and run production
```

### Testing
```bash
npm test                   # Run all unit tests
npm run test:watch         # Run tests in watch mode
npm run e2e                # Run end-to-end tests

# Run a single test file
npx jest path/to/file.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="pattern"

# Run a single test file in watch mode
npx jest --watch path/to/file.test.ts
```

### Database
```bash
npm run db:migrate         # Run Prisma migrations (dev)
npm run db:push            # Push schema changes to database
npm run db:reset           # Reset database (destructive!)
npm run db:generate        # Regenerate Prisma client
```

### No Linting Configured
This project does not have ESLint or Prettier configured. Follow the code style patterns below.

## Code Style Guidelines

### Naming Conventions

- **Timestamps**: Use `created` and `modified` (NOT `createdAt`/`modifiedAt`)
- **Interfaces/Types**: PascalCase (`Account`, `AccountDto`, `ApiResponse`)
- **Variables/Functions**: camelCase (`getAccount`, `isValidPubkey`)
- **Constants**: UPPER_SNAKE_CASE (`NOSTRIA_PREMIUM_PUBKEY`, `MAX_RETRIES`)
- **Files**: camelCase for modules (`prismaClient.ts`), PascalCase for classes (`PrismaAccountRepository.ts`)

### TypeScript

- Strict mode is enabled - handle all null/undefined cases
- Always provide explicit return types on functions
- Use interfaces for data models, type aliases for unions/utility types
- Prefer `interface` over `type` for object shapes
- Use generics when creating reusable abstractions

```typescript
// Good
async function getAccount(pubkey: string): Promise<Account | null> {
  // ...
}

// Bad - missing return type
async function getAccount(pubkey: string) {
  // ...
}
```

### Imports

Order imports as follows (with blank lines between groups):
1. Node.js built-in modules
2. External dependencies
3. Internal modules (config, database, middleware, etc.)
4. Relative imports

```typescript
import { Request, Response, Router } from 'express';

import { Account } from '../models/account';
import { RepositoryFactory } from '../database/RepositoryFactory';
import logger from '../utils/logger';
```

### Express Routes

- Export a default router from route files
- Add OpenAPI/Swagger JSDoc comments for documentation
- Apply rate limiting and auth middleware as arrays
- Use DTOs for request/response transformation

```typescript
const router = Router();

/**
 * @openapi
 * /api/v1/account/{pubkey}:
 *   get:
 *     summary: Get account by pubkey
 */
router.get('/:pubkey', [rateLimit, requireNIP98Auth], async (req: Request, res: Response) => {
  // Implementation
});

export default router;
```

### Repository Pattern

- Use `RepositoryFactory` to get repository instances
- Repositories extend `PrismaBaseRepository`
- Convert BigInt timestamps to numbers in DTOs
- Handle Prisma errors appropriately

```typescript
const accountRepo = RepositoryFactory.getAccountRepository();
const account = await accountRepo.findByPubkey(pubkey);
```

### Error Handling

- Use try-catch blocks with typed errors
- Return consistent error responses: `{ error: string }`
- Log errors with appropriate levels
- Never expose internal error details to clients

```typescript
try {
  const result = await someOperation();
  res.json(result);
} catch (error) {
  logger.error('Operation failed', { error, pubkey: pubkey.substring(0, 16) });
  res.status(500).json({ error: 'Operation failed' });
}
```

### Logging

- Use the Winston logger from `utils/logger.ts`
- Truncate pubkeys in logs for privacy: `pubkey.substring(0, 16)`
- Use appropriate log levels: debug, info, warn, error

```typescript
import logger from '../utils/logger';

logger.info('Account created', { pubkey: pubkey.substring(0, 16) });
logger.error('Payment failed', { error, amount });
```

### Testing

- Place unit tests alongside source files as `*.test.ts`
- Place E2E tests as `*.e2e.test.ts`
- Use Jest with ts-jest preset
- Mock external dependencies with `jest.mock()`
- Use test helpers from `helpers/testHelper.ts`

```typescript
import { testAccount, generateNIP98Token } from '../helpers/testHelper';

describe('AccountService', () => {
  it('should create account', async () => {
    const account = testAccount();
    // Test implementation
  });
});
```

### Async/Await

- Always use async/await (not raw Promises)
- Return `Promise<void>` or `Promise<T>` explicitly
- Handle errors with try-catch
- Use `Promise.all()` for parallel operations when appropriate

### Authentication

- **NIP-98**: For user endpoints (validates Nostr signatures)
- **API Key**: For internal/protected endpoints
- **Admin**: Pubkey whitelist for admin operations

## Project Structure

```
src/
├── config/          # Environment-specific configuration
├── database/        # Prisma client, repositories
├── helpers/         # Utility helpers (timestamps, test fixtures)
├── middleware/      # Express middleware (auth, errors)
├── models/          # TypeScript interfaces for data models
├── routes/          # Express route handlers
├── services/        # Business logic services
└── utils/           # Utilities (logger, nostr, webPush)
```

## Key Technologies

- **Runtime**: Node.js 22
- **Framework**: Express 5.1
- **Database**: PostgreSQL via Prisma 6.16
- **Authentication**: NIP-98 (Nostr), API keys
- **Testing**: Jest with ts-jest
- **Notifications**: web-push

## Copilot/Agent Instructions

From `.github/copilot-instructions.md`:

- Don't suffix variables with "At" (use `created`/`modified` instead)
- Use "created" and "modified" for timestamps
- This is a Node.js/TypeScript project built with npm
- Uses PostgreSQL with Prisma for storage

## Common Patterns

### Creating a New Route

1. Create route file in `src/routes/`
2. Add OpenAPI documentation
3. Apply appropriate middleware
4. Register in `src/index.ts`

### Creating a New Repository

1. Define interface in `src/models/`
2. Create repository class extending `PrismaBaseRepository`
3. Add to `RepositoryFactory`
4. Update Prisma schema if needed

### Adding Tests

1. Create `*.test.ts` file alongside the source file
2. Import test helpers for fixtures
3. Mock external dependencies
4. Run with `npx jest path/to/file.test.ts`
