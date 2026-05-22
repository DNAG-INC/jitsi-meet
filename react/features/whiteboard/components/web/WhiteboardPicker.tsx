import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { getLocalParticipant } from '../../../base/participants/functions';
import { selectWhiteboardBoard } from '../../actions.web';
import { getWaveBookJwtContext } from '../../functions';

interface IBoard {
    _id?: string;
    description?: string;
    id?: string;
    name?: string;
    title?: string;
    updatedAt?: string;
}

const cardStyle: React.CSSProperties = {
    background: '#27272a',
    border: '1px solid #3f3f46',
    borderRadius: 8,
    padding: 16,
    minHeight: 120,
    color: '#fafafa',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    cursor: 'pointer',
    fontSize: 14,
    overflow: 'hidden'
};

interface IProps {
    /**
     * Fires after a board is picked or created. Used by the parent to clear
     * any local "show picker" override (e.g. the back-button forcePicker
     * state in Whiteboard.tsx) so re-selecting the SAME board still flips
     * the view back to the iframe.
     */
    onSelect?: () => void;
}

const WhiteboardPicker = ({ onSelect }: IProps) => {
    const dispatch = useDispatch();
    const whiteboardConfig = useSelector(
        (state: IReduxState) => state['features/base/config'].whiteboard || {}
    );
    const localParticipant = useSelector(getLocalParticipant);
    const jwtCtx = useSelector(getWaveBookJwtContext);

    const apiUrl = whiteboardConfig.apiUrl;
    const apiKey = whiteboardConfig.apiKey;
    // Per-user/session context comes from JWT custom claims minted by the
    // AAuti backend: context.user.{id,name} + context.metadata.{sessionId,
    // category, subCategory, instituteId}. See getWaveBookJwtContext.
    const sessionId = jwtCtx?.sessionId;
    const userId = jwtCtx?.userId || localParticipant?.id || '';
    const userName = jwtCtx?.userName || localParticipant?.name || 'User';
    const category = jwtCtx?.category;
    const subCategory = jwtCtx?.subCategory;
    const instituteId = jwtCtx?.instituteId;
    const members = jwtCtx?.members || [];


    const [ boards, setBoards ] = useState<IBoard[]>([]);
    const [ loading, setLoading ] = useState(false);
    const [ errorMsg, setErrorMsg ] = useState<string | null>(null);
    const [ creating, setCreating ] = useState(false);
    const [ newBoardName, setNewBoardName ] = useState('');
    const [ submitting, setSubmitting ] = useState(false);

    const headers = useMemo(() => ({
        'x-api-key': apiKey || '',
        'x-user-id': userId,
        'x-user-name': userName,
        'Content-Type': 'application/json'
    }), [ apiKey, userId, userName ]);

    const loadBoards = useCallback(async () => {
        if (!apiUrl || !apiKey) {
            setErrorMsg('Whiteboard API not configured');

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
            const qs = params.toString() ? `?${params.toString()}` : '';
            const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/whiteboard/getAll${qs}`, { headers });
            const json = await res.json();
            const list = json?.data?.boards || json?.data || json?.boards || [];

            setBoards(Array.isArray(list) ? list : []);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Failed to load boards');
        } finally {
            setLoading(false);
        }
    }, [ apiUrl, apiKey, sessionId, headers ]);

    useEffect(() => {
        loadBoards();
    }, [ loadBoards ]);

    const handleSelect = useCallback((board: IBoard) => {
        const boardId = board._id || board.id;

        if (boardId) {
            dispatch(selectWhiteboardBoard(boardId) as any);
            // Tell parent the picker is done. Required so re-selecting the
            // same board after a back-button press still hides the picker —
            // otherwise the parent's [boardId] effect can't detect a change.
            onSelect?.();
        }
    }, [ dispatch, onSelect ]);

    const handleCreate = useCallback(async () => {
        const title = newBoardName.trim();

        if (!title || !apiUrl) {
            return;
        }
        if (title.length < 5) {
            setErrorMsg('Title must be at least 5 characters');

            return;
        }
        setSubmitting(true);
        setErrorMsg(null);
        try {
            // Mirror useWaveBookSession.handleWbCreateSubmit payload exactly:
            //   { title, description, users: [{ owner }], metadata: { type,
            //     sessionId, scheduleId, category, subCategory, instituteId } }
            // We seed users with just the creator-as-owner; richer member sync
            // (instructors=editor, subscribers=viewer) needs classDetails which
            // Jitsi doesn't have. That can be filled in later via update or
            // pre-provisioned on the AAuti side.
            // Match useWaveBookSession.handleWbCreateSubmit:
            //   users = [owner, ...moderators-as-editors, ...members-as-viewers]
            // Members already de-duped server-side (jwt.context.metadata.members
            // excludes the requester so prepending them as 'owner' here doesn't
            // duplicate). See aautiUtil.js → generateJwtTokenForJitsi.
            const users: Array<{ userId: string; name: string; role: string; }> = [];

            if (userId) {
                users.push({ userId, name: userName, role: 'owner' });
            }
            members
                .filter(m => m.userId && m.userId !== userId)
                .forEach(m => {
                    users.push({
                        userId: m.userId,
                        name: m.name || '',
                        role: m.role
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
                dispatch(selectWhiteboardBoard(boardId) as any);
                onSelect?.();
            } else {
                setErrorMsg(json?.error || json?.message || 'Failed to create board');
            }
        } catch (err: any) {
            setErrorMsg(err?.message || 'Failed to create board');
        } finally {
            setSubmitting(false);
        }
    }, [ newBoardName, apiUrl, sessionId, category, subCategory, instituteId, userId, userName, members, headers, dispatch, onSelect ]);

    return (
        <div
            style = {{
                padding: 24,
                height: '100%',
                width: '100%',
                overflowY: 'auto',
                background: '#18181b',
                color: '#fafafa',
                boxSizing: 'border-box'
            }}>
            <div style = {{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style = {{ margin: 0, fontSize: 18 }}>Select a whiteboard</h2>
                <button
                    disabled = { loading }
                    onClick = { loadBoards }
                    style = {{
                        background: 'transparent',
                        color: '#a1a1aa',
                        border: '1px solid #3f3f46',
                        borderRadius: 6,
                        padding: '6px 12px',
                        cursor: 'pointer'
                    }}>
                    { loading ? 'Loading…' : 'Refresh' }
                </button>
            </div>

            { errorMsg && (
                <div style = {{ color: '#f87171', marginBottom: 12 }}>{ errorMsg }</div>
            )}

            <div
                style = {{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 16
                }}>
                <div
                    onClick = { () => setCreating(true) }
                    style = {{
                        ...cardStyle,
                        borderStyle: 'dashed',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center'
                    }}>
                    <div style = {{ fontSize: 28, lineHeight: 1 }}>+</div>
                    <div style = {{ marginTop: 8 }}>Add Whiteboard</div>
                    <div style = {{ color: '#a1a1aa', fontSize: 12, marginTop: 4 }}>Create new whiteboard</div>
                </div>

                { boards.map(b => (
                    <div
                        key = { b._id || b.id }
                        onClick = { () => handleSelect(b) }
                        style = { cardStyle }
                        title = { b.title || b.name || b._id || b.id }>
                        <div style = {{ fontWeight: 600 }}>{ b.title || b.name || 'Untitled' }</div>
                        { b.description && (
                            <div style = {{ color: '#d4d4d8', fontSize: 12, marginTop: 4 }}>
                                { b.description }
                            </div>
                        )}
                        <div style = {{ color: '#a1a1aa', fontSize: 11, marginTop: 6 }}>
                            { b.updatedAt ? `Updated ${new Date(b.updatedAt).toLocaleString()}` : (b._id || b.id) }
                        </div>
                    </div>
                ))}
            </div>

            { creating && (
                <div
                    style = {{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100
                    }}>
                    <div
                        style = {{
                            background: '#27272a',
                            padding: 24,
                            borderRadius: 8,
                            minWidth: 320
                        }}>
                        <div style = {{ marginBottom: 12, fontWeight: 600 }}>New Whiteboard</div>
                        <input
                            autoFocus = { true }
                            onChange = { e => setNewBoardName(e.target.value) }
                            placeholder = 'Board name'
                            style = {{
                                width: '100%',
                                padding: 8,
                                background: '#18181b',
                                color: '#fafafa',
                                border: '1px solid #3f3f46',
                                borderRadius: 4,
                                boxSizing: 'border-box'
                            }}
                            value = { newBoardName } />
                        <div style = {{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                                disabled = { submitting }
                                onClick = { () => { setCreating(false); setNewBoardName(''); } }
                                style = {{
                                    background: 'transparent',
                                    color: '#fafafa',
                                    border: '1px solid #3f3f46',
                                    borderRadius: 4,
                                    padding: '6px 14px',
                                    cursor: 'pointer'
                                }}>
                                Cancel
                            </button>
                            <button
                                disabled = { !newBoardName.trim() || submitting }
                                onClick = { handleCreate }
                                style = {{
                                    background: '#4f46e5',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '6px 14px',
                                    cursor: 'pointer'
                                }}>
                                { submitting ? 'Creating…' : 'Create' }
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WhiteboardPicker;