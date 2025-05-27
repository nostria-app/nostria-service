FROM node:22-slim AS build

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Bundle app source - only copy necessary files
COPY src/ ./src/
COPY *.js ./
COPY *.json ./

FROM node:22-alpine AS runtime

# Create app directory and data directory for notification logs
WORKDIR /app
RUN mkdir -p /app/data && \
    chmod -R 755 /app/data

# Copy only needed files from the build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/*.js ./
COPY --from=build /app/*.json ./

# Set environment variables
ENV NODE_ENV=production
EXPOSE 3000

# Health check
# HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
#   CMD wget -O - http://localhost:3000/api/status/health || exit 1

# Run the application
CMD ["node", "src/index.js"]
