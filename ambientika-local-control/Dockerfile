ARG BUILD_ARCH=amd64

#Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for native modules (sqlite3 only)
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    linux-headers

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies with fallback for sqlite3
RUN npm ci --build-from-source || \
    (npm install --verbose && npm rebuild sqlite3)

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

#Production stage - Use Home Assistant base for add-on  
FROM ghcr.io/home-assistant/${BUILD_ARCH}-base:3.18

WORKDIR /app

# Install Node.js runtime
RUN apk add --no-cache nodejs npm

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Copy and set up run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]