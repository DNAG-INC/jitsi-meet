# AAuti WaveBook Jitsi web — production image.
#
# Multi-stage build:
#   1. builder  : compiles the modified web bundle via `make`
#   2. runtime  : official jitsi/web base + our compiled assets
#
# Build:
#   docker build -t dnag/jitsi-web:<tag> .
#
# Push (after tagging for your registry):
#   docker tag dnag/jitsi-web:<tag> registry.example.com/dnag/jitsi-web:<tag>
#   docker push registry.example.com/dnag/jitsi-web:<tag>
#
# Deploy: in your docker-jitsi-meet's docker-compose.yml, set
#   services.web.image: dnag/jitsi-web:<tag>
# then: docker compose up -d web
#
# NOTES:
#   * --memory=6g recommended on the build host (TerserPlugin is memory-hungry):
#       docker build --memory=6g -t dnag/jitsi-web:<tag> .
#   * The runtime base tag (stable-10741 below) MUST match the source tag this
#     fork targets — keep them in sync when rebasing onto a newer DNAG branch.

# -----------------------------------------------------------------------------
# Stage 1: build the modified jitsi-meet web bundle
# -----------------------------------------------------------------------------
FROM node:24-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        make \
        python3 \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so layer caching survives source edits
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci --no-audit --no-fund

# Bring the rest of the source and compile
COPY . .
RUN make

# -----------------------------------------------------------------------------
# Stage 2: runtime image — official jitsi/web with our assets layered on top
# -----------------------------------------------------------------------------
FROM jitsi/web:stable-10741

# Replace upstream web bundle with our AAuti WaveBook fork
COPY --from=builder /app/libs       /usr/share/jitsi-meet/libs/
COPY --from=builder /app/css        /usr/share/jitsi-meet/css/
COPY --from=builder /app/static     /usr/share/jitsi-meet/static/
COPY --from=builder /app/index.html /usr/share/jitsi-meet/index.html

# Everything else (nginx config, confd templates that generate config.js from
# env vars, prosody/jicofo upstream proxying) is inherited from jitsi/web.
#
# Required env at runtime (set in compose / k8s manifest, NOT here):
#   PUBLIC_URL           = https://<your jitsi domain>
#   ENABLE_WHITEBOARD    = 1
#   (no WaveBook URLs needed on the server — they flow from AAuti React
#    per-environment via configOverwrite, see AAUTI-WAVEBOOK-INTEGRATION.md)