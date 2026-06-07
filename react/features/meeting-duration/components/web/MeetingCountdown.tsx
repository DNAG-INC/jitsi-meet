import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState } from '../../../app/types';
import { getLocalizedDurationFormatter } from '../../../base/i18n/dateUtil';
import Icon from '../../../base/icons/components/Icon';
import { IconWarningCircle } from '../../../base/icons/svg';
import { MEETING_END_WARNING_MS } from '../../constants';
import { getMeetingEndTimestamp } from '../../functions';

const useStyles = makeStyles()(theme => {
    return {
        countdown: {
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 252,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '24px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: theme.palette.warning01,
            ...theme.typography.bodyShortBold,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
            pointerEvents: 'none'
        },

        icon: {
            display: 'flex'
        }
    };
});

/**
 * Teams-style banner that shows a live countdown during the final minutes of a
 * time-limited meeting. Renders nothing until the meeting is within the warning
 * window and hides again once the limit is reached.
 *
 * @returns {ReactElement | null}
 */
const MeetingCountdown = () => {
    const { classes } = useStyles();
    const { t } = useTranslation();
    const endTimestamp = useSelector((state: IReduxState) => getMeetingEndTimestamp(state));
    const [ remaining, setRemaining ] = useState(endTimestamp ? endTimestamp - Date.now() : Infinity);
    const interval = useRef<number>();

    useEffect(() => {
        if (interval.current) {
            clearInterval(interval.current);
            interval.current = undefined;
        }

        if (!endTimestamp) {
            setRemaining(Infinity);

            return;
        }

        const tick = () => setRemaining(endTimestamp - Date.now());

        tick();
        interval.current = window.setInterval(tick, 1000);

        return () => {
            if (interval.current) {
                clearInterval(interval.current);
                interval.current = undefined;
            }
        };
    }, [ endTimestamp ]);

    if (remaining <= 0 || remaining > MEETING_END_WARNING_MS) {
        return null;
    }

    return (
        <div className = { classes.countdown }>
            <Icon
                className = { classes.icon }
                size = { 18 }
                src = { IconWarningCircle } />
            <span>{ t('meetingDuration.countdownLabel', { time: getLocalizedDurationFormatter(remaining) }) }</span>
        </div>
    );
};

export default MeetingCountdown;
