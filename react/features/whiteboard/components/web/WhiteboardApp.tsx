import React, { ComponentType } from 'react';

import BaseApp from '../../../base/app/components/BaseApp';
import GlobalStyles from '../../../base/ui/components/GlobalStyles.web';
import JitsiThemeProvider from '../../../base/ui/components/JitsiThemeProvider.web';
import { decodeFromBase64URL } from '../../../base/util/httpUtils';
import { parseURLParams } from '../../../base/util/parseURLParams';
import { safeDecodeURIComponent } from '../../../base/util/uri';
import logger from '../../logger';

import NoWhiteboardError from './NoWhiteboardError';
import WhiteboardErrorBoundary from './WhiteboardErrorBoundary';
import WhiteboardWrapper from './WhiteboardWrapper';

/**
 * Wrapper application for the whiteboard.
 *
 * @augments BaseApp
 */
export default class WhiteboardApp extends BaseApp<any> {
    /**
     * Navigates to {@link Whiteboard} upon mount.
     *
     * @returns {void}
     */
    override async componentDidMount() {
        await super.componentDidMount();

        // This page is driven entirely by a base64url-encoded `state` query
        // param. A missing or malformed one threw right here, and because this
        // method is async that surfaced as an unhandled rejection rather than
        // an error: _navigate was never reached, so the page stayed blank
        // forever with nothing logged in the UI. Fall through to the error
        // component instead of dying silently.
        let decodedState: any;

        try {
            const { state } = parseURLParams(window.location.href, true);

            decodedState = JSON.parse(decodeFromBase64URL(state));
        } catch (e: any) {
            logger.error('Couldn\'t parse the whiteboard state from the URL.', e);
        }

        const { collabServerUrl, localParticipantName } = decodedState ?? {};
        let { roomId, roomKey } = decodedState ?? {};

        if (!roomId && !roomKey) {
            try {
                const { generateCollaborationLinkData } = await import(
                    /* webpackChunkName: "excalidraw" */ '@jitsi/excalidraw'
                );
                const collabDetails = await generateCollaborationLinkData();

                roomId = collabDetails.roomId;
                roomKey = collabDetails.roomKey;

                if (window.ReactNativeWebView) {
                    setTimeout(() => {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            collabDetails,
                            collabServerUrl
                        }));
                    }, 0);
                }
            } catch (e: any) {
                logger.error('Couldn\'t generate collaboration link data.', e);
            }
        }

        super._navigate({
            component: () => (

                // BaseApp's own boundary only logs and renders no fallback, so
                // a throw below unmounts the root and leaves a blank page. No
                // conference is at stake here (this page runs standalone, in
                // the native WebView or the second-screen iframe), but the
                // failure is just as invisible, so guard it the same way.
                <WhiteboardErrorBoundary fallback = { <NoWhiteboardError className = 'whiteboard' /> }>
                    {
                        roomId && roomKey && collabServerUrl
                            ? <WhiteboardWrapper
                                className = 'whiteboard'
                                collabDetails = {{
                                    roomId,
                                    roomKey
                                }}
                                collabServerUrl = { safeDecodeURIComponent(collabServerUrl) }
                                localParticipantName = { localParticipantName } />
                            : <NoWhiteboardError className = 'whiteboard' />
                    }
                </WhiteboardErrorBoundary>
            ) });
    }

    /**
     * Overrides the parent method to inject {@link AtlasKitThemeProvider} as
     * the top most component.
     *
     * @override
     */
    override _createMainElement(component: ComponentType<any>, props: Object) {
        return (
            <JitsiThemeProvider>
                <GlobalStyles />
                {super._createMainElement(component, props)}
            </JitsiThemeProvider>
        );
    }

    /**
     * Renders the platform specific dialog container.
     *
     * @returns {React$Element}
     */
    override _renderDialogContainer() {
        return null;
    }
}
