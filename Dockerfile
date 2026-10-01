# ── build ────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

# ── runtime: one self-contained bundle + static client ──
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "packages/server/dist/index.js"]
