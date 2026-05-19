# syntax=docker/dockerfile:1.7
#
# AAuti WaveBook Jitsi web — self-contained production image.
# Built entirely from this branch (custom/10741-whiteboard).
# No dependency on jitsi/web:* base image.
#
# Build (run from the repo root, NOT from docker-build/):
#   docker build -f docker-build/Dockerfile -t <acr>.azurecr.io/aauti/jitsi-web:<tag> .
#
# Push:
#   docker push <acr>.azurecr.io/aauti/jitsi-web:<tag>

############################
# Stage 1: build web bundles
############################
ARG NODE_VERSION=24
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION}-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_OPTIONS=--max-old-space-size=8192

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git make python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Install deps first (better layer caching across source edits)
COPY package.json package-lock.json ./
COPY patches ./patches
# legacy-peer-deps required for React 18 vs old peer ranges
# (matches the policy in the repo's .npmrc, which is dockerignored).
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Bring the rest of the source and compile
COPY . .
RUN make compile && make deploy

############################
# Stage 2: nginx runtime
############################
FROM nginx:${NGINX_VERSION} AS runtime

LABEL org.opencontainers.image.title="aauti-jitsi-web" \
      org.opencontainers.image.source="https://github.com/DNAG-INC/jitsi-meet" \
      org.opencontainers.image.description="AAuti WaveBook Jitsi Meet web frontend (custom/10741-whiteboard)"

# Defaults. Override per-environment from the K8s manifest / pipeline.
ENV PUBLIC_URL="https://meet.example.com" \
    HTTP_PORT="80" \
    XMPP_DOMAIN="meet.jitsi" \
    XMPP_AUTH_DOMAIN="auth.meet.jitsi" \
    XMPP_BOSH_URL_BASE="http://prosody:5280" \
    XMPP_GUEST_DOMAIN="guest.meet.jitsi" \
    XMPP_MUC_DOMAIN="muc.meet.jitsi" \
    XMPP_RECORDER_DOMAIN="recorder.meet.jitsi" \
    XMPP_PORT="5222" \
    JVB_WS_URL_BASE="http://jvb:9090" \
    JVB_BREWERY_MUC="jvbbrewery" \
    ENABLE_AUTH="0" \
    ENABLE_GUESTS="1" \
    ENABLE_LOBBY="1" \
    ENABLE_PREJOIN_PAGE="0" \
    ENABLE_WELCOME_PAGE="1" \
    ENABLE_CLOSE_PAGE="0" \
    ENABLE_TRANSCRIPTIONS="0" \
    ENABLE_RECORDING="0" \
    ENABLE_FILE_RECORDING_SERVICE="0" \
    ENABLE_LIVESTREAMING="0" \
    ENABLE_WHITEBOARD="1" \
    APP_NAME="AAuti Meet" \
    TZ="UTC"

# gettext = envsubst, tini = clean PID-1 signal handling
RUN apk add --no-cache gettext tini bash tzdata \
 && rm -f /etc/nginx/conf.d/default.conf

# Web assets from the builder
COPY --from=builder /src/libs                /usr/share/jitsi-meet/libs
COPY --from=builder /src/static              /usr/share/jitsi-meet/static
COPY --from=builder /src/sounds              /usr/share/jitsi-meet/sounds
COPY --from=builder /src/fonts               /usr/share/jitsi-meet/fonts
COPY --from=builder /src/images              /usr/share/jitsi-meet/images
COPY --from=builder /src/lang                /usr/share/jitsi-meet/lang
COPY --from=builder /src/css/all.css         /usr/share/jitsi-meet/css/all.css
COPY --from=builder /src/*.html              /usr/share/jitsi-meet/
COPY --from=builder /src/pwa-worker.js       /usr/share/jitsi-meet/
COPY --from=builder /src/manifest.json       /usr/share/jitsi-meet/
COPY --from=builder /src/interface_config.js /usr/share/jitsi-meet/
COPY --from=builder /src/resources/robots.txt /usr/share/jitsi-meet/

# Overlay templates, init scripts, and entrypoint from docker-build/
COPY docker-build/defaults                   /defaults
COPY docker-build/etc                        /etc
COPY docker-build/docker-entrypoint-jitsi.sh /docker-entrypoint-jitsi.sh

RUN chmod +x /docker-entrypoint-jitsi.sh /etc/cont-init.d/*

EXPOSE 80
WORKDIR /usr/share/jitsi-meet

ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint-jitsi.sh"]
CMD ["nginx", "-g", "daemon off;"]
