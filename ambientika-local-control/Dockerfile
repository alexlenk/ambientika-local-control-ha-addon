ARG BUILD_ARCH=amd64

#Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for native modules like sqlite3
RUN apk add --no-cache python3 py3-setuptools make g++ && \
    npm config set cache-max 0

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (cached layer if package.json unchanged)
RUN npm ci --verbose

# Copy source files
COPY src/ ./src/

# Build the application
RUN npm run build

#Production stage - Use Home Assistant base for add-on  
FROM ghcr.io/home-assistant/${BUILD_ARCH}-base:3.18

WORKDIR /app

# Install only runtime dependencies (no build tools needed)
RUN apk add --no-cache nodejs npm

# Copy package files for production install
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --verbose && \
    npm cache clean --force

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

# Set proper permissions
USER root

CMD ["/run.sh"]