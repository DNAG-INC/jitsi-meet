import { Theme } from '@mui/material';

/**
 * Returns the chrome shared by every tile in the whiteboard picker grid.
 *
 * @param {Theme} theme - The current theme.
 * @returns {Object}
 */
export function getWhiteboardCardStyles(theme: Theme) {
    return {
        ...theme.typography.bodyShortRegular,
        backgroundColor: theme.palette.ui02,
        border: `1px solid ${theme.palette.ui03}`,
        borderRadius: `${theme.shape.borderRadius}px`,
        color: theme.palette.text01,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column' as const,
        justifyContent: 'space-between',
        minHeight: '120px',
        overflow: 'hidden',
        padding: '16px',
        textAlign: 'left' as const,

        '&:hover': {
            backgroundColor: theme.palette.ui03
        }
    };
}
