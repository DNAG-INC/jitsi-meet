import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { keyframes } from 'tss-react';
import { makeStyles } from 'tss-react/mui';

import { IReduxState } from '../../../app/types';
import { openDialog } from '../../../base/dialog/actions';
import { IconPlus, IconReload } from '../../../base/icons/svg';
import { getLocalParticipant, getRemoteParticipants } from '../../../base/participants/functions';
import { IParticipant } from '../../../base/participants/types';
import Button from '../../../base/ui/components/web/Button';
import ClickableIcon from '../../../base/ui/components/web/ClickableIcon';
import { selectWhiteboardBoard } from '../../actions.web';
import { BOARD_NAME_MIN_LENGTH } from '../../constants';
import { IWaveBookMember, getWaveBookJwtContext, resolveWhiteboardCallerRole } from '../../functions';
import { IBoard } from '../../types';

import WhiteboardBoardCard from './WhiteboardBoardCard';
import WhiteboardCreateDialog from './WhiteboardCreateDialog';
import { getWhiteboardCardStyles } from './styles';

/**
 * Below this width the panel is too narrow for the dashed "Add" tile, which costs a
 * whole grid row before any board is visible. The header carries an icon button instead.
 */
const COMPACT_MAX_WIDTH = 480;

const useStyles = makeStyles()(theme => {
    return {
        container: {
            backgroundColor: theme.palette.ui01,
            boxSizing: 'border-box',
            color: theme.palette.text01,
            height: '100%',
            overflowY: 'auto',
            padding: '24px',
            width: '100%',

            [theme.breakpoints.down(COMPACT_MAX_WIDTH)]: {
                padding: '16px'
            }
        },

        header: {
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'space-between',
            marginBottom: '20px'
        },

        actions: {
            alignItems: 'center',
            display: 'flex',
            gap: '8px',
            marginLeft: 'auto'
        },

        title: {
            ...theme.typography.heading6,
            margin: 0
        },

        error: {
            color: theme.palette.textError,
            marginBottom: '12px'
        },

        grid: {
            display: 'grid',
            gap: '16px',

            // `min(200px, 100%)` rather than a bare 200px: below that width the track keeps its
            // 200px floor and pushes the grid into horizontal overflow, clipping cards on a phone.
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))'
        },

        refreshButton: {
            '& svg': {
                fill: theme.palette.text02
            }
        },

        refreshButtonBusy: {
            // Spin while the request is in flight; a dimmed icon reads as
            // disabled rather than busy.
            pointerEvents: 'none',

            '& svg': {
                transformOrigin: 'center',
                animation: `${keyframes`
                    0% {
                        transform: rotate(0);
                    }
                    100% {
                        transform: rotate(360deg);
                    }
                `} 1s linear infinite`
            }
        },

        addButton: {
            display: 'none',

            [theme.breakpoints.down(COMPACT_MAX_WIDTH)]: {
                display: 'flex'
            }
        },

        addCard: {
            ...getWhiteboardCardStyles(theme),
            alignItems: 'center',
            borderStyle: 'dashed',
            justifyContent: 'center',
            textAlign: 'center',

            [theme.breakpoints.down(COMPACT_MAX_WIDTH)]: {
                display: 'none'
            }
        },

        addIcon: {
            fontSize: '28px',
            lineHeight: 1
        },

        addLabel: {
            marginTop: '8px'
        },

        addDescription: {
            ...theme.typography.bodyShortRegularSmall,
            color: theme.palette.text02,
            marginTop: '4px'
        }
    };
});

interface IProps {

    /**
     * Whether the local participant can create new boards. True for
     * moderators only — non-moderators see the existing-boards grid but
     * not the "Add Whiteboard" card or the create dialog.
     */
    canCreate?: boolean;

    /**
     * Fires after a board is picked or created. Used by the parent to clear
     * any local "show picker" override (e.g. the back-button forcePicker
     * state in Whiteboard.tsx) so re-selecting the SAME board still flips
     * the view back to the iframe.
     */
    onSelect?: () => void;
}

