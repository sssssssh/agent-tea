import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface ComposerProps {
    onSubmit: (query: string) => void;
    disabled?: boolean;
    placeholder?: string;
}

export function Composer({
    onSubmit,
    disabled = false,
    placeholder = '输入你的问题...',
}: ComposerProps) {
    const [value, setValue] = useState('');

    const handleSubmit = (text: string) => {
        const trimmed = text.trim();
        if (trimmed && !disabled) {
            onSubmit(trimmed);
            setValue('');
        }
    };

    return (
        <Box borderStyle="single" paddingX={1}>
            <Text color={disabled ? 'gray' : 'white'}>&gt; </Text>
            <TextInput
                value={value}
                onChange={setValue}
                onSubmit={handleSubmit}
                placeholder={disabled ? '等待响应...' : placeholder}
            />
        </Box>
    );
}
