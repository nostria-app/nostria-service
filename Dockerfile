FROM node:22-slim AS build

# Create app directory
WORKDIR /app

# Install app dependencies including dev dependencies for TypeScript compilation
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci && npm cache clean --force

# Bundle app source - only copy necessary files
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

FROM node:22-alpine AS runtime

# Create app directory and data directory for notification logs
WORKDIR /app
RUN mkdir -p /app/data && \
    chmod -R 755 /app/data

# Copy package.json for production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application and static files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/public ./dist/public

# Set environment variables
ENV NODE_ENV=production
EXPOSE 3000

# Health check
# HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
#   CMD wget -O - http://localhost:3000/api/status/health || exit 1

# Run the application
CMD ["node", "dist/index.js"]
