FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run postinstall && pnpm build

FROM node:24-alpine AS runtime
RUN apk add --no-cache postgresql-client
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY scripts/zitadel-init.mjs ./scripts/zitadel-init.mjs
COPY scripts/fonts ./scripts/fonts
EXPOSE 3000
CMD ["node", "dist/entrypoint.js"]
