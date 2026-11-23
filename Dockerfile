FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.1.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY ops/pwa.test.mjs ./ops/pwa.test.mjs
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24.15.0-bookworm-slim
ARG APP_REVISION=development
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.source="https://github.com/lingyunmo/nwaxz"
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server/app.mjs server/index.mjs server/coop-service.mjs server/coop-socket.mjs server/social-service.mjs ./server/
COPY src/escape/world.ts src/escape/basement-map.ts src/escape/perception.ts src/escape/abilities.ts src/escape/interference.ts src/escape/coop-protocol.ts src/escape/coop-snapshot.ts src/escape/hunter-performance.ts src/escape/hunter-search-model.ts src/escape/hunter-policy-weights.ts ./src/escape/
COPY ops/smoke.mjs ./ops/smoke.mjs
RUN node --input-type=module -e "await import('./server/app.mjs')"
RUN mkdir -p /app/data && chown 10001:10001 /app/data
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["node", "ops/smoke.mjs"]
CMD ["node", "server/index.mjs"]
