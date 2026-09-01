import { IStore } from '../app/types';
import {
    CONFERENCE_JOINED,
    CONFERENCE_LEFT,
    CONFERENCE_WILL_LEAVE
} from '../base/conference/actionTypes';
import { endConference } from '../base/conference/actions.any';
import { hangup } from '../base/connection/actions.web';
import { isLocalParticipantModerator } from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import { hideNotification, showWarningNotification } from '../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../notifications/constants';

import {
    MEETING_DURATION_NOTIFICATION_UID,
    MEETING_END_WARNING_MS
} from './constants';
import { getMeetingEndTimestamp } from './functions';
import logger from './logger';

/**
 * Handles for the scheduled warning and auto-end timers so they can be cleared
 * when the conference is left.
 */
let warningTimeout: number | undefined;
let endTimeout: number | undefined;

/**
 * Clears any pending meeting-duration timers.
 *
 * @returns {void}
 */
function clearTimers() {
    if (warningTimeout) {
        clearTimeout(warningTimeout);
        warningTimeout = undefined;
    }

    if (endTimeout) {
        clearTimeout(endTimeout);
        endTimeout = undefined;
    }
}

/**
 * Shows the "meeting will end soon" warning notification.
 *
 * @param {Function} dispatch - The redux dispatch function.
 * @returns {void}
 */
function showWarning(dispatch: IStore['dispatch']) {
    dispatch(showWarningNotification({
        titleKey: 'meetingDuration.warningTitle',
        descriptionKey: 'meetingDuration.warningDescription',
        uid: MEETING_DURATION_NOTIFICATION_UID
    }, NOTIFICATION_TIMEOUT_TYPE.STICKY));
}

/**
 * Ends the meeting when the time limit is reached:
 *   - **moderator** → {@code endConference()} — removes everyone at once, one
 *     clean end on the moderator's clock.
 *   - **non-moderator** → {@code hangup()} — leaves locally, so the room still
 *     empties even with no moderator present.
 *
 * Acting on every client is safe because the end is an *absolute* wall-clock
 * instant ({@code maxMeetingEndTime} + grace), not derived from the
 * conference-created timestamp. So during a live session it can never be
 * "already past" on join (the cause of the old self-disconnect bug) — it's only
 * past once the booked session + grace is genuinely over, where leaving is
 * correct.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function endMeeting({ dispatch, getState }: IStore) {
    clearTimers();
    dispatch(hideNotification(MEETING_DURATION_NOTIFICATION_UID));

    if (isLocalParticipantModerator(getState())) {
        logger.info('Meeting time limit reached, ending conference for everyone.');
        dispatch(endConference());
    } else {
        logger.info('Meeting time limit reached, leaving the conference.');
        dispatch(hangup());
    }
}

/**
 * Schedules the warning notification and the auto-end action based on the
 * configured meeting end time. If the limit is already within the warning
 * window (or past) when joining, the corresponding action fires immediately.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function scheduleTimers(store: IStore) {
    const { dispatch, getState } = store;

    clearTimers();

    const endTimestamp = getMeetingEndTimestamp(getState());

    if (!endTimestamp) {
        return;
    }

    const msUntilEnd = endTimestamp - Date.now();
    const msUntilWarning = msUntilEnd - MEETING_END_WARNING_MS;

    if (msUntilEnd <= 0) {
        endMeeting(store);

        return;
    }

    if (msUntilWarning <= 0) {
        showWarning(dispatch);
    } else {
        warningTimeout = window.setTimeout(() => showWarning(dispatch), msUntilWarning);
    }

    endTimeout = window.setTimeout(() => endMeeting(store), msUntilEnd);
}

MiddlewareRegistry.register(store => next => action => {
    const result = next(action);

    switch (action.type) {
    case CONFERENCE_JOINED:

        // The end is driven purely by maxMeetingEndTime (config, available at
        // join), so scheduling once on join is enough — no dependency on the
        // conference-created timestamp.
        scheduleTimers(store);
        break;
    case CONFERENCE_WILL_LEAVE:
    case CONFERENCE_LEFT:
        clearTimers();
        store.dispatch(hideNotification(MEETING_DURATION_NOTIFICATION_UID));
        break;
    }

    return result;
});
