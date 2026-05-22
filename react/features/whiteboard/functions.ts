// @ts-expect-error
import jwtDecode from 'jwt-decode';
import md5 from 'js-md5';

import { getParticipantCount, getPinnedParticipant } from '../../features/base/participants/functions';
import { IReduxState } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';
import { IWhiteboardConfig } from '../base/config/configType';
import { getRemoteParticipants } from '../base/participants/functions';
import { encodeToBase64URL } from '../base/util/httpUtils';
import { appendURLHashParam, appendURLParam, getBackendSafePath } from '../base/util/uri';
import { getCurrentRoomId, isInBreakoutRoom } from '../breakout-rooms/functions';

import { MIN_USER_LIMIT, USER_LIMIT_THRESHOLD, WHITEBOARD_ID, WHITEBOARD_PATH_NAME } from './constants';
import { IWhiteboardState } from './reducer';

/**
 * Pulls AAuti-specific WaveBook claims from the JWT custom metadata.
 * AAuti's Jitsi launch must mint a JWT with:
 *   {
 *     context: {
 *       user: { id, name },
 *       metadata: {
 *         sessionId, userRole, category, subCategory, instituteId
 *       }
 *     }
 *   }
 * Returns null if no JWT or decode failure. Picker/Whiteboard fall back to
 * config.whiteboard.testXxx values for local dev.
 */
export interface IWaveBookMember {
    name: string;
    role: 'editor' | 'viewer';
    userId: string;
}

export interface IWaveBookJwtContext {
    category?: string;
    instituteId?: string;
    members?: IWaveBookMember[];
    sessionId?: string;
    subCategory?: string;
    userId?: string;
    userName?: string;
    userRole?: string;
}

export const getWaveBookJwtContext = (state: IReduxState): IWaveBookJwtContext | null => {
    const jwt = state['features/base/jwt']?.jwt;

    if (!jwt) {
        return null;
    }
    try {
        const payload: any = jwtDecode(jwt);
        const ctx = payload?.context || {};
        const meta = ctx.metadata || {};

        return {
            userId: ctx.user?.id,
            userName: ctx.user?.name,
            sessionId: meta.sessionId,
            userRole: meta.userRole,
            category: meta.category,
            subCategory: meta.subCategory,
            instituteId: meta.instituteId,
            members: Array.isArray(meta.members) ? meta.members : []
        };
    } catch {
        return null;
    }
};

const getWhiteboardState = (state: IReduxState): IWhiteboardState => state['features/whiteboard'];

export const getWhiteboardConfig = (state: IReduxState): IWhiteboardConfig =>
    state['features/base/config'].whiteboard || {};

const getWhiteboardUserLimit = (state: IReduxState): number => {
    const userLimit = getWhiteboardConfig(state).userLimit || Infinity;

    return userLimit === Infinity
        ? userLimit
        : Math.max(Number(getWhiteboardConfig(state).userLimit || 1), MIN_USER_LIMIT);
};

/**
 * Returns the whiteboard collaboration details.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {{ roomId: string, roomKey: string}|undefined}
 */
export const getCollabDetails = (state: IReduxState): {
    roomId: string; roomKey: string;
} | undefined => getWhiteboardState(state).collabDetails;

/**
 * Indicates whether the whiteboard collaboration details are available.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
const hasCollabDetails = (state: IReduxState): boolean => Boolean(
    getCollabDetails(state)?.roomId && getCollabDetails(state)?.roomKey
);

/**
 * Indicates whether the whiteboard is enabled.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardEnabled = (state: IReduxState): boolean =>
    (getWhiteboardConfig(state).enabled ?? hasCollabDetails(state))
    && getWhiteboardConfig(state).collabServerBaseUrl
    && getCurrentConference(state)?.getMetadataHandler()
?.isSupported();

/**
 * Indicates whether the whiteboard is open.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardOpen = (state: IReduxState): boolean => getWhiteboardState(state).isOpen;

/**
 * Indicates whether the whiteboard show/hide button is visible.
 *
 * AAuti policy: every participant can show/hide the whiteboard panel
 * locally. The picker (board create/select) is moderator-only — see
 * Whiteboard.tsx where non-moderators see "Waiting for the host..."
 * instead of the picker. So showing the button to non-moderators only
 * lets them toggle their own panel visibility; they can never create
 * or pick a board, and only the moderator's pick/hide propagates via
 * conference metadata.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardButtonVisible = (state: IReduxState): boolean =>
    isWhiteboardEnabled(state);

/**
 * Indicates whether the whiteboard is present as a meeting participant.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardPresent = (state: IReduxState): boolean => getRemoteParticipants(state).has(WHITEBOARD_ID);

/**
 * Builds the whiteboard collaboration server url.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {string}
 */
export const generateCollabServerUrl = (state: IReduxState): string | undefined => {
    const collabServerBaseUrl = getWhiteboardConfig(state).collabServerBaseUrl;

    if (!collabServerBaseUrl) {
        return;
    }

    const { locationURL } = state['features/base/connection'];
    const inBreakoutRoom = isInBreakoutRoom(state);
    const roomId = getCurrentRoomId(state);
    const room = md5.hex(
        `${getBackendSafePath(locationURL?.pathname)}${inBreakoutRoom ? `|${roomId}` : ''}`
    );

    return appendURLParam(collabServerBaseUrl, 'room', room);
};

/**
 * Returns the whiteboard collaboration server url.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {string}
 */
export const getCollabServerUrl = (state: IReduxState): string | undefined =>
    getWhiteboardState(state).collabServerUrl;

/**
 * Whether the whiteboard is visible on stage.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardVisible = (state: IReduxState): boolean =>
    getPinnedParticipant(state)?.id === WHITEBOARD_ID
    || state['features/large-video'].participantId === WHITEBOARD_ID;

/**
 * Indicates whether the local participant can toggle the whiteboard.
 *
 * AAuti policy: any participant can open/hide their own whiteboard panel.
 * Moderator-only actions (board pick, broadcast-to-all hide) are gated
 * separately in selectWhiteboardBoard / middleware.web.ts via direct
 * isLocalParticipantModerator checks.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const isWhiteboardAllowed = (state: IReduxState): boolean =>
    isWhiteboardEnabled(state);

/**
 * Whether to enforce the whiteboard user limit.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const shouldEnforceUserLimit = (state: IReduxState): boolean => {
    const userLimit = getWhiteboardUserLimit(state);

    if (userLimit === Infinity) {
        return false;
    }

    const participantCount = getParticipantCount(state);

    return participantCount > userLimit;
};

/**
 * Whether to show a warning about the whiteboard user limit.
 *
 * @param {IReduxState} state - The state from the Redux store.
 * @returns {boolean}
 */
export const shouldNotifyUserLimit = (state: IReduxState): boolean => {
    const userLimit = getWhiteboardUserLimit(state);

    if (userLimit === Infinity) {
        return false;
    }

    const participantCount = getParticipantCount(state);

    return participantCount + USER_LIMIT_THRESHOLD > userLimit;
};

/**
 * Generates the URL for the static whiteboard page.
 *
 * @param {string} locationUrl - The window location href.
 * @param {string} collabServerUrl - The whiteboard collaboration server url.
 * @param {Object} collabDetails - The whiteboard collaboration details.
 * @param {string} localParticipantName - The local participant name.
 * @returns {string}
 */
export function getWhiteboardInfoForURIString(
        locationUrl: any,
        collabServerUrl: string,
        collabDetails: { roomId: string; roomKey: string; },
        localParticipantName: string
): string | undefined {
    if (!collabServerUrl || !locationUrl) {
        return undefined;
    }

    let state = {};
    let url = `${locationUrl.substring(0, locationUrl.lastIndexOf('/'))}/${WHITEBOARD_PATH_NAME}`;

    if (collabDetails?.roomId) {
        state = {
            ...state,
            roomId: collabDetails.roomId
        };
    }

    if (collabDetails?.roomKey) {
        state = {
            ...state,
            roomKey: collabDetails.roomKey
        };
    }

    state = {
        ...state,
        collabServerUrl,
        localParticipantName
    };

    url = appendURLHashParam(url, 'state', encodeToBase64URL(JSON.stringify(state)));

    return url;
}
