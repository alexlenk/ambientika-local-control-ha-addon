ARG BUILD_ARCH=amd64

# Development cache stage - comment this out for final build
FROM node:22-alpine AS dev-cache
WORKDIR /app
RUN apk add --no-cache python3 py3-setuptools make g++
COPY package*.json ./
RUN npm install
# This stage can be reused for faster builds during development

#Build stage
FROM dev-cache AS build
# FROM node:22-alpine AS build  # Uncomment this and comment above line for final build
# WORKDIR /app
# RUN apk add --no-cache python3 py3-setuptools make g++
# COPY package*.json ./
# RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

#Production stage - Use working pattern
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules like sqlite3
RUN apk add --no-cache python3 py3-setuptools make g++ jq bash

COPY package*.json ./

RUN npm ci --only=production

COPY --from=build /app/dist ./dist

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]