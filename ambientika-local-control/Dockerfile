ARG BUILD_ARCH=amd64

#Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for native modules like sqlite3
RUN apk add --no-cache python3 py3-setuptools make g++

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY src/ ./src/

RUN npm run build

#Production stage - Use working pattern
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules like sqlite3
RUN apk add --no-cache python3 py3-setuptools make g++

COPY package*.json ./

RUN npm ci --only=production

COPY --from=build /app/dist ./dist

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]