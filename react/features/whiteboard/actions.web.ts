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
 * Sets the WaveBook board the local participant should join.
 *
 * For moderators: also broadcasts the selection via conference metadata so
 * every other participant snaps to the same board, and seeds the board's
 * users[] with the canonical session roster so every enrolled user (even
 * those not yet in the Jitsi call) passes the WaveBook embed gate.
 *
 * For non-moderators: only updates local state. They can pick a different
 * board from the picker for their own view without affecting anyone else.
 * If the moderator later picks another board, the [boardId] effect in
 * Whiteboard.tsx snaps the non-moderator back to the moderator's choice.
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

        // Moderator-only: broadcast the choice + sync roster. Non-moderators
        // just update their local view. _buildSyncParams returns null for
        // non-moderators so the roster sync is implicitly skipped, but we
        // need an explicit moderator check here to gate the broadcast.
        const syncParams = _buildSyncParams(state);

        if (!syncParams) {
            return;
        }
        conference?.getMetadataHandler().setMetadata(WHITEBOARD_ID, collabData);
        syncSessionRosterToBoard(boardId, syncParams.rosterParams, syncParams.waveBookParams)
            .catch(err => logger.warn('selectWhiteboardBoard: roster sync failed', err));
    };
}

// Leading-edge debounce window for PARTICIPANT_JOINED-triggered syncs.
// First join in a quiet period fires the PUT immediately to minimize the
// race against the joiner's iframe loading. Subsequent joins within the
// window are coalesced into a single trailing-edge call so a join storm
// (e.g. 30 students refresh at once) still collapses to one fetch+PUT.
const SYNC_DEBOUNCE_MS = 800;
let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSyncAt = 0;

function _runSync(getState: IStore['getState']) {
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
    _lastSyncAt = Date.now();
    syncSessionRosterToBoard(boardId, syncParams.rosterParams, syncParams.waveBookParams)
        .catch(err => logger.warn('syncWhiteboardRoster: failed', err));
}

/**
 * Schedules a sync of the AAuti session roster into the currently open
 * WaveBook board. Leading-edge debounced — fires immediately if it's been
 * quiet for SYNC_DEBOUNCE_MS, otherwise schedules a trailing-edge call.
 *
 * Called by middleware on PARTICIPANT_JOINED and PARTICIPANT_ROLE_CHANGED
 * so that any user joining after the board was opened (including users who
 * purchased the class mid-session) is added to the board's users[] before
 * they hit the embed gate. The leading-edge dispatch minimizes the race
 * window against the joiner's iframe loading (the iframe makes a strict
 * member-check call on first load and shows "User not found" on miss).
 *
 * No-ops when no board is open, when the local participant isn't a
 * moderator, or when WaveBook/AAuti configuration is missing. Safe to
 * dispatch freely.
 *
 * @returns {Function}
 */
export function syncWhiteboardRoster() {
    return (_dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const now = Date.now();

        // Leading edge: fire immediately if the last sync was long enough ago.
        if (now - _lastSyncAt >= SYNC_DEBOUNCE_MS) {
            if (_syncDebounceTimer) {
                clearTimeout(_syncDebounceTimer);
                _syncDebounceTimer = null;
            }
            _runSync(getState);

            return;
        }

        // Trailing edge: coalesce rapid follow-up joins.
        if (_syncDebounceTimer) {
            clearTimeout(_syncDebounceTimer);
        }
        _syncDebounceTimer = setTimeout(() => {
            _syncDebounceTimer = null;
            _runSync(getState);
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
