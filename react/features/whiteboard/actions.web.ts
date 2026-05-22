import { createRestrictWhiteboardEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';

import { resetWhiteboard, setWhiteboardOpen, setupWhiteboard } from './actions.any';
import { WHITEBOARD_ID } from './constants';
import { generateCollabServerUrl, isWhiteboardAllowed, isWhiteboardOpen, isWhiteboardVisible } from './functions';
import { WhiteboardStatus } from './types';

export * from './actions.any';

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
 * Sets the WaveBook board the participants should join, then broadcasts it via
 * the conference metadata so other participants pick it up automatically.
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