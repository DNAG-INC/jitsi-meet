import { AnyAction } from 'redux';

import { IStore } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';
import { hideDialog, openDialog } from '../base/dialog/actions';
import { isDialogOpen } from '../base/dialog/functions';
import { PARTICIPANT_JOINED, PARTICIPANT_ROLE_CHANGED } from '../base/participants/actionTypes';
import { participantJoined, participantLeft, pinParticipant } from '../base/participants/actions';
import { isLocalParticipantModerator } from '../base/participants/functions';
import { FakeParticipant } from '../base/participants/types';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import { addStageParticipant } from '../filmstrip/actions.web';
import { isStageFilmstripAvailable } from '../filmstrip/functions.web';

import { RESET_WHITEBOARD, SET_WHITEBOARD_OPEN } from './actionTypes';
import {
    notifyWhiteboardLimit,
    restrictWhiteboard,
    setupWhiteboard,
    syncWhiteboardRoster
} from './actions';
import WhiteboardLimitDialog from './components/web/WhiteboardLimitDialog';
import { WHITEBOARD_ID, WHITEBOARD_PARTICIPANT_NAME } from './constants';
import {
    getCollabDetails,
    isWhiteboardPresent,
    shouldEnforceUserLimit,
    shouldNotifyUserLimit
} from './functions';
import { WhiteboardStatus } from './types';

import './middleware.any';

const focusWhiteboard = (store: IStore) => {
    const { dispatch, getState } = store;
    const state = getState();
    const conference = getCurrentConference(state);
    const stageFilmstrip = isStageFilmstripAvailable(state);
    const isPresent = isWhiteboardPresent(state);

    if (!isPresent) {
        dispatch(participantJoined({
            conference,
            fakeParticipant: FakeParticipant.Whiteboard,
            id: WHITEBOARD_ID,
            name: WHITEBOARD_PARTICIPANT_NAME
        }));
    }
    if (stageFilmstrip) {
        dispatch(addStageParticipant(WHITEBOARD_ID, true));
    } else {
        dispatch(pinParticipant(WHITEBOARD_ID));
    }
};

/**
 * Middleware which intercepts whiteboard actions to handle changes to the related state.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register((store: IStore) => (next: Function) => (action: AnyAction) => {
    const { dispatch, getState } = store;
    const state = getState();
    const conference = getCurrentConference(state);

    switch (action.type) {
    case SET_WHITEBOARD_OPEN: {
        const existingCollabDetails = getCollabDetails(state);
        const enforceUserLimit = shouldEnforceUserLimit(state);
        const notifyUserLimit = shouldNotifyUserLimit(state);
        const iAmRecorder = Boolean(state['features/base/config'].iAmRecorder);

        if (enforceUserLimit) {
            dispatch(restrictWhiteboard(false));
            dispatch(openDialog('WhiteboardLimitDialog', WhiteboardLimitDialog));
            iAmRecorder && setTimeout(() => dispatch(hideDialog('WhiteboardLimitDialog', WhiteboardLimitDialog)), 3000);

            return next(action);
        }

        if (action.isOpen && !existingCollabDetails) {
            setNewWhiteboardOpen(store);

            return next(action);
        }

        if (action.isOpen) {
            if (enforceUserLimit) {
                dispatch(restrictWhiteboard());

                return next(action);
            }

            if (notifyUserLimit) {
                dispatch(notifyWhiteboardLimit());
            }

            if (isDialogOpen(state, WhiteboardLimitDialog)) {
                dispatch(hideDialog('WhiteboardLimitDialog', WhiteboardLimitDialog));
            }

            focusWhiteboard(store);
            raiseWhiteboardNotification(WhiteboardStatus.SHOWN);

            return next(action);
        }

        // Broadcast the close to every participant. Without this, remote
        // clients keep rendering the iframe because their conference metadata
        // still holds the previously selected board. Gated on moderator +
        // existing roomId so the re-dispatch coming back from the metadata
        // listener (after resetWhiteboard clears state) doesn't re-broadcast.
        if (existingCollabDetails?.roomId && isLocalParticipantModerator(state)) {
            conference?.getMetadataHandler().setMetadata(WHITEBOARD_ID, { closed: true });
        }

        dispatch(participantLeft(WHITEBOARD_ID, conference, { fakeParticipant: FakeParticipant.Whiteboard }));
        raiseWhiteboardNotification(WhiteboardStatus.HIDDEN);

        break;
    }
    case RESET_WHITEBOARD: {
        dispatch(participantLeft(WHITEBOARD_ID, conference, { fakeParticipant: FakeParticipant.Whiteboard }));
        raiseWhiteboardNotification(WhiteboardStatus.RESET);

        break;
    }
    case PARTICIPANT_JOINED:
    case PARTICIPANT_ROLE_CHANGED: {
        // Whenever the participant roster changes while a board is open,
        // schedule a debounced roster sync. The dispatch is a cheap no-op
        // when no board is open or local isn't a moderator — guard logic
        // lives inside the action so this middleware stays lightweight.
        const joinedParticipant = action.participant;

        if (joinedParticipant?.fakeParticipant === FakeParticipant.Whiteboard) {
            // The fake whiteboard participant itself triggers PARTICIPANT_JOINED.
            // Don't echo a sync for it — it has no AAuti userId and adds nothing.
            break;
        }
        if (getCollabDetails(state)?.roomId && isLocalParticipantModerator(state)) {
            dispatch(syncWhiteboardRoster());
        }
        break;
    }
    }

    return next(action);
});

/**
 * Raises the whiteboard status notifications changes (if API is enabled).
 *
 * @param {WhiteboardStatus} status - The whiteboard changed status.
 * @returns {Function}
 */
function raiseWhiteboardNotification(status: WhiteboardStatus) {
    if (typeof APP !== 'undefined') {
        APP.API.notifyWhiteboardStatusChanged(status);
    }
}

/**
 * Sets a new whiteboard open.
 * WaveBook integration: dispatch setupWhiteboard with empty collab details so
 * the reducer flips isOpen=true and the picker renders. The picker dispatches
 * selectWhiteboardBoard once the user picks/creates a board, which replaces
 * collabDetails with the actual board id and broadcasts via metadata.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function setNewWhiteboardOpen(store: IStore) {
    const { dispatch } = store;

    focusWhiteboard(store);
    dispatch(setupWhiteboard({
        collabDetails: { roomId: '', roomKey: '' },
        collabServerUrl: ''
    }));
    raiseWhiteboardNotification(WhiteboardStatus.INSTANTIATED);
}
