ARG BUILD_ARCH=amd64

# Build stage: install all deps (compiles native modules once), build TS, prune devDeps
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 py3-setuptools make g++
COPY package*.json ./
RUN npm install --loglevel=error
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# Prune devDependencies in-place — compiled native binaries (e.g. sqlite3) stay
RUN npm prune --omit=dev

# Production stage: copy pre-compiled artifacts, no native recompilation needed
FROM node:24-alpine AS production
WORKDIR /app
# No build tools required — sqlite3 is already compiled in the build stage
RUN apk add --no-cache jq bash
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY run.sh /
RUN chmod a+x /run.sh
CMD ["/run.sh"]
