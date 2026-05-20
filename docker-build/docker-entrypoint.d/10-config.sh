#!/usr/bin/env bash
# Render /defaults templates -> real config locations using env vars.
# Picked up automatically by nginx:alpine's /docker-entrypoint.sh.
set -eu

CONFIG_DIR=/config
DEFAULTS_DIR=/defaults
NGINX_CONF_D=/etc/nginx/conf.d

mkdir -p "${CONFIG_DIR}" "${NGINX_CONF_D}"

export PUBLIC_HOST="$(echo "${PUBLIC_URL}" | sed -E 's#^https?://##; s#/.*$##')"
export APP_NAME="${APP_NAME:-AAuti Meet}"

DNS_RESOLVER="$(awk '/^nameserver / {print $2; exit}' /etc/resolv.conf 2>/dev/null || true)"
export DNS_RESOLVER="${DNS_RESOLVER:-127.0.0.11}"

_bool() { case "${1:-0}" in 1|true|TRUE|yes|YES) echo true ;; *) echo false ;; esac; }
export ENABLE_WELCOME_PAGE_BOOL="$(_bool "${ENABLE_WELCOME_PAGE}")"
export ENABLE_CLOSE_PAGE_BOOL="$(_bool "${ENABLE_CLOSE_PAGE}")"
export ENABLE_PREJOIN_PAGE_BOOL="$(_bool "${ENABLE_PREJOIN_PAGE}")"
export ENABLE_TRANSCRIPTIONS_BOOL="$(_bool "${ENABLE_TRANSCRIPTIONS}")"
export ENABLE_RECORDING_BOOL="$(_bool "${ENABLE_RECORDING}")"
export ENABLE_FILE_RECORDING_SERVICE_BOOL="$(_bool "${ENABLE_FILE_RECORDING_SERVICE}")"
export ENABLE_LIVESTREAMING_BOOL="$(_bool "${ENABLE_LIVESTREAMING}")"
export ENABLE_WHITEBOARD_BOOL="$(_bool "${ENABLE_WHITEBOARD}")"

export DOLLAR='$'

TEMPLATE_VARS='${PUBLIC_URL} ${PUBLIC_HOST} ${APP_NAME} ${HTTP_PORT} ${DOLLAR}
${DNS_RESOLVER}
${XMPP_DOMAIN} ${XMPP_AUTH_DOMAIN} ${XMPP_GUEST_DOMAIN} ${XMPP_MUC_DOMAIN}
${XMPP_RECORDER_DOMAIN} ${XMPP_BOSH_URL_BASE} ${XMPP_PORT}
${JVB_BREWERY_MUC} ${JVB_WS_URL_BASE}
${ENABLE_WELCOME_PAGE_BOOL} ${ENABLE_CLOSE_PAGE_BOOL} ${ENABLE_PREJOIN_PAGE_BOOL}
${ENABLE_TRANSCRIPTIONS_BOOL} ${ENABLE_RECORDING_BOOL}
${ENABLE_FILE_RECORDING_SERVICE_BOOL} ${ENABLE_LIVESTREAMING_BOOL}
${ENABLE_WHITEBOARD_BOOL}'

render() {
    local src="$1"
    local dest="$2"
    if [[ -f "${dest}" && "${OVERWRITE_CONFIG:-1}" != "1" ]]; then
        echo "[10-config] keeping existing ${dest}"
        return
    fi
    echo "[10-config] rendering ${src} -> ${dest}"
    envsubst "${TEMPLATE_VARS}" < "${src}" > "${dest}"
}

render "${DEFAULTS_DIR}/settings.conf"         /etc/nginx/nginx.conf
render "${DEFAULTS_DIR}/meet.conf"             "${NGINX_CONF_D}/default.conf"
render "${DEFAULTS_DIR}/config.js"             "${CONFIG_DIR}/config.js"
render "${DEFAULTS_DIR}/interface_config.js"   "${CONFIG_DIR}/interface_config.js"

nginx -t