/**
 * Grid of the session's whiteboards, with an entry point for creating one.
 *
 * @param {IProps} props - The component props.
 * @returns {JSX.Element}
 */
const WhiteboardPicker = ({ canCreate = false, onSelect }: IProps) => {
    const { classes, cx } = useStyles();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const whiteboardConfig = useSelector(
        (state: IReduxState) => state['features/base/config'].whiteboard || {}
    );
    const localParticipant = useSelector(getLocalParticipant);
    const jwtCtx = useSelector(getWaveBookJwtContext);
    // Live Jitsi participants currently in the conference. Used at board
    // create time so the seeded users[] reflects everyone in the AV call
    // right now, not just the JWT-frozen members list which is captured
    // at JWT-mint time and misses anyone who joined the call afterwards.
    const remoteParticipants = useSelector(getRemoteParticipants);
    const remoteParticipantsRef = useRef(remoteParticipants);

    const apiUrl = whiteboardConfig.apiUrl;
    const apiKey = whiteboardConfig.apiKey;
    // Per-user/session context comes from JWT custom claims minted by the
    // AAuti backend: context.user.{id,name} + context.metadata.{sessionId,
    // sessionTitle, sessionOwnerId, sessionOwnerName, userRole, category,
    // subCategory, instituteId, members}.
    // See getWaveBookJwtContext.
    const sessionId = jwtCtx?.sessionId;
    const sessionTitle = jwtCtx?.sessionTitle;
    const sessionOwnerId = jwtCtx?.sessionOwnerId;
    const sessionOwnerName = jwtCtx?.sessionOwnerName;
    const userId = jwtCtx?.userId || localParticipant?.id || '';
    const userName = jwtCtx?.userName || localParticipant?.name || 'User';
    const category = jwtCtx?.category;
    const subCategory = jwtCtx?.subCategory;
    const instituteId = jwtCtx?.instituteId;
    const members = jwtCtx?.members || [];

    const [ boards, setBoards ] = useState<IBoard[]>([]);
    const [ loading, setLoading ] = useState(false);
    const [ errorMsg, setErrorMsg ] = useState<string | null>(null);

    // Resolved in functions.ts so the role vocabulary has a single home.
    const boardRole = resolveWhiteboardCallerRole(jwtCtx, canCreate);

    const headers = useMemo(() => ({
        'x-api-key': apiKey || '',
        'x-user-id': userId,
        'x-user-name': userName,
        ...(boardRole ? { 'x-user-role': boardRole } : {}),
        'Content-Type': 'application/json'
    }), [ apiKey, userId, userName, boardRole ]);

    const loadBoards = useCallback(async () => {
        if (!apiUrl || !apiKey) {
            setErrorMsg(t('whiteboard.errorNotConfigured'));

            return;
        }
        setLoading(true);
        setErrorMsg(null);
        try {
            // Match useWaveBookSession.fetchWhiteboardData: meta carries only
            // sessionId. Category/subCategory live in each board's metadata and
            // aren't used to filter the session list here.
            const params = new URLSearchParams();

            if (sessionId) {
                params.set('meta', `sessionId:${sessionId}`);
            }

            // Tags for a board the service may auto-provision on this call
            // (empty session + staff role). These are seed-only: they tag the
            // new board without filtering the listing. Deliberately NOT the
            // plain `instituteId` param, which DOES filter - passing that here
            // would hide every board created before institute tagging existed.
            if (category) {
                params.set('seedCategory', category);
            }
            if (subCategory) {
                params.set('seedSubCategory', subCategory);
            }
            if (instituteId) {
                params.set('seedInstituteId', instituteId);
            }
            if (sessionTitle) {
                params.set('seedTitle', sessionTitle);
            }

            // The session's assigned instructor owns a provisioned board, so
            // an admin who opens the whiteboard first doesn't take it.
            if (sessionOwnerId) {
                params.set('seedOwnerId', sessionOwnerId);
            }
            if (sessionOwnerName) {
                params.set('seedOwnerName', sessionOwnerName);
            }

            // Provisioning INTENT, separate from x-user-role (which says who
            // the caller is). In a call the board is always wanted when the
            // session has none, so moderators always ask; the service still
            // checks the role before acting. Non-moderators never ask.
            if (canCreate) {
                params.set('autoProvision', '1');
            }
            const qs = params.toString() ? `?${params.toString()}` : '';
            const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/whiteboard/getAll${qs}`, { headers });
            const json = await res.json();
            const list = json?.data?.boards || json?.data || json?.boards || [];

            setBoards(Array.isArray(list) ? list : []);
        } catch (err: any) {
            setErrorMsg(err?.message || t('whiteboard.errorLoadFailed'));
        } finally {
            setLoading(false);
        }
    }, [ apiUrl, apiKey, sessionId, sessionTitle, sessionOwnerId, sessionOwnerName, category, subCategory,
        instituteId, canCreate, headers, t ]);

    useEffect(() => {
        loadBoards();
    }, [ loadBoards ]);

    // The create dialog captures handleCreate when it opens, so the roster has to be read at
    // submit time instead: anyone who joins while the moderator is still typing a name must
    // still end up in the seeded users[].
    useEffect(() => {
        remoteParticipantsRef.current = remoteParticipants;
    }, [ remoteParticipants ]);

    const handleSelect = useCallback((board: IBoard) => {
        const boardId = board._id || board.id;

        if (boardId) {
            dispatch(selectWhiteboardBoard(boardId, board.title || board.name) as any);
            // Tell parent the picker is done. Required so re-selecting the
            // same board after a back-button press still hides the picker —
            // otherwise the parent's [boardId] effect can't detect a change.
            onSelect?.();
        }
    }, [ dispatch, onSelect ]);

    const handleCreate = useCallback(async (title: string) => {
        if (!title || !apiUrl) {
            return;
        }
        if (title.length < BOARD_NAME_MIN_LENGTH) {
            setErrorMsg(t('whiteboard.errorTitleTooShort', { min: BOARD_NAME_MIN_LENGTH }));

            return;
        }
        setErrorMsg(null);
        try {
            // Seed users[] from three sources, deduped by userId:
            //   1. The creator as 'owner'.
            //   2. jwt.context.metadata.members — the ChatRoom roster
            //      snapshot from when the creator's JWT was minted
            //      (moderators -> editor, members -> viewer).
            //   3. Every other Jitsi participant currently in the AV call,
            //      mapped via their broadcast jwtId (AAuti user id) to
            //      'editor' for moderators / 'viewer' otherwise.
            // (3) is the critical addition: without it, anyone who joined
            // the call after the creator's JWT was minted (late purchases,
            // guests via /joinByToken, etc.) wouldn't appear in board.users[]
            // until they themselves opened the iframe and tripped the
            // embed-gate auto-add — so the moderator's Members panel would
            // sit at "2 of 11 in the call".
            // Forward each user's AAuti avatar URL where available so
            // WaveBook's User record gets populated with a real image at
            // create time. Without this the Members panel renders only
            // the colored-initials badge — the user.avatar field stays
            // empty until something else updates it.
            const users: Array<{ avatar?: string; name: string; role: string; userId: string; }> = [];
            const seen = new Set<string>();

            if (userId) {
                users.push({
                    userId,
                    name: userName,
                    role: 'owner',
                    avatar: localParticipant?.avatarURL
                });
                seen.add(userId);
            }

            members.forEach((m: IWaveBookMember) => {
                if (!m.userId || seen.has(m.userId)) {
                    return;
                }
                seen.add(m.userId);
                users.push({
                    userId: m.userId,
                    name: m.name || '',
                    role: m.role,
                    avatar: m.avatar
                });
            });

            remoteParticipantsRef.current.forEach((p: IParticipant) => {
                // Skip the whiteboard fake-participant and anyone we
                // already added from sources 1/2.
                if (p.fakeParticipant) {
                    return;
                }
                const externalId = p.jwtId;

                if (!externalId || seen.has(externalId)) {
                    return;
                }
                seen.add(externalId);
                users.push({
                    userId: externalId,
                    name: p.name || '',
                    role: p.role === 'moderator' ? 'editor' : 'viewer',
                    avatar: p.avatarURL
                });
            });

            const body: Record<string, any> = {
                title,
                description: '',
                users,
                metadata: {
                    type: 'blank',
                    ...(sessionId && { sessionId }),
                    ...(category && { category }),
                    ...(subCategory && { subCategory }),
                    ...(instituteId && { instituteId })
                }
            };
            const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/whiteboard/create`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });
            const json = await res.json();
            // useWaveBookSession reads createRes.data.data.board — match that
            // shape first, fall back to looser ones.
            const board = json?.data?.board || json?.board || json?.data || json;
            const boardId = board?._id || board?.id;

            if (boardId) {
                dispatch(selectWhiteboardBoard(boardId, title) as any);

                // Tell the embedding Aauti app a board was just created so it
                // can post a "whiteboard added" activity into the session feed.
                // Emitted HERE (not in selectWhiteboardBoard or the metadata
                // interceptor) on purpose: this runs once, only on the creator's
                // (moderator's) client, and only for a genuine create — never on
                // a plain select, and never on every participant when the
                // metadata broadcast converges.
                if (typeof APP !== 'undefined') {
                    APP.API.notifyWhiteboardCreated({ boardId, title, sessionId });
                }
                onSelect?.();
            } else {
                setErrorMsg(json?.error || json?.message || t('whiteboard.errorCreateFailed'));
            }
        } catch (err: any) {
            setErrorMsg(err?.message || t('whiteboard.errorCreateFailed'));
        }
    }, [ apiUrl, sessionId, category, subCategory, instituteId, userId, userName, localParticipant?.avatarURL,
        members, headers, dispatch, onSelect, t ]);

    const handleOpenCreate = useCallback(() => {
        dispatch(openDialog('WhiteboardCreateDialog', WhiteboardCreateDialog, { onSubmit: handleCreate }));
    }, [ dispatch, handleCreate ]);

    return (
        <div className = { classes.container }>
            <div className = { classes.header }>
                <h2 className = { classes.title }>{ t('whiteboard.pickerTitle') }</h2>
                <div className = { classes.actions }>
                    <ClickableIcon
                        accessibilityLabel = { t('whiteboard.refresh') }
                        className = { cx(classes.refreshButton, loading && classes.refreshButtonBusy) }
                        icon = { IconReload }
                        onClick = { loadBoards } />
                    { canCreate && (
                        <Button
                            accessibilityLabel = { t('whiteboard.addBoard') }
                            className = { classes.addButton }
                            icon = { IconPlus }
                            onClick = { handleOpenCreate } />
                    )}
                </div>
            </div>

            { errorMsg && <div className = { classes.error }>{ errorMsg }</div> }

            <div className = { classes.grid }>
                { canCreate && (
                    <button
                        className = { classes.addCard }
                        onClick = { handleOpenCreate }
                        type = 'button'>
                        <span className = { classes.addIcon }>+</span>
                        <span className = { classes.addLabel }>{ t('whiteboard.addBoard') }</span>
                        <span className = { classes.addDescription }>
                            { t('whiteboard.addBoardDescription') }
                        </span>
                    </button>
                )}

                { boards.map(board => (
                    <WhiteboardBoardCard
                        board = { board }
                        key = { board._id || board.id }
                        onSelect = { handleSelect } />
                ))}
            </div>
        </div>
    );
};

export default WhiteboardPicker;
