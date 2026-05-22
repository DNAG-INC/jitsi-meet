import { createRestrictWhiteboardEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';
import { getLocalParticipant, isLocalParticipantModerator } from '../base/participants/functions';

import { resetWhiteboard, setWhiteboardOpen, setupWhiteboard } from './actions.any';
import { WHITEBOARD_ID } from './constants';
import { generateCollabServerUrl, getWaveBookJwtContext, isWhiteboardAllowed, isWhiteboardOpen, isWhiteboardVisible } from './functions';
import logger from './logger';
import { syncSessionRosterToBoard } from './services';
import { WhiteboardStatus } from './types';

export * from './actions.any';

/**
 * Build the params needed to call the AAuti backend + WaveBook from the
 * moderator's browser. Returns null if any required piece is missing — the
 * roster sync is best-effort and silently no-ops when configuration isn't
 * available (e.g. a deployment where the AAuti backend URL hasn't been wired
 * through configOverwrite yet).
 */
function _buildSyncParams(state: ReturnType<IStore['getState']>) {
    if (!isLocalParticipantModerator(state)) {
        return null;
    }
    const config = state['features/base/config'].whiteboard;

    if (!config?.apiUrl || !config?.apiKey || !config?.aautiApiUrl) {
        return null;
    }
    const jwtCtx = getWaveBookJwtContext(state);
    const localParticipant = getLocalParticipant(state);
    const requesterUserId = jwtCtx?.userId || localParticipant?.jwtId || localParticipant?.id || '';

    if (!requesterUserId) {
        return null;
    }
    const sessionId = jwtCtx?.sessionId;

    if (!sessionId) {
        return null;
    }
    const requesterUserName = jwtCtx?.userName || localParticipant?.name || 'User';

    return {
        rosterParams: {
            aautiApiUrl: config.aautiApiUrl,
            sessionId,
            requesterUserId
        },
        waveBookParams: {
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
            requesterUserId,
            requesterUserName
        }
    };
}

/**
 * API to toggle the whiteboard.
 *
 * @returns {Function}
 */
export function toggleWhiteboard() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isAllowed = isWhiteboardAllowed(state);
        const isOpen = isWhiteboardOpen(state);

        if (isAllowed) {
            if (isOpen && !isWhiteboardVisible(state)) {
                dispatch(setWhiteboardOpen(true));
            } else if (isOpen && isWhiteboardVisible(state)) {
                dispatch(setWhiteboardOpen(false));
            } else if (!isOpen) {
                dispatch(setWhiteboardOpen(true));
            }
        } else if (typeof APP !== 'undefined') {
            APP.API.notifyWhiteboardStatusChanged(WhiteboardStatus.FORBIDDEN);
        }
    };
}

/**
 * Sets the WaveBook board the participants should join, broadcasts it via
 * the conference metadata so other participants pick it up automatically,
 * and seeds the board's users[] with the canonical session roster so every
 * enrolled user — including those not yet in the Jitsi call — passes the
 * WaveBook embed gate.
 *
 * @param {string} boardId - The WaveBook board id to use as the conference whiteboard.
 * @returns {Function}
 */
export function selectWhiteboardBoard(boardId: string) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const conference = getCurrentConference(state);
        const collabServerUrl = generateCollabServerUrl(state) || '';
        const collabData = {
            collabDetails: { roomId: boardId, roomKey: '' },
            collabServerUrl
        };

        dispatch(setupWhiteboard(collabData));
        conference?.getMetadataHandler().setMetadata(WHITEBOARD_ID, collabData);

        const syncParams = _buildSyncParams(state);

        if (!syncParams) {
            return;
        }
        syncSessionRosterToBoard(boardId, syncParams.rosterParams, syncParams.waveBookParams)
            .catch(err => logger.warn('selectWhiteboardBoard: roster sync failed', err));
    };
}

// Debounce window for PARTICIPANT_JOINED-triggered syncs. Collapses a join
// storm (e.g. 30 students refresh the same page) into one fetch+PUT cycle.
const SYNC_DEBOUNCE_MS = 800;
let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedules a debounced sync of the AAuti session roster into the currently
 * open WaveBook board. Called by middleware on PARTICIPANT_JOINED and
 * PARTICIPANT_ROLE_CHANGED so that any user joining after the board was
 * opened (including users who purchased the class mid-session) is added to
 * the board's users[] before they hit the embed gate.
 *
 * No-ops when no board is open, when the local participant isn't a moderator,
 * or when WaveBook/AAuti configuration is missing. Safe to call freely.
 *
 * @returns {Function}
 */
export function syncWhiteboardRoster() {
    return (_dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        if (_syncDebounceTimer) {
            clearTimeout(_syncDebounceTimer);
        }
        _syncDebounceTimer = setTimeout(() => {
            _syncDebounceTimer = null;
            const state = getState();
            const collabDetails = state['features/whiteboard']?.collabDetails;
            const boardId = collabDetails?.roomId;

            if (!boardId) {
                return;
            }
            const syncParams = _buildSyncParams(state);

            if (!syncParams) {
                return;
            }
            syncSessionRosterToBoard(boardId, syncParams.rosterParams, syncParams.waveBookParams)
                .catch(err => logger.warn('syncWhiteboardRoster: failed', err));
        }, SYNC_DEBOUNCE_MS);
    };
}

/**
 * Restricts the whiteboard usage.
 *
 * @param {boolean} shouldCloseWhiteboard - Whether to dismiss the whiteboard.
 * @returns {Function}
 */
export const restrictWhiteboard = (shouldCloseWhiteboard = true) => (dispatch: IStore['dispatch']) => {
    if (shouldCloseWhiteboard) {
        dispatch(setWhiteboardOpen(false));
    }
    dispatch(resetWhiteboard());
    sendAnalytics(createRestrictWhiteboardEvent());
};
