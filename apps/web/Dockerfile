FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install --global pnpm@10.32.1
WORKDIR /app

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @workspace/web --docker

FROM base AS build
ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm exec turbo build --filter=@workspace/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /app/apps/web/.next/static/ ./apps/web/.next/static/
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
