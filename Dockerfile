FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Bundle app source
COPY . .

# Create data directory for notification logs
RUN mkdir -p /app/data && \
    chmod -R 755 /app/data

# Expose port 
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -O - http://localhost:3000/api/status/health || exit 1

# Run the application
CMD ["node", "src/index.js"]
