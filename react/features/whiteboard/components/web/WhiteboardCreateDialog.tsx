import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Dialog from '../../../base/ui/components/web/Dialog';
import Input from '../../../base/ui/components/web/Input';
import { BOARD_NAME_MAX_LENGTH, BOARD_NAME_MIN_LENGTH } from '../../constants';

interface IProps {

    /**
     * Called with the trimmed board name when the dialog is submitted.
     */
    onSubmit: (title: string) => void;
}

/**
 * Dialog that collects the name for a new whiteboard.
 *
 * @returns {JSX.Element}
 */
const WhiteboardCreateDialog = ({ onSubmit }: IProps) => {
    const { t } = useTranslation();
    const [ name, setName ] = useState('');
    const length = name.trim().length;
    const isValid = length >= BOARD_NAME_MIN_LENGTH;

    const handleSubmit = useCallback(() => onSubmit(name.trim()), [ name, onSubmit ]);

    return (
        <Dialog
            ok = {{
                disabled: !isValid,
                translationKey: 'whiteboard.createBoard'
            }}
            onSubmit = { handleSubmit }
            size = 'medium'
            titleKey = 'whiteboard.createBoardTitle'>
            <Input
                autoFocus = { true }
                bottomLabel = { t('whiteboard.boardNameHint', {
                    length,
                    max: BOARD_NAME_MAX_LENGTH,
                    min: BOARD_NAME_MIN_LENGTH
                }) }
                error = { !isValid }
                id = 'whiteboard-board-name'
                label = { t('whiteboard.boardNameLabel') }
                maxLength = { BOARD_NAME_MAX_LENGTH }
                onChange = { setName }
                value = { name } />
        </Dialog>
    );
};

export default WhiteboardCreateDialog;
