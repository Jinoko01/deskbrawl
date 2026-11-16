FROM node:22.20.0-bookworm AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/server ./apps/server
COPY packages/game-core ./packages/game-core
COPY packages/protocol ./packages/protocol

RUN pnpm install --frozen-lockfile --filter @deskbrawl/server...
RUN pnpm --filter @deskbrawl/server build
# pixi.js 패치는 데스크톱 전용이라 서버 deploy에는 대상이 없다. 이 단계에서만 미사용 패치를 허용한다.
RUN pnpm --filter @deskbrawl/server deploy --prod --legacy /release --config.allow-unused-patches=true

FROM node:22.20.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /release/node_modules ./node_modules
COPY --from=build --chown=node:node /release/dist/main.mjs ./dist/main.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "--input-type=module", "-e", "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/health'); if (!response.ok) process.exit(1);"]
CMD ["node", "dist/main.mjs"]
