ARG BUILD_ARCH=amd64

# Build stage: install deps, build TS, prune devDeps.
# No native build toolchain needed — device storage uses node:sqlite (built into Node),
# not the sqlite3 npm package, so there's nothing left to compile. See #47.
FROM node:25-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --loglevel=error
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# Production stage: copy pre-compiled artifacts
FROM node:25-alpine AS production
WORKDIR /app
RUN apk add --no-cache jq bash
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY run.sh /
RUN chmod a+x /run.sh
CMD ["/run.sh"]
