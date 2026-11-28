FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install --global pnpm@10.32.1
WORKDIR /app

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @workspace/api --docker

FROM base AS build
ENV HUSKY=0
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm exec turbo build --filter=@workspace/api
RUN pnpm --filter @workspace/api deploy --legacy --prod /runtime

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ .
RUN mkdir -p /app/data/knowledge && chown -R node:node /app/data
USER node
# api: 3000, internal: 3100 (worker has no port).
EXPOSE 3000 3100
CMD ["node", "dist/main.js"]
