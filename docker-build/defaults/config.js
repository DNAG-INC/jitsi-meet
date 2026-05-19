/* eslint-disable no-unused-vars, no-var */
/*
 * Rendered to /config/config.js at container start.
 * AAuti WaveBook fork — whiteboard URLs are NOT set here; they flow from
 * the AAuti React app via JitsiMeetExternalAPI.configOverwrite at runtime.
 */

var config = {
    hosts: {
        domain: '${XMPP_DOMAIN}',
        muc: '${XMPP_MUC_DOMAIN}',
        focus: 'focus.${XMPP_DOMAIN}'
    },

    bosh: '//${PUBLIC_HOST}/http-bind',
    websocket: 'wss://${PUBLIC_HOST}/xmpp-websocket',

    enableWelcomePage: ${ENABLE_WELCOME_PAGE_BOOL},
    enableClosePage: ${ENABLE_CLOSE_PAGE_BOOL},
    prejoinConfig: {
        enabled: ${ENABLE_PREJOIN_PAGE_BOOL}
    },

    lobby: {
        autoKnock: false,
        enableChat: true
    },

    // AAuti WaveBook — fork override. URLs/keys arrive via configOverwrite
    // (see AAUTI-WAVEBOOK-INTEGRATION.md). Leave enabled flag wired to env.
    whiteboard: {
        enabled: ${ENABLE_WHITEBOARD_BOOL}
    },

    transcription: {
        enabled: ${ENABLE_TRANSCRIPTIONS_BOOL},
        translationLanguages: ['en', 'es', 'fr', 'de'],
        useAppLanguage: true
    },

    recordingService: {
        enabled: ${ENABLE_FILE_RECORDING_SERVICE_BOOL}
    },
    liveStreaming: {
        enabled: ${ENABLE_LIVESTREAMING_BOOL}
    },

    fileRecordingsEnabled: ${ENABLE_RECORDING_BOOL},
    liveStreamingEnabled: ${ENABLE_LIVESTREAMING_BOOL},

    deploymentInfo: {
        environment: '${PUBLIC_HOST}'
    },

    p2p: {
        enabled: true
    },

    analytics: {}
};
