import { createOpenWhiteboardEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { UPDATE_CONFERENCE_METADATA } from '../base/conference/actionTypes';
import { getCurrentConference } from '../base/conference/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import StateListenerRegistry from '../base/redux/StateListenerRegistry';

import { SET_WHITEBOARD_OPEN } from './actionTypes';
import {
    notifyWhiteboardLimit,
    resetWhiteboard,
    restrictWhiteboard,
    setWhiteboardOpen,
    setupWhiteboard
} from './actions';
import { WHITEBOARD_ID } from './constants';
import {
    generateCollabServerUrl,
    isWhiteboardOpen,
    shouldEnforceUserLimit,
    shouldNotifyUserLimit
} from './functions';

MiddlewareRegistry.register((store: IStore) => next => action => {
    const state = store.getState();

    switch (action.type) {
    case SET_WHITEBOARD_OPEN: {
        const enforceUserLimit = shouldEnforceUserLimit(state);
        const notifyUserLimit = shouldNotifyUserLimit(state);

        if (action.isOpen && !enforceUserLimit && !notifyUserLimit) {
            sendAnalytics(createOpenWhiteboardEvent());

            return next(action);
        }

        break;
    }

    case UPDATE_CONFERENCE_METADATA: {
        const wb = action.metadata?.[WHITEBOARD_ID];
        const newCollabDetails = wb?.collabDetails;

        // Only act on a *new* collaboration session. Unrelated metadata updates
        // (toggling the lobby, say) carry the same collabDetails, and without this
        // they re-open a whiteboard a participant had closed locally. The `closed`
        // branch below only covers a moderator closing it for the whole room.
        const previousCollabDetails = state['features/base/conference'].metadata?.[WHITEBOARD_ID]?.collabDetails;

        if (wb?.closed) {
            // Moderator hid the whiteboard for the room. Reset before flipping
            // isOpen=false so middleware.web.ts re-entry sees empty collab
            // details and skips the re-broadcast guard.
            store.dispatch(resetWhiteboard());
            store.dispatch(setWhiteboardOpen(false));
        } else if (newCollabDetails?.roomId && newCollabDetails.roomId !== previousCollabDetails?.roomId) {
            store.dispatch(setupWhiteboard({
                collabDetails: newCollabDetails,
                collabServerUrl: generateCollabServerUrl(store.getState()),
                boardTitle: wb.boardTitle
            }));

            // Prevents a second navigate() call on mobile
            // that would reload the WebView and disconnect the active collab session.
            if (!isWhiteboardOpen(store.getState())) {
                store.dispatch(setWhiteboardOpen(true));
            }
        }

        break;
    }
    }

    return next(action);
});

/**
 * Set up state change listener to perform maintenance tasks when the conference
 * is left or failed, e.g. Disable the whiteboard if it's left open.
 */
StateListenerRegistry.register(
    state => getCurrentConference(state),
    (conference, { dispatch }, previousConference): void => {
        if (conference !== previousConference) {
            dispatch(resetWhiteboard());
        }
    });

/**
 * Set up state change listener to limit whiteboard access.
 */
StateListenerRegistry.register(
    state => shouldEnforceUserLimit(state),
    (enforceUserLimit, { dispatch, getState }): void => {
        if (isWhiteboardOpen(getState()) && enforceUserLimit) {
            dispatch(restrictWhiteboard());
        }
    }
);

/**
 * Set up state change listener to notify about whiteboard usage.
 */
StateListenerRegistry.register(
    state => shouldNotifyUserLimit(state),
    (notifyUserLimit, { dispatch, getState }, prevNotifyUserLimit): void => {
        if (isWhiteboardOpen(getState()) && notifyUserLimit && !prevNotifyUserLimit) {
            dispatch(notifyWhiteboardLimit());
        }
    }
);
