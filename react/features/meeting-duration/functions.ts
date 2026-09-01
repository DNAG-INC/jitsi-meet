import { IStateful } from '../base/app/types';
import { toState } from '../base/redux/functions';

import { MEETING_END_BUFFER_MS } from './constants';

/**
 * Returns the configured scheduled meeting end as a UTC timestamp in
 * milliseconds, or 0 when unset. The {@code maxMeetingEndTime} config value is
 * in epoch seconds (matching the JWT {@code exp} convention) and converted here.
 *
 * This is the booked end (e.g. 4:00 PM) — an absolute wall-clock instant,
 * independent of when the conference was created, so it's restart-proof.
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getScheduledEndTimestamp(stateful: IStateful): number {
    const { maxMeetingEndTime } = toState(stateful)['features/base/config'];

    if (!maxMeetingEndTime || maxMeetingEndTime <= 0) {
        return 0;
    }

    return maxMeetingEndTime * 1000;
}

/**
 * Returns the effective end (UTC timestamp in milliseconds) at which the
 * meeting closes for everyone: the scheduled end plus a fixed grace buffer
 * ({@link MEETING_END_BUFFER_MS}). During the buffer — from the scheduled end
 * until this instant — participants see a "time is up" toast and a live
 * countdown. Returns 0 when the feature is disabled.
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getMeetingEndTimestamp(stateful: IStateful): number {
    const scheduledEnd = getScheduledEndTimestamp(stateful);

    return scheduledEnd ? scheduledEnd + MEETING_END_BUFFER_MS : 0;
}
