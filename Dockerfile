# syntax=docker/dockerfile:1.6
# Hermes Switch UI — self-contained production image
#
# This image contains both:
#   - upstream Hermes Agent (from nousresearch/hermes-agent)
#   - Hermes Switch UI (built from this repository)
#
# Build locally:
#   docker build -t hermes-switchui .
# Run locally:
#   docker run -p 3000:3000 \
#     -e HERMES_PASSWORD=change-me \
#     -v hermes-data:/opt/data \
#     hermes-switchui
#
# The Hermes Agent gateway is started inside the same container and Switch UI
# talks to it over http://127.0.0.1:8642 by default.

# ─── Switch UI build stage ────────────────────────────────────────────────
FROM node:22-slim AS switchui-build
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps (cache-friendly: copy only manifests first)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY . .
RUN pnpm build

# ─── Runtime: Hermes Agent + Switch UI under s6-overlay ───────────────────
FROM nousresearch/hermes-agent:latest

WORKDIR /opt/switchui

# Copy Switch UI build artefacts + runtime deps into the upstream Hermes Agent
# image. The base image already provides Node 22, Python, uv, curl, /opt/data,
# the hermes CLI, and s6-overlay supervision.
COPY --from=switchui-build --chown=hermes:hermes /app/dist ./dist
COPY --from=switchui-build --chown=hermes:hermes /app/node_modules ./node_modules
COPY --from=switchui-build --chown=hermes:hermes /app/package.json ./package.json
COPY --from=switchui-build --chown=hermes:hermes /app/server-entry.js ./server-entry.js
COPY --from=switchui-build --chown=hermes:hermes /app/skills ./skills

# Add all-in-one services to the agent image's existing s6 user bundle:
#   hermes-gateway  -> `hermes gateway run`
#   hermes-switchui -> `node server-entry.js`
COPY docker/all-in-one/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY --chmod=0755 docker/all-in-one/cont-init.d/ /etc/cont-init.d/

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    HERMES_HOME=/opt/data \
    HERMES_API_URL=http://127.0.0.1:8642 \
    API_SERVER_ENABLED=true \
    API_SERVER_HOST=127.0.0.1

VOLUME ["/opt/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1

# Keep the base image's /init + main-wrapper ENTRYPOINT so the agent's
# volume bootstrap, UID/GID remapping, and service supervision still run.
# The main program sleeps forever; the real workloads are s6 services.
CMD ["sleep", "infinity"]
