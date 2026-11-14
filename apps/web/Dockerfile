# syntax=docker/dockerfile:1
#
# The production image of the web app: dashboard, landing page and API in one Next.js server.
# Build from the repository root, for the architecture the ECS task runs on:
#
#   docker build --platform linux/amd64 -f apps/web/Dockerfile -t triagecam-web .
#
# The same image runs the database migrations (docs/DEPLOY.md):
#
#   docker run ... triagecam-web node src/db/migrate.mts
#
# which is why it carries the source and the production node_modules rather than Next's
# standalone output: the migration script needs src/db/migrations, drizzle-orm and pg.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

# Everything, development dependencies included, to build with.
FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@triagecam/web..."
COPY packages/contracts packages/contracts
# src/styles/tokens.css takes its fonts from here.
COPY design-system/fonts design-system/fonts
COPY apps/web apps/web
# The build loads every route module, and the database module refuses to load without a
# well-formed DATABASE_URL. Nothing connects to it, and it is not kept in the image.
RUN DATABASE_URL=postgres://build@localhost:5432/build pnpm --filter @triagecam/web build \
    && rm -rf apps/web/.next/cache

# The two face-match models (git-ignored in the repository), checked against their SHA-256.
FROM base AS models
COPY apps/web/scripts/fetch-face-models.mjs apps/web/scripts/
RUN FACE_MODELS_DIR=/app/models node apps/web/scripts/fetch-face-models.mjs

FROM base AS runtime
ENV NODE_ENV=production
# bcrypt, sharp and onnxruntime-node install their linux binaries for the image's architecture here.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter "@triagecam/web..."
# Amazon RDS certificates are signed by Amazon's own authority, which Node does not know.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem
COPY packages/contracts packages/contracts
COPY apps/web apps/web
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next
COPY --from=models /app/models /app/models

ENV FACE_MODELS_DIR=/app/models \
    NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem \
    HOSTNAME=0.0.0.0 \
    PORT=3000
EXPOSE 3000
USER node
WORKDIR /app/apps/web
ENTRYPOINT ["/app/apps/web/scripts/container-entrypoint.sh"]
# node itself, not pnpm, so the stop signal reaches Next.js and it can finish open requests.
CMD ["node", "/app/node_modules/next/dist/bin/next", "start"]
