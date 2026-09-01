/**
 * Grace buffer (in milliseconds) added after the scheduled end before the
 * meeting actually closes. During this buffer participants see a "time is up"
 * toast and a live countdown, then the conference is ended for everyone.
 */
export const MEETING_END_BUFFER_MS = 5 * 60 * 1000;

/**
 * The window (in milliseconds) before the effective end during which the
 * warning notification is shown and the on-screen countdown becomes visible.
 * Kept equal to the buffer so the toast/countdown span exactly the grace
 * period — i.e. they appear the moment the scheduled end time is reached.
 */
export const MEETING_END_WARNING_MS = MEETING_END_BUFFER_MS;

/**
 * The fixed uid used for the "meeting will end soon" notification so it can be
 * shown once and reliably hidden when the conference is left.
 */
export const MEETING_DURATION_NOTIFICATION_UID = 'meeting-duration-warning';
