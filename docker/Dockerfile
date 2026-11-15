# Build context is the repo root: docker build -f docker/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@poketrack/jobs..."
COPY packages packages
RUN pnpm --filter @poketrack/jobs build

FROM node:22-alpine
RUN apk add --no-cache tzdata
ARG GIT_SHA=unknown
ENV TZ=America/Chicago RUNNER=nas NODE_ENV=production GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /repo/packages/jobs/dist/cli.cjs ./cli.cjs
COPY docker/crontab /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
