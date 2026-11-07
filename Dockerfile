# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable
# Der pnpm-Store ist inhaltsadressiert (Hash je Datei) und --frozen-lockfile pinnt die Versionen:
# der Cache-Mount kann daher keine veralteten Inhalte liefern, er spart nur Downloads.
ENV PNPM_STORE_DIR=/pnpm/store
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS build
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run postinstall && pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY scripts/zitadel-init.mjs ./scripts/zitadel-init.mjs
COPY branding ./branding
COPY LICENSE ./LICENSE
EXPOSE 3000
CMD ["node", "--import", "./dist/lib/otel.js", "dist/entrypoint.js"]
