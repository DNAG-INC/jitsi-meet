import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { WithTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

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
    const { defaultRemoteDisplayName, whiteboard } = useSelector((state: IReduxState) => state['features/base/config']);
    const localParticipant = useSelector(getLocalParticipant);
    const isLocalModerator = useSelector(isLocalParticipantModerator);
    const jwtCtx = useSelector(getWaveBookJwtContext);
    const localParticipantId = localParticipant?.id || '';
    const localParticipantName = jwtCtx?.userName || localParticipant?.name || defaultRemoteDisplayName || 'Fellow Jitster';

    const collabServerBaseUrl = whiteboard?.collabServerBaseUrl;
    const apiKey = whiteboard?.apiKey;
    const boardId = collabDetails?.roomId;
    const userId = jwtCtx?.userId || localParticipantId;

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
    const showIframe = !forcePicker && Boolean(collabServerBaseUrl) && Boolean(boardId);
    const embedUrl = showIframe
        ? `${collabServerBaseUrl!.replace(/\/$/, '')}/embed/${boardId}`
            + `?userId=${encodeURIComponent(userId)}`
            + `&userName=${encodeURIComponent(localParticipantName || '')}`
            + (apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : '')
        : '';

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
                        { embedUrl
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
                                        <div style = {{ fontWeight: 600 }}>Whiteboard</div>
                                    </div>
                                    <iframe
                                        allow = 'clipboard-write; fullscreen'
                                        allowFullScreen = { true }
                                        src = { embedUrl }
                                        style = {{
                                            border: 0,
                                            flex: '1 1 auto',
                                            width: '100%'
                                        }}
                                        title = 'Whiteboard' />
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