ARG BUILD_ARCH=amd64

#Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for native modules (sqlite3, node-ble)
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    linux-headers \
    libc-dev \
    pkgconfig \
    dbus-dev \
    glib-dev \
    eudev-dev

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies with verbose logging
RUN npm ci --verbose

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

#Production stage - Use Home Assistant base for add-on  
FROM ghcr.io/home-assistant/${BUILD_ARCH}-base:3.18

WORKDIR /app

# Install Node.js runtime and BLE dependencies
RUN apk add --no-cache \
    nodejs \
    npm \
    dbus \
    bluez \
    glib

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Copy and set up run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]