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

# Build-Artefakte (dist, public) sind plattformunabhängig: auf der Build-Plattform laufen lassen, damit
# bei Multi-Arch kein QEMU-Emulation nötig ist. Nur deps (Prod-node_modules) braucht die Zielplattform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
ENV PNPM_STORE_DIR=/pnpm/store
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
# Kopier-Skripte brauchen nur node_modules; vor COPY . . bleibt der Layer bei Code-Änderungen gecacht.
# (build-browser-sentry braucht src/ und läuft in `pnpm build`.)
COPY scripts ./scripts
RUN for s in fonts htmx calendar trix leaflet cap; do node scripts/copy-$s.mjs; done
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY scripts/zitadel-init.mjs ./scripts/zitadel-init.mjs
COPY scripts/openobserve-init.mjs ./scripts/openobserve-init.mjs
COPY docs/observability/dashboard.json ./docs/observability/dashboard.json
COPY branding ./branding
COPY LICENSE ./LICENSE
EXPOSE 3000
CMD ["node", "--import", "./dist/lib/otel.js", "dist/entrypoint.js"]
