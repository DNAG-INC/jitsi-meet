import React from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';

/**
 * Whiteboard wrapper.
 * Renders the AAuti WaveBook embed in place of the default Excalidraw whiteboard.
 *
 * @returns {JSX.Element}
 */
const WhiteboardWrapper = ({
    className,
    collabDetails,
    localParticipantName
}: {
    className?: string;
    collabDetails: {
        roomId: string;
        roomKey: string;
    };
    collabServerUrl: string;
    localParticipantName: string;
}) => {
    const { collabServerBaseUrl, apiKey } = useSelector(
        (state: IReduxState) => state['features/base/config'].whiteboard || {}
    );

    if (!collabServerBaseUrl) {
        return null;
    }

    const base = collabServerBaseUrl.replace(/\/$/, '');
    const embedUrl = `${base}/embed/${collabDetails.roomId}`
        + `?userId=${encodeURIComponent(localParticipantName || '')}`
        + `&userName=${encodeURIComponent(localParticipantName || '')}`
        + (apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : '');

    return (
        <div className = { className }>
            <iframe
                allow = 'clipboard-write; fullscreen'
                allowFullScreen = { true }
                src = { embedUrl }
                style = {{
                    border: 0,
                    height: '100%',
                    width: '100%'
                }}
                title = 'Whiteboard' />
        </div>
    );
};

export default WhiteboardWrapper;
