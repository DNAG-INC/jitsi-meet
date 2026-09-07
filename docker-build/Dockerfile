# syntax=docker/dockerfile:1.7
#
# AAuti WaveBook Jitsi web - drop-in replacement for ghcr.io/jitsi/web:stable-11146-2
# with the custom whiteboard module compiled in from this fork.
#
# Layout mirrors upstream jitsi/docker-jitsi-meet/web/. Stage 1 builds the
# web bundle from this branch's source; Stage 2 is upstream's jitsi/base
# image with our bundle dropped in where the apt-installed jitsi-meet-web
# package would have placed it.
#
# Build (run from the repo root, NOT from docker-build/):
#   docker build -f docker-build/Dockerfile -t <acr>.azurecr.io/aauti/jitsi-web:<tag> .

############################
# Stage 1: build web bundles from the fork
############################
# Global ARGs - declared before any FROM so they are usable in every FROM line.
ARG NODE_VERSION=24
ARG JITSI_REPO=ghcr.io/jitsi
# Match the stable jitsi-meet release this fork is built on (custom/11146-whiteboard).
ARG BASE_TAG=stable-11146-2

FROM node:${NODE_VERSION}-bookworm-slim AS builder

# Build-time secret: the AAuti Azure Artifacts feed PAT (Packaging: Read).
# Passed by the pipeline via `docker build --build-arg AZURE_DEVOPS_PAT_TOKEN=$(secret) ...`.
# Required so `npm ci` can resolve @aauti/whiteboard-sdk from the private
# feed at pkgs.dev.azure.com/aauti/_packaging/aauti/npm/registry.
#
# Why not just copy the repo's .npmrc? It's listed in .dockerignore — keeps
# the token out of every Docker build context regardless of which Dockerfile
# is consuming it. We synthesise .npmrc here from the ARG, run install, then
# rm it. The token only exists inside this one RUN layer; the runtime stage
# starts FROM jitsi/base and COPY's only specific build outputs (no .npmrc).
ARG AZURE_DEVOPS_PAT_TOKEN

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_OPTIONS=--max-old-space-size=8192

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git make python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Install deps first for better layer caching across source edits.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN printf '%s\n%s\n%s\n' \
      'package-lock=true' \
      'legacy-peer-deps=true' \
      '@aauti:registry=https://pkgs.dev.azure.com/aauti/_packaging/aauti/npm/registry/' \
      > .npmrc \
 && printf '//pkgs.dev.azure.com/aauti/_packaging/aauti/npm/registry/:_authToken=%s\n' \
      "$AZURE_DEVOPS_PAT_TOKEN" >> .npmrc \
 && npm ci --no-audit --no-fund --legacy-peer-deps \
 && rm -f .npmrc

COPY . .
RUN make compile && make deploy

############################
# Stage 2: jitsi/base runtime (s6-overlay + nginx-extras)
############################
FROM ${JITSI_REPO}/base:${BASE_TAG}

# stable-11146-2 sets a non-root default user (Config.User=s6, uid 1000),
# unlike stable-10741 (root). Every RUN/COPY below needs root (apt-get,
# writing under /usr/share, /etc, /var/lib) exactly as it did on 10741.
USER root

LABEL org.opencontainers.image.title="aauti-jitsi-web" \
      org.opencontainers.image.description="AAuti WaveBook Jitsi Meet web frontend (custom/11146-whiteboard) - drop-in replacement for ghcr.io/jitsi/web:stable-11146-2" \
      org.opencontainers.image.source="https://github.com/DNAG-INC/jitsi-meet"

# acme.sh for Let's Encrypt support (same path as upstream)
ADD https://raw.githubusercontent.com/acmesh-official/acme.sh/3.0.7/acme.sh /opt

# Upstream rootfs overlay: /defaults templates + /etc/cont-init.d + /etc/services.d
COPY docker-build/rootfs/ /

# Same package set as upstream jitsi/web, MINUS jitsi-meet-web (we ship our own).
# ghcr.io/jitsi/base:stable-11146-2 ships apt 3.0.3, which (unlike the 2.6.1 on
# stable-10741) refuses to auto-create /var/lib/apt/lists/partial and hard-fails
# "List directory ... is missing" on the first apt-get update. Recreate it first.
RUN mkdir -p /var/lib/apt/lists/partial \
 && apt-dpkg-wrap apt-get update \
 && apt-dpkg-wrap apt-get install -y dnsutils cron nginx-extras socat curl jq \
 && rm -f /etc/nginx/conf.d/default.conf \
 && apt-cleanup

# Drop the fork's compiled bundle into the same paths the apt package
# would have populated. /usr/share/jitsi-meet is created by jitsi/base.
COPY --from=builder /src/libs                  /usr/share/jitsi-meet/libs
COPY --from=builder /src/static                /usr/share/jitsi-meet/static
COPY --from=builder /src/sounds                /usr/share/jitsi-meet/sounds
COPY --from=builder /src/fonts                 /usr/share/jitsi-meet/fonts
COPY --from=builder /src/images                /usr/share/jitsi-meet/images
COPY --from=builder /src/lang                  /usr/share/jitsi-meet/lang
COPY --from=builder /src/css/all.css           /usr/share/jitsi-meet/css/all.css
COPY --from=builder /src/*.html                /usr/share/jitsi-meet/
COPY --from=builder /src/pwa-worker.js         /usr/share/jitsi-meet/
COPY --from=builder /src/manifest.json         /usr/share/jitsi-meet/
COPY --from=builder /src/interface_config.js   /usr/share/jitsi-meet/
COPY --from=builder /src/resources/robots.txt  /usr/share/jitsi-meet/

# Same dance as upstream: interface_config.js lives in /defaults so the
# cont-init `tpl` step can env-substitute and copy it into /config.
RUN mv /usr/share/jitsi-meet/interface_config.js /defaults/

# Strip any CRLF line endings (Windows git checkouts can introduce them) and
# normalise file permissions. In s6-overlay v2:
#   - cont-init.d scripts must NOT be executable (s6 reads them and pipes to
#     a shell). With +x the kernel-exec path goes through with-contenv ->
#     s6-exec which fails the PATH lookup of 'bash'.
#   - services.d/*/run scripts MUST be executable so s6 can supervise them.
# We force-set perms here because the Windows checkout doesn't preserve them
# reliably across git clone / cp.
RUN find /defaults /etc/cont-init.d /etc/services.d -type f -exec sed -i 's/\r$//' {} + \
 && chmod 644 /etc/cont-init.d/10-config \
 && chmod 755 /etc/services.d/nginx/run \
              /etc/services.d/cron/run \
              /etc/services.d/jaas-account/run

EXPOSE 80 443

VOLUME ["/config", "/usr/share/jitsi-meet/transcripts"]
