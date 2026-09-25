# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Separate install from the deps stage (npm ci --omit=dev, not a prune of the
# build's node_modules) keeps this layer free of anything from node_modules
# that isn't a runtime dep, with no leftover layer bloat from copy-then-prune.
# The cache mount is what makes this cheap: it reuses npm's package cache
# from the deps stage instead of re-downloading everything from the registry.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
