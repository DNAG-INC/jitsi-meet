import ReducerRegistry from '../base/redux/ReducerRegistry';

import { RESET_WHITEBOARD, SETUP_WHITEBOARD, SET_WHITEBOARD_OPEN } from './actionTypes';

export interface IWhiteboardState {

    /**
     * The title of the selected WaveBook board, shown in the panel header.
     */
    boardTitle?: string;

    /**
     * The whiteboard collaboration details.
     */
    collabDetails?: { roomId: string; roomKey: string; };

    /**
     * The whiteboard collaboration url.
     */
    collabServerUrl?: string;

    /**
     * The indicator which determines whether the whiteboard is open.
     *
     * @type {boolean}
     */
    isOpen: boolean;

}

const DEFAULT_STATE: IWhiteboardState = {
    isOpen: false,
    collabDetails: undefined,
    collabServerUrl: undefined,
    boardTitle: undefined
};

export interface IWhiteboardAction extends Partial<IWhiteboardState> {

    /**
     * The title of the selected WaveBook board.
     */
    boardTitle?: string;

    /**
     * The whiteboard collaboration details.
     */
    collabDetails?: { roomId: string; roomKey: string; };

    /**
     * The whiteboard collaboration url.
     */
    collabServerUrl?: string;

    /**
     * The action type.
     */
    type: string;

    /**
     * Whether the action was triggered by a user interaction.
     */
    userInitiated?: boolean;
}

ReducerRegistry.register(
    'features/whiteboard',
    (state: IWhiteboardState = DEFAULT_STATE, action: IWhiteboardAction) => {
        switch (action.type) {
        case SETUP_WHITEBOARD: {
            return {
                ...state,
                collabDetails: action.collabDetails,
                collabServerUrl: action.collabServerUrl,
                boardTitle: action.boardTitle
            };
        }
        case SET_WHITEBOARD_OPEN: {
            return {
                ...state,
                isOpen: Boolean(action.isOpen)
            };
        }
        case RESET_WHITEBOARD:
            return DEFAULT_STATE;
        }

        return state;
    });
