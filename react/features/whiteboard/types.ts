
/**
 * Whiteboard statuses used to raise the notification when it's changed.
 *
 * @enum
 */
export enum WhiteboardStatus {
    FORBIDDEN = 'FORBIDDEN',
    HIDDEN = 'HIDDEN',
    INSTANTIATED = 'INSTANTIATED',
    RESET = 'RESET',
    SHOWN = 'SHOWN'
}

/**
 * A board as returned by the WaveBook whiteboard service. Field names vary by
 * endpoint, so both the Mongo-style and the plain spellings are accepted.
 */
export interface IBoard {
    _id?: string;
    description?: string;
    id?: string;
    name?: string;
    title?: string;
    updatedAt?: string;
}
