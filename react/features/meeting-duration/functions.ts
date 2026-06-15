import { IStateful } from '../base/app/types';
import { getConferenceTimestamp } from '../base/conference/functions';
import { toState } from '../base/redux/functions';

import { MEETING_END_BUFFER_MS } from './constants';

/**
 * Returns the configured maximum meeting duration in milliseconds, or 0 when the
 * feature is disabled (config value unset, zero or negative).
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getMaxMeetingDurationMs(stateful: IStateful): number {
    const { maxMeetingDuration } = toState(stateful)['features/base/config'];

    if (!maxMeetingDuration || maxMeetingDuration <= 0) {
        return 0;
    }

    return maxMeetingDuration * 60 * 1000;
}

/**
 * Returns the configured absolute meeting end time in milliseconds (UTC), or 0
 * when unset. The config value is expressed in epoch seconds (matching the JWT
 * {@code exp} convention) and is converted to milliseconds here.
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getMeetingEndTimeMs(stateful: IStateful): number {
    const { maxMeetingEndTime } = toState(stateful)['features/base/config'];

    if (!maxMeetingEndTime || maxMeetingEndTime <= 0) {
        return 0;
    }

    return maxMeetingEndTime * 1000;
}

/**
 * Returns the configured scheduled end (UTC timestamp in milliseconds), or 0
 * when the feature is disabled. When both a duration and an absolute end time
 * are configured the earliest of the two wins, so the meeting is capped both by
 * its length and by its scheduled wall-clock end (an early start or a room
 * restart can never grant extra time past the absolute end).
 *
 * This is the *scheduled* end — the meeting is not closed at this instant; a
 * grace buffer is added on top (see {@link getMeetingEndTimestamp}).
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getScheduledEndTimestamp(stateful: IStateful): number {
    const state = toState(stateful);
    const durationMs = getMaxMeetingDurationMs(state);

    // lib-jitsi-meet delivers the conference created timestamp as a string, so
    // coerce it to a number before arithmetic to avoid string concatenation.
    const startTimestamp = Number(getConferenceTimestamp(state));
    const absoluteEnd = getMeetingEndTimeMs(state);

    const candidates: number[] = [];

    if (durationMs && startTimestamp) {
        candidates.push(startTimestamp + durationMs);
    }

    if (absoluteEnd) {
        candidates.push(absoluteEnd);
    }

    return candidates.length ? Math.min(...candidates) : 0;
}

/**
 * Returns the effective end (UTC timestamp in milliseconds) at which the
 * meeting actually closes for everyone: the scheduled end plus a grace buffer
 * ({@link MEETING_END_BUFFER_MS}). During the buffer — i.e. from the scheduled
 * end until this instant — participants see a "time is up" toast and a live
 * countdown. Returns 0 when the feature is disabled.
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getMeetingEndTimestamp(stateful: IStateful): number {
    const scheduledEnd = getScheduledEndTimestamp(stateful);

    return scheduledEnd ? scheduledEnd + MEETING_END_BUFFER_MS : 0;
}

/**
 * Returns the remaining meeting time in milliseconds relative to "now", or
 * {@code Infinity} when the feature is disabled. The value may be negative if
 * the limit has already been exceeded.
 *
 * @param {IStateful} stateful - The redux store, state or {@code getState}.
 * @returns {number}
 */
export function getRemainingMeetingTime(stateful: IStateful): number {
    const endTimestamp = getMeetingEndTimestamp(stateful);

    if (!endTimestamp) {
        return Infinity;
    }

    return endTimestamp - Date.now();
}
