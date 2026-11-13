/**
 * How long a media toggle issued from this window has to take effect before it counts as stuck.
 */
const MEDIA_COMMAND_GRACE_MS = 1500;

/**
 * Brings the opening tab forward when a media toggle issued from this window does not take effect.
 *
 * Turning a device on makes the meeting call getUserMedia, and the browser anchors that call's
 * permission prompt to the tab, withholding it while the tab is unfocused. Firefox leaves the
 * promise pending, so the toggle silently does nothing. This window cannot host the prompt, so
 * putting the tab back in front is the only way to let the user answer it.
 *
 * @param {Function} tookEffect - Whether the toggle has been applied since it was issued.
 * @returns {void}
 */
export function focusOpenerIfStuck(tookEffect: () => boolean) {
    setTimeout(() => {
        if (!tookEffect()) {
            window.alwaysOnTop.focusOpener?.();
        }
    }, MEDIA_COMMAND_GRACE_MS);
}
