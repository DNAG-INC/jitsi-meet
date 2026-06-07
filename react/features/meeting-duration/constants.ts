/**
 * The amount of time (in milliseconds) before the meeting end at which the
 * warning notification is shown and the on-screen countdown becomes visible.
 */
export const MEETING_END_WARNING_MS = 5 * 60 * 1000;

/**
 * The fixed uid used for the "meeting will end soon" notification so it can be
 * shown once and reliably hidden when the conference is left.
 */
export const MEETING_DURATION_NOTIFICATION_UID = 'meeting-duration-warning';
