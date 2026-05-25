import React, { useEffect } from 'react';
import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import AudioTrack from '../../../base/media/components/web/AudioTrack';
import { MEDIA_TYPE } from '../../../base/media/constants';
import { ITrack } from '../../../base/tracks/types';

/**
 * The type of the React {@code Component} props of {@link AudioTracksContainer}.
 */
interface IProps {

    /**
     * Whether the participants pane is currently open.
     */
    _participantsPaneOpen: boolean;

    /**
     * Whether PiP mode is currently active.
     */
    _pipActive: boolean;

    /**
     * All media tracks stored in redux.
     */
    _tracks: ITrack[];
}

/**
 * Defensive: some browsers silently pause remote `<audio>` elements when the
 * window is backgrounded (PiP active) and a layout reflow happens around the
 * same time — e.g. the user opens the participants pane while PiP is active.
 * Nothing in our code detaches or mutes those elements, but the browser's
 * autoplay / hidden-document policy can leave them in a paused state.
 *
 * This effect re-plays any paused remote audio element whenever a potentially
 * disruptive event fires (visibility change, focus, fullscreen change, PiP
 * enter/leave) and once when the relevant Redux state changes. Cheap and safe:
 * if an element is already playing, `.play()` is a no-op; if autoplay is
 * blocked the `.catch()` swallows the rejection.
 */
function useForcePlayRemoteAudio(deps: readonly unknown[]) {
    useEffect(() => {
        const forcePlay = () => {
            const audios = document.querySelectorAll<HTMLAudioElement>(
                'audio[id^="remoteAudio_"]'
            );

            audios.forEach(a => {
                if (a.paused) {
                    a.play().catch(() => { /* autoplay still blocked; nothing to do */ });
                }
            });
        };

        // Nudge immediately on the dep change (e.g. participants pane toggled).
        forcePlay();

        document.addEventListener('fullscreenchange', forcePlay);
        document.addEventListener('visibilitychange', forcePlay);
        window.addEventListener('focus', forcePlay);

        // External trigger from the AAuti marketplace parent. The marketplace
        // toggles its own "mini PIP" via a CSS class on the iframe container;
        // browser PiP events do NOT fire for that path. The parent posts a
        // message on every PIP-class transition so we can recover audio that
        // the browser may have paused due to the iframe resize.
        const onParentMessage = (e: MessageEvent) => {
            if (e.data?.source === 'aauti-marketplace' && e.data?.type === 'pip-mode-changed') {
                forcePlay();
            }
        };

        window.addEventListener('message', onParentMessage);

        const pipVideo = document.getElementById('pipVideo') as HTMLVideoElement | null;

        pipVideo?.addEventListener('enterpictureinpicture', forcePlay);
        pipVideo?.addEventListener('leavepictureinpicture', forcePlay);

        return () => {
            document.removeEventListener('fullscreenchange', forcePlay);
            document.removeEventListener('visibilitychange', forcePlay);
            window.removeEventListener('focus', forcePlay);
            window.removeEventListener('message', onParentMessage);
            pipVideo?.removeEventListener('enterpictureinpicture', forcePlay);
            pipVideo?.removeEventListener('leavepictureinpicture', forcePlay);
        };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

/**
 * A container for the remote tracks audio elements.
 *
 * @param {IProps} props - The props of the component.
 * @returns {Array<ReactElement>}
 */
function AudioTracksContainer(props: IProps) {
    const { _tracks, _pipActive, _participantsPaneOpen } = props;
    const remoteAudioTracks = _tracks.filter(t => !t.local && t.mediaType === MEDIA_TYPE.AUDIO);

    useForcePlayRemoteAudio([ _pipActive, _participantsPaneOpen, remoteAudioTracks.length ]);

    return (
        <div>
            {
                remoteAudioTracks.map(t => {
                    const { jitsiTrack, participantId } = t;
                    const audioTrackId = jitsiTrack?.getId();
                    const id = `remoteAudio_${audioTrackId || ''}`;

                    return (
                        <AudioTrack
                            audioTrack = { t }
                            id = { id }
                            key = { id }
                            participantId = { participantId } />
                    );
                })
            }
        </div>
    );
}

/**
 * Maps (parts of) the Redux state to the associated {@code AudioTracksContainer}'s props.
 *
 * @param {Object} state - The Redux state.
 * @private
 * @returns {IProps}
 */
function _mapStateToProps(state: IReduxState) {
    // NOTE: The disadvantage of this approach is that the component will re-render on any track change.
    // One way to solve the problem would be to pass only the participant ID to the AudioTrack component and
    // find the corresponding track inside the AudioTrack's mapStateToProps. But currently this will be very
    // inefficient because features/base/tracks is an array and in order to find a track by participant ID
    // we need to go through the array. Introducing a map participantID -> track could be beneficial in this case.
    return {
        _tracks: state['features/base/tracks'],
        _pipActive: state['features/pip']?.isPiPActive ?? false,
        _participantsPaneOpen: state['features/participants-pane']?.isOpen ?? false
    };
}

export default connect(_mapStateToProps)(AudioTracksContainer);
