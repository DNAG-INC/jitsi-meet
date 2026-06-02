import clsx from 'clsx';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { WithTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

// Lazy-load the WaveBook SDK so the ~310 KB bundle only ships when a
// participant actually opens the whiteboard. Same-origin embed (replaces
// the previous cross-origin iframe) so screen-recording / tab-capture
// sees the canvas pixels — fixing the "blank whiteboard in recordings"
// bug that was the original driver of this migration.
const WhiteboardEmbed = lazy(() =>
    import('@aauti/whiteboard-sdk').then(m => ({ default: m.WhiteboardEmbed }))
);
// SDK ships a self-contained stylesheet scoped under `.wavebook-sdk` so
// Jitsi's own CSS (and vice versa) can't override the board's look.
import '@aauti/whiteboard-sdk/styles.css';

// @ts-expect-error
import Filmstrip from '../../../../../modules/UI/videolayout/Filmstrip';
import { IReduxState } from '../../../app/types';
import { translate } from '../../../base/i18n/functions';
import { getLocalParticipant, isLocalParticipantModerator } from '../../../base/participants/functions';
import { getVerticalViewMaxWidth } from '../../../filmstrip/functions.web';
import { getToolboxHeight } from '../../../toolbox/functions.web';
import { shouldDisplayTileView } from '../../../video-layout/functions.any';
import {
    getCollabDetails,
    getWaveBookJwtContext,
    isWhiteboardOpen,
    isWhiteboardVisible
} from '../../functions';
import WhiteboardPicker from './WhiteboardPicker';

/**
 * Space taken by meeting elements like the subject and the watermark.
 */
const HEIGHT_OFFSET = 80;

interface IDimensions {

    /* The height of the component. */
    height: string;

    /* The width of the component. */
    width: string;
}

/**
 * The Whiteboard component.
 * Renders the AAuti WaveBook embed in place of the default Excalidraw whiteboard.
 *
 * @param {Props} props - The React props passed to this component.
 * @returns {JSX.Element} - The React component.
 */
const Whiteboard = (props: WithTranslation): JSX.Element => {
    const isOpen = useSelector(isWhiteboardOpen);
    const isVisible = useSelector(isWhiteboardVisible);
    const isInTileView = useSelector(shouldDisplayTileView);
    const { clientHeight, videoSpaceWidth } = useSelector((state: IReduxState) => state['features/base/responsive-ui']);
    const { visible: filmstripVisible, isResizing: isFilmstripResizing } = useSelector((state: IReduxState) => state['features/filmstrip']);
    const isChatResizing = useSelector((state: IReduxState) => state['features/chat'].isResizing);
    const isResizing = isFilmstripResizing || isChatResizing;
    const filmstripWidth: number = useSelector(getVerticalViewMaxWidth);
    const collabDetails = useSelector(getCollabDetails);
    const boardTitle = useSelector((state: IReduxState) => state['features/whiteboard'].boardTitle);
    const { defaultRemoteDisplayName, whiteboard } = useSelector((state: IReduxState) => state['features/base/config']);
    const localParticipant = useSelector(getLocalParticipant);
    const isLocalModerator = useSelector(isLocalParticipantModerator);
    const jwtCtx = useSelector(getWaveBookJwtContext);
    const localParticipantId = localParticipant?.id || '';
    const localParticipantName = jwtCtx?.userName || localParticipant?.name || defaultRemoteDisplayName || 'Fellow Jitster';

    const collabServerBaseUrl = whiteboard?.collabServerBaseUrl;
    // REST host — distinct from the legacy iframe-page URL above. The SDK's
    // api-client (resolveEmbedUser, comments, snapshots, members) and socket
    // both target the API host. Falling back to collabServerBaseUrl preserves
    // the picker-only behaviour for configs that only set the iframe URL.
    const apiBaseUrl = whiteboard?.apiUrl || collabServerBaseUrl;
    const apiKey = whiteboard?.apiKey;
    const boardId = collabDetails?.roomId;
    const userId = jwtCtx?.userId || localParticipantId;
    const userAvatar = localParticipant?.avatarURL || '';

    // Local "show picker" override so the moderator can navigate back to the
    // board list without affecting other participants. Cleared whenever a new
    // board id arrives (picker selection) so the iframe shows again.
    const [ forcePicker, setForcePicker ] = useState(false);
    const prevBoardIdRef = useRef<string | undefined>(boardId);

    useEffect(() => {
        if (boardId && boardId !== prevBoardIdRef.current) {
            setForcePicker(false);
        }
        prevBoardIdRef.current = boardId;
    }, [ boardId ]);

    /**
    * Computes the width and the height of the component.
    *
    * @returns {IDimensions} - The dimensions of the component.
    */
    const getDimensions = (): IDimensions => {
        let width: number;
        let height: number;

        if (interfaceConfig.VERTICAL_FILMSTRIP) {
            if (filmstripVisible) {
                width = videoSpaceWidth - filmstripWidth;
            } else {
                width = videoSpaceWidth;
            }
            height = clientHeight - getToolboxHeight();
        } else {
            if (filmstripVisible) {
                height = clientHeight - Filmstrip.getFilmstripHeight();
            } else {
                height = clientHeight;
            }
            width = videoSpaceWidth;
        }

        return {
            width: `${width}px`,
            height: `${height - HEIGHT_OFFSET}px`
        };
    };

    // Both moderators and non-moderators can navigate between picker and
    // iframe via the back button. Non-moderators picking a different board
    // only affects their local view (no metadata broadcast). If the moderator
    // later picks another board, the [boardId] effect above snaps everyone
    // back to that board.
    // Same gating the legacy iframe used — only render the SDK embed when
    // we have everything needed to connect. The picker is still shown
    // otherwise (user must select a board first), so this stays as a
    // boolean rather than an embed-URL string.
    const showBoard = !forcePicker && Boolean(collabServerBaseUrl) && Boolean(boardId);

    return (
        <div
            className = { clsx(
                isResizing && 'disable-pointer',
                'whiteboard-container'
            ) }
            style = {{
                ...getDimensions(),
                marginTop: `${HEIGHT_OFFSET}px`,
                display: `${isInTileView || !isVisible ? 'none' : 'block'}`
            }}>
            {
                isOpen && (
                    <div className = 'excalidraw-wrapper'>
                        <span
                            aria-level = { 1 }
                            className = 'sr-only'
                            role = 'heading'>
                            { props.t('whiteboard.accessibilityLabel.heading') }
                        </span>
                        { showBoard
                            ? (
                                <div style = {{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
                                    <div
                                        style = {{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '8px 12px',
                                            background: '#18181b',
                                            color: '#fafafa',
                                            borderBottom: '1px solid #3f3f46',
                                            flex: '0 0 auto'
                                        }}>
                                        <button
                                            aria-label = 'Back to whiteboard list'
                                            onClick = { () => setForcePicker(true) }
                                            style = {{
                                                background: 'transparent',
                                                color: '#3083EF',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: 18,
                                                padding: '4px 8px',
                                                lineHeight: 1,
                                                fontWeight: 600
                                            }}>
                                            ←
                                        </button>
                                        <div style = {{ fontWeight: 600 }}>{ boardTitle || 'Whiteboard' }</div>
                                    </div>
                                    <Suspense fallback = {
                                        <div
                                            style = {{
                                                flex: '1 1 auto',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#9CA3AF',
                                                fontSize: 13,
                                                background: '#fff'
                                            }}>
                                            Loading whiteboard…
                                        </div>
                                    }>
                                        <div style = {{
                                            flex: '1 1 auto',
                                            width: '100%',
                                            position: 'relative',
                                            // Clip any SDK content overflow to the whiteboard-container's
                                            // fixed height. Pencil/Marker Properties panels are taller than
                                            // the 444px container Jitsi assigns; without this clip, the SDK's
                                            // floating bottom toolbar gets pushed below the visible area
                                            // and Jitsi's own toolbox overlaps the canvas. Proper fix lives
                                            // in the SDK (PropsPanel should scroll internally); this is the
                                            // host-side safety net.
                                            overflow: 'hidden'
                                        }}>
                                            <WhiteboardEmbed
                                                boardId = { boardId! }
                                                user = {{
                                                    id: userId,
                                                    name: localParticipantName,
                                                    avatarUrl: userAvatar || undefined,
                                                    role: 'editor'
                                                }}
                                                connection = {{
                                                    // REST + WS both target the API host (whiteboard-
                                                    // apiqa.aauti.com), NOT the iframe-page host
                                                    // (whiteboard-qa.aauti.com) — the latter doesn't
                                                    // serve `/api/...` and returns 404 on the embed-gate
                                                    // OPTIONS preflight, which is what was tripping us.
                                                    apiBaseUrl: apiBaseUrl!,
                                                    wsBaseUrl: apiBaseUrl!,
                                                    apiKey: apiKey || ''
                                                }}
                                                style = {{ width: '100%', height: '100%' }}
                                                onError = { e =>
                                                    // Surface to console for now; can wire to Jitsi's
                                                    // notification toast in a follow-up.
                                                    // eslint-disable-next-line no-console
                                                    console.error('[wavebook-sdk]', e.code, e.message)
                                                } />
                                        </div>
                                    </Suspense>
                                </div>
                            )
                            : (
                                <WhiteboardPicker
                                    canCreate = { isLocalModerator }
                                    onSelect = { () => setForcePicker(false) } />
                            )
                        }
                    </div>
                )
            }
        </div>
    );
};

export default translate(Whiteboard);