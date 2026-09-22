import { Component, ErrorInfo, ReactNode } from 'react';

import logger from '../../logger';

/**
 * The type of the React {@code Component} props of
 * {@link WhiteboardErrorBoundary}.
 */
interface IProps {

    /**
     * The whiteboard subtree to guard.
     */
    children: ReactNode;

    /**
     * Rendered in place of {@code children} once a descendant has thrown.
     */
    fallback: ReactNode;
}

/**
 * The type of the React {@code Component} state of
 * {@link WhiteboardErrorBoundary}.
 */
interface IState {

    /**
     * Whether a descendant has thrown and the fallback should be shown.
     */
    hasError: boolean;
}

/**
 * Contains whiteboard failures so they cannot end the conference.
 *
 * The whiteboard renders under {@code LargeVideo} inside {@code Conference},
 * and before this boundary existed the nearest one was {@code BaseApp} - which
 * only logs and renders no fallback. React therefore unmounted everything
 * below it, including {@code Conference}, whose {@code componentWillUnmount}
 * calls {@code hangup()}. A render error in the board, or a failed lazy-load
 * of the SDK chunk, consequently dropped the participant from the call: the
 * conference ended with a clean client-initiated leave and no server-side
 * error anywhere, which is what made it so hard to trace.
 *
 * Implementing {@code getDerivedStateFromError} is what actually fixes that:
 * it swaps in the fallback on the same render pass that threw, so React
 * unmounts only the board and leaves the conference above it untouched.
 *
 * @augments Component
 */
export default class WhiteboardErrorBoundary extends Component<IProps, IState> {
    /**
     * Initializes a new {@code WhiteboardErrorBoundary} instance.
     *
     * @param {IProps} props - The React {@code Component} props to initialize
     * the new {@code WhiteboardErrorBoundary} instance with.
     */
    constructor(props: IProps) {
        super(props);

        this.state = { hasError: false };
    }

    /**
     * Swaps in the fallback on the render pass that threw, which is what keeps
     * React from unmounting the conference along with the board.
     *
     * @returns {IState}
     */
    static getDerivedStateFromError(): IState {
        return { hasError: true };
    }

    /**
     * Implements React's {@link Component#componentDidCatch()}.
     *
     * The board's own {@code onError} only covers failures the SDK reports
     * itself; this is the only place a throw from its render tree is recorded.
     *
     * @param {Error} error - The error that was thrown.
     * @param {ErrorInfo} info - The React component stack for the error.
     * @returns {void}
     */
    override componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error(
            'Whiteboard threw; keeping the conference alive and showing the fallback.',
            error,
            info.componentStack
        );
    }

    /**
     * Implements React's {@link Component#render()}.
     *
     * @returns {ReactNode}
     */
    override render() {
        return this.state.hasError ? this.props.fallback : this.props.children;
    }
}
