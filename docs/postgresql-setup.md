# Local PostgreSQL Setup Guide

## Option 1: Using Docker (Recommended)

```bash
# Run PostgreSQL in Docker
docker run --name nostria-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=nostria \
  -p 5432:5432 \
  -d postgres:15

# Connection string for Docker setup:
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/nostria"
```

## Option 2: Install PostgreSQL Locally

### Windows:
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. Install with default settings
3. Remember the password you set for the `postgres` user
4. Create a database named `nostria`

### Using psql:
```sql
-- Connect to PostgreSQL
psql -U postgres

-- Create database
CREATE DATABASE nostria;

-- Create user (optional)
CREATE USER nostria_user WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE nostria TO nostria_user;
```

## Option 3: Using Azure Database for PostgreSQL

### Create Azure PostgreSQL:
```bash
# Using Azure CLI
az postgres flexible-server create \
  --resource-group your-resource-group \
  --name nostria-db \
  --admin-user nostria_admin \
  --admin-password YourStrongPassword123! \
  --sku-name Standard_B1ms \
  --version 15

# Get connection string
az postgres flexible-server show-connection-string \
  --server-name nostria-db
```

### Connection string format:
```bash
DATABASE_URL="postgresql://nostria_admin:YourStrongPassword123!@nostria-db.postgres.database.azure.com:5432/postgres?sslmode=require"
```

## Verification Steps

1. Update your `.env` file with the correct `DATABASE_URL`
2. Run database migrations:
   ```bash
   npm run db:migrate
   ```
3. Test the connection:
   ```bash
   npm run db:generate
   npm start
   ```