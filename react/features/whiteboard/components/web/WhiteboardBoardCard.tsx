import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { makeStyles } from 'tss-react/mui';

import { IBoard } from '../../types';

import { getWhiteboardCardStyles } from './styles';

const useStyles = makeStyles()(theme => {
    return {
        card: getWhiteboardCardStyles(theme),

        title: {
            ...theme.typography.bodyShortBold,

            // Board names created before the length cap must wrap inside the card, not spill out.
            overflowWrap: 'anywhere'
        },

        description: {
            ...theme.typography.bodyShortRegularSmall,
            color: theme.palette.text02,
            marginTop: '4px'
        },

        // text03 on the card background is 3.97:1 — under the 4.5:1 bar at this size.
        meta: {
            ...theme.typography.bodyShortRegularSmall,
            color: theme.palette.text02,
            marginTop: '6px'
        }
    };
});

interface IProps {

    /**
     * The board this tile represents.
     */
    board: IBoard;

    /**
     * Called with the board when the tile is activated.
     */
    onSelect: (board: IBoard) => void;
}

/**
 * A single selectable board in the whiteboard picker grid.
 *
 * @param {IProps} props - The component props.
 * @returns {JSX.Element}
 */
const WhiteboardBoardCard = ({ board, onSelect }: IProps) => {
    const { classes } = useStyles();
    const { t } = useTranslation();
    const fallbackId = board._id || board.id;

    const handleClick = useCallback(() => onSelect(board), [ board, onSelect ]);

    return (
        <button
            className = { classes.card }
            onClick = { handleClick }
            title = { board.title || board.name || fallbackId }
            type = 'button'>
            <span className = { classes.title }>
                { board.title || board.name || t('whiteboard.untitledBoard') }
            </span>
            { board.description && (
                <span className = { classes.description }>{ board.description }</span>
            )}
            <span className = { classes.meta }>
                { board.updatedAt
                    ? t('whiteboard.updatedAt', { date: new Date(board.updatedAt).toLocaleString() })
                    : fallbackId }
            </span>
        </button>
    );
};

export default WhiteboardBoardCard;
