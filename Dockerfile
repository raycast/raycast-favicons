# syntax=docker/dockerfile:1
#
# raycast-favicons container image for AWS ECS Express (raycast-infra,
# services/favicons-service.ts). Heroku (heroku/nodejs buildpack + pm2) keeps running
# until the api.ray.so CloudFront origin is flipped; this image replaces both.
#
#   - npm ci runs with --ignore-scripts: `preinstall` installs pm2 globally and
#     `postinstall` bundles, neither of which belongs in an image build. The bundle is
#     built explicitly below (same esbuild config as Heroku's postinstall).
#   - The bundle keeps packages external, so production dependencies ship alongside it.
#   - No pm2: ECS restarts the task if the process exits, and the ALB health check
#     (/up) replaces pm2's supervision. One Node process per task.

ARG NODE_VERSION=22.22.2

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node esbuild.config.js \
  && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:${NODE_VERSION}-slim
WORKDIR /app
# UV_THREADPOOL_SIZE: every favicon lookup resolves a new, often slow or dead, hostname
# via dns.lookup, which runs on libuv's thread pool (4 threads by default). With 4
# threads, slow lookups queue up and delay healthy ones (median ~3.6s on ECS vs ~0.7s on
# Heroku's 4 dynos x 4 threads).
ENV NODE_ENV=production \
  PORT=3000 \
  UV_THREADPOOL_SIZE=64
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/bundle.js"]
