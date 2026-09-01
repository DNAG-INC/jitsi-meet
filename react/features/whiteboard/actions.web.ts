import { createRestrictWhiteboardEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';
import { isLocalParticipantModerator } from '../base/participants/functions';

import { resetWhiteboard, setWhiteboardOpen, setupWhiteboard } from './actions.any';
import { WHITEBOARD_ID } from './constants';
import {
    generateCollabServerUrl,
    getCollabDetails,
    isWhiteboardAllowed,
    isWhiteboardOpen,
    isWhiteboardVisible
} from './functions';
import { WhiteboardStatus } from './types';

export * from './actions.any';

/**
 * API to toggle the whiteboard.
 *
 * @param {boolean} [open] - If provided, explicitly sets the whiteboard open state
 * instead of toggling based on visibility.
 * @returns {Function}
 */
export function toggleWhiteboard(open?: boolean) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isAllowed = isWhiteboardAllowed(state);
        const isOpen = isWhiteboardOpen(state);

        if (isAllowed) {
            if (typeof open === 'boolean') {
                if (open !== isOpen) {
                    dispatch(setWhiteboardOpen(open, true));
                }
            } else if (isOpen && !isWhiteboardVisible(state)) {
                dispatch(setWhiteboardOpen(true, true));
            } else if (isOpen && isWhiteboardVisible(state)) {
                dispatch(setWhiteboardOpen(false, true));
            } else if (!isOpen) {
                dispatch(setWhiteboardOpen(true, true));
            }
        } else if (isOpen || getCollabDetails(state)) {
            const shouldShow = open ?? !isOpen;

            if (shouldShow !== isOpen) {
                dispatch(setWhiteboardOpen(shouldShow));
            }
        } else if (typeof APP !== 'undefined') {
            APP.API.notifyWhiteboardStatusChanged(WhiteboardStatus.FORBIDDEN);
        }
    };
}

/**
 * Sets the WaveBook board the local participant should join.
 *
 * Moderator: also broadcasts the choice via conference metadata so every
 * other participant snaps to the same board.
 *
 * Non-moderator: only updates local state. They can pick a different board
 * from the picker for their own view without affecting anyone else. If the
 * moderator later picks another board, the [boardId] effect in
 * Whiteboard.tsx snaps the non-moderator back to that board.
 *
 * @param {string} boardId - The WaveBook board id to use as the conference whiteboard.
 * @returns {Function}
 */
export function selectWhiteboardBoard(boardId: string, boardTitle?: string) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const conference = getCurrentConference(state);
        const collabServerUrl = generateCollabServerUrl(state) || '';
        const collabData = {
            collabDetails: { roomId: boardId, roomKey: '' },
            collabServerUrl,
            boardTitle
        };

        dispatch(setupWhiteboard(collabData));
        if (isLocalParticipantModerator(state)) {
            // boardTitle rides along in the broadcast so every participant the
            // moderator snaps to this board also shows the real title, not the
            // hardcoded "Whiteboard" fallback.
            conference?.getMetadataHandler().setMetadata(WHITEBOARD_ID, collabData);
        }
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