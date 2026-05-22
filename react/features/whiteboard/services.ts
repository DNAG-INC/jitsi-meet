/**
 * REST helpers used by the WaveBook whiteboard sync.
 *
 * Two upstreams are talked to here:
 *
 *   1. AAuti Node backend (`/session/getWhiteboardMembers`) — the canonical
 *      source of "who can access this session right now." Reflects purchases
 *      and roster changes that happened after the moderator's JWT was minted,
 *      so it is the only signal that stays correct for late joiners.
 *
 *   2. WaveBook REST (`/api/whiteboard/...`) — the board store. The board's
 *      `users[]` is the membership list the embed gate checks; any user not
 *      on it gets a 404 on `/api/whiteboard/:boardId/user/:externalUserId`.
 *
 * `syncSessionRosterToBoard` orchestrates the two: fetch the AAuti roster,
 * fetch the current WaveBook board, compute the additions and role upgrades,
 * and PUT the merged list back. Roles upgrade-only (viewer -> editor -> owner)
 * so a participant promoted mid-call is honored, but never the other way —
 * losing edit access in the middle of a board session would be very confusing.
 */

import logger from './logger';

interface IBoardUser {

    // Optional profile image URL. Forwarded as-is to WaveBook; whether it
    // surfaces in WaveBook's participant list depends on the WaveBook user
    // schema accepting the field. Sending it costs nothing and is the only
    // way to surface AAuti avatars in the embed today.
    avatar?: string;
    name: string;
    role: string;
    userId: string;
}

interface IBoardDoc {
    _id?: string;
    id?: string;
    users?: IBoardUser[];
}

interface IWaveBookCallParams {
    apiKey: string;
    apiUrl: string;
    requesterUserId: string;
    requesterUserName: string;
}

interface IRosterFetchParams {
    aautiApiUrl: string;
    batchId?: string;
    requesterUserId: string;
    sessionId?: string;
}

interface IRosterResponse {
    members: IBoardUser[];
    sessionId: string | null;
}

const ROLE_RANK: Record<string, number> = {
    viewer: 1,
    editor: 2,
    owner: 3
};

const trimApi = (url: string) => url.replace(/\/$/, '');

const waveBookHeaders = ({ apiKey, requesterUserId, requesterUserName }: IWaveBookCallParams): HeadersInit => ({
    'x-api-key': apiKey,
    'x-user-id': requesterUserId,
    'x-user-name': requesterUserName,
    'Content-Type': 'application/json'
});

/**
 * Fetch the AAuti session roster. Returns null on network/parse failure or
 * if the endpoint reports 4xx — callers fall back to a no-op so an outage in
 * the AAuti backend never blocks the moderator's local board operations.
 */
export async function fetchSessionRoster(
        { aautiApiUrl, sessionId, batchId, requesterUserId }: IRosterFetchParams
): Promise<IRosterResponse | null> {
    if (!aautiApiUrl || (!sessionId && !batchId) || !requesterUserId) {
        return null;
    }
    try {
        const params = new URLSearchParams();

        if (sessionId) {
            params.set('sessionId', sessionId);
        }
        if (batchId) {
            params.set('batchId', batchId);
        }
        params.set('userId', requesterUserId);
        const res = await fetch(
            `${trimApi(aautiApiUrl)}/session/getWhiteboardMembers?${params.toString()}`,
            { method: 'GET' }
        );

        if (!res.ok) {
            logger.warn(`fetchSessionRoster: HTTP ${res.status}`);

            return null;
        }
        const json = await res.json();
        const result = json?.result || json?.data || json;
        const members: IBoardUser[] = Array.isArray(result?.members) ? result.members : [];

        return {
            members,
            sessionId: result?.sessionId || sessionId || null
        };
    } catch (err) {
        logger.warn('fetchSessionRoster failed', err);

        return null;
    }
}

/**
 * Fetch a single board with its current users[]. Returns null on failure.
 * Response shape tolerance mirrors useWaveBookSession in the AAuti React app.
 */
async function fetchBoard(
        boardId: string,
        params: IWaveBookCallParams
): Promise<IBoardDoc | null> {
    try {
        const res = await fetch(
            `${trimApi(params.apiUrl)}/api/whiteboard/${encodeURIComponent(boardId)}`,
            { headers: waveBookHeaders(params) }
        );

        if (!res.ok) {
            return null;
        }
        const json = await res.json();

        return json?.data?.board || json?.board || json?.data || json || null;
    } catch {
        return null;
    }
}

/**
 * Replace a board's users[] with the provided list.
 */
async function updateBoardUsers(
        boardId: string,
        users: IBoardUser[],
        params: IWaveBookCallParams
): Promise<boolean> {
    try {
        const res = await fetch(
            `${trimApi(params.apiUrl)}/api/whiteboard/update`,
            {
                method: 'PUT',
                headers: waveBookHeaders(params),
                body: JSON.stringify({ id: boardId, users })
            }
        );

        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Merge a set of incoming users into the board's users[]. New userIds are
 * added; existing userIds whose incoming role outranks their stored role are
 * upgraded (viewer -> editor -> owner). Downgrades are silently dropped — a
 * participant who started as 'owner' or 'editor' keeps that role even if a
 * later sync only lists them as 'viewer'. Returns true if the PUT was sent
 * (or wasn't needed because nothing changed).
 */
export async function mergeUsersIntoBoard(
        boardId: string,
        incoming: IBoardUser[],
        params: IWaveBookCallParams
): Promise<boolean> {
    const board = await fetchBoard(boardId, params);

    if (!board) {
        return false;
    }
    const existing = Array.isArray(board.users) ? board.users : [];
    const byId = new Map<string, IBoardUser>(existing.map(u => [ u.userId, u ]));
    let changed = false;

    incoming.forEach(u => {
        if (!u.userId) {
            return;
        }
        const current = byId.get(u.userId);

        if (!current) {
            byId.set(u.userId, u);
            changed = true;

            return;
        }
        const currentRank = ROLE_RANK[current.role] || 0;
        const incomingRank = ROLE_RANK[u.role] || 0;
        const avatarChanged = Boolean(u.avatar) && u.avatar !== current.avatar;

        if (incomingRank > currentRank) {
            byId.set(u.userId, {
                ...current,
                role: u.role,
                name: u.name || current.name,
                avatar: u.avatar || current.avatar
            });
            changed = true;
        } else if (avatarChanged) {
            byId.set(u.userId, { ...current, avatar: u.avatar });
            changed = true;
        }
    });

    if (!changed) {
        return true;
    }

    return updateBoardUsers(boardId, Array.from(byId.values()), params);
}

/**
 * Fetch the AAuti session roster and merge it into the WaveBook board.
 * Used by `selectWhiteboardBoard` on initial board open and by the
 * PARTICIPANT_JOINED middleware on every late join so the board's `users[]`
 * stays in sync with the canonical session roster.
 */
export async function syncSessionRosterToBoard(
        boardId: string,
        rosterParams: IRosterFetchParams,
        waveBookParams: IWaveBookCallParams
): Promise<boolean> {
    const roster = await fetchSessionRoster(rosterParams);

    if (!roster || roster.members.length === 0) {
        return false;
    }

    return mergeUsersIntoBoard(boardId, roster.members, waveBookParams);
}
