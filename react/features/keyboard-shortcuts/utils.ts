/**
 * Prefer keyboard handling of these elements over global shortcuts.
 * If a button is triggered using the Spacebar it should not trigger PTT.
 * If an input element is focused and M is pressed it should not mute audio.
 */
const _elementsBlacklist = [
    'input',
    'textarea',

    // contentEditable rich-text hosts (e.g. the whiteboard SDK's text tool).
    // Without this, typing letters that map to global shortcuts (m, d, r, w…)
    // leaks into mute / screenshare / raise-hand / whiteboard-toggle while the
    // user is writing. Excludes `=false` so non-editable nodes don't match.
    '[contenteditable]:not([contenteditable="false"])',
    'button',
    '[role=button]',
    '[role=menuitem]',
    '[role=radio]',
    '[role=tab]',
    '[role=option]',
    '[role=switch]',
    '[role=range]',
    '[role=log]'
];

/**
* Returns the currently focused element when it is one the keyboard should own
* (text fields, contentEditable, buttons, etc.) — so global shortcuts are
* suppressed while the user is typing/interacting there. Returns null otherwise.
*
* Resolves the *actual* focused element rather than relying on a `:focus`
* selector against the top document: it descends through open shadow roots and
* same-origin iframes (where the outer document's focus is only the host /
* <iframe> element, not the inner field), then tests {@code isContentEditable}
* (true for inherited/nested editable regions the attribute selector misses —
* e.g. the whiteboard SDK's text tool and comment box) before the blacklist.
*
* @returns {HTMLElement|null} - The focused element to defer to, or null.
*/
export const getPriorityFocusedElement = (): HTMLElement | null => {
    let el: Element | null = document.activeElement;

    // Descend into open shadow roots — a focused element inside a shadow tree
    // reports only the host to the outer document's `:focus`/activeElement.
    while (el?.shadowRoot?.activeElement) {
        el = el.shadowRoot.activeElement;
    }

    // Same-origin iframe: the real focus lives in its document, while the outer
    // page only sees the <iframe> element as focused.
    if (el instanceof HTMLIFrameElement) {
        try {
            el = el.contentDocument?.activeElement ?? el;
        } catch {
            // Cross-origin — inaccessible; treat the iframe element as focused.
        }
    }

    if (!el) {
        return null;
    }

    // contentEditable (incl. inherited) — the whiteboard text tool + comment box.
    if ((el as HTMLElement).isContentEditable) {
        return el as HTMLElement;
    }

    return el.matches(_elementsBlacklist.join(',')) ? el as HTMLElement : null;
};

/**
* Returns the keyboard key from a KeyboardEvent.
*
* @param {KeyboardEvent} e - The KeyboardEvent.
* @returns {string} - The keyboard key.
*/
export const getKeyboardKey = (e: KeyboardEvent): string => {
    // @ts-ignore
    const { altKey, code, key, shiftKey, type, which, ctrlKey } = e;

    // If alt is pressed a different char can be returned so this takes
    // the char from the code. It also prefixes with a colon to differentiate
    // alt combo from simple keypress.

    const replacedKey = code.replace('Key', '');

    if (ctrlKey && altKey) {
        return `-:${replacedKey}`;
    }

    if (altKey) {
        return `:${replacedKey}`;
    }

    // If e.key is a string, then it is assumed it already plainly states
    // the key pressed. This may not be true in all cases, such as with Edge
    // and "?", when the browser cannot properly map a key press event to a
    // keyboard key. To be safe, when a key is "Unidentified" it must be
    // further analyzed by jitsi to a key using e.which.
    if (typeof key === 'string' && key !== 'Unidentified') {
        if (ctrlKey) {
            return `-${key}`;
        }

        if (code.startsWith('Key')) {
            return replacedKey;
        }

        return key;
    }

    if (type === 'keypress'
            && ((which >= 32 && which <= 126)
                || (which >= 160 && which <= 255))) {
        return String.fromCharCode(which);
    }

    // try to fallback (0-9A-Za-z and QWERTY keyboard)
    switch (which) {
    case 27:
        return 'Escape';
    case 191:
        return shiftKey ? '?' : '/';
    }

    if (shiftKey || type === 'keypress') {
        return String.fromCharCode(which);
    }

    return String.fromCharCode(which).toLowerCase();
};
