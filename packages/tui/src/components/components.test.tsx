import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { UserMessage } from './UserMessage.js';
import { AgentMessage } from './AgentMessage.js';
import { StatusBar } from './StatusBar.js';
import { ToolCallCard } from './ToolCallCard.js';
import { ApprovalDialog } from './ApprovalDialog.js';
import { PlanView } from './PlanView.js';
import { ErrorMessage } from './ErrorMessage.js';
import { History } from './History.js';
import { ComponentProvider } from './component-context.js';
import type { ComponentMap } from './component-context.js';
import type { HistoryItem } from '../adapter/types.js';

const defaultComponents: ComponentMap = {
    userMessage: UserMessage,
    agentMessage: AgentMessage,
    toolCallCard: ToolCallCard,
    approvalDialog: ApprovalDialog,
    planView: PlanView,
    errorMessage: ErrorMessage,
    statusBar: StatusBar,
};

function renderWithComponents(ui: React.ReactElement) {
    return render(
        <ComponentProvider components={defaultComponents}>{ui}</ComponentProvider>,
    );
}

describe('UserMessage', () => {
    it('should render user content with label', () => {
        const { lastFrame } = render(<UserMessage content="你好世界" />);
        expect(lastFrame()).toContain('You');
        expect(lastFrame()).toContain('你好世界');
    });
});

describe('AgentMessage', () => {
    it('should render assistant content', () => {
        const { lastFrame } = render(<AgentMessage content="这是回复" />);
        expect(lastFrame()).toContain('这是回复');
    });

    it('should show cursor when streaming', () => {
        const { lastFrame } = render(<AgentMessage content="正在输出" streaming />);
        expect(lastFrame()).toContain('正在输出');
        expect(lastFrame()).toContain('▊');
    });

    it('should not show cursor when not streaming', () => {
        const { lastFrame } = render(<AgentMessage content="完成" />);
        expect(lastFrame()).not.toContain('▊');
    });
});

describe('StatusBar', () => {
    it('should render status and usage', () => {
        const { lastFrame } = render(
            <StatusBar status="thinking" usage={{ inputTokens: 100, outputTokens: 50 }} />,
        );
        expect(lastFrame()).toContain('thinking');
        expect(lastFrame()).toContain('150');
    });

    it('should render idle status', () => {
        const { lastFrame } = render(
            <StatusBar status="idle" usage={{ inputTokens: 0, outputTokens: 0 }} />,
        );
        expect(lastFrame()).toContain('idle');
    });
});

describe('ToolCallCard', () => {
    it('should render tool name and duration in collapsed state', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="readFile"
                args={{ path: 'src/index.ts' }}
                result="file content here"
                isError={false}
                durationMs={320}
            />,
        );
        expect(lastFrame()).toContain('readFile');
        expect(lastFrame()).toContain('0.3s');
        expect(lastFrame()).not.toContain('file content here');
    });

    it('should show args and result when expanded', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="readFile"
                args={{ path: 'src/index.ts' }}
                result="file content here"
                isError={false}
                durationMs={150}
                expanded
            />,
        );
        expect(lastFrame()).toContain('readFile');
        expect(lastFrame()).toContain('src/index.ts');
        expect(lastFrame()).toContain('file content here');
    });

    it('should highlight error state', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="executeShell"
                args={{ command: 'rm -rf /' }}
                result="Permission denied"
                isError={true}
                durationMs={50}
                expanded
            />,
        );
        expect(lastFrame()).toContain('Permission denied');
    });
});

describe('ApprovalDialog', () => {
    it('should render tool name and args', () => {
        const { lastFrame } = render(
            <ApprovalDialog
                request={{
                    type: 'approval_request',
                    requestId: 'r1',
                    toolName: 'writeFile',
                    args: { path: '/tmp/test.txt', content: 'hello' },
                    toolDescription: 'Write a file',
                }}
                onApprove={() => {}}
                onReject={() => {}}
            />,
        );
        expect(lastFrame()).toContain('writeFile');
        expect(lastFrame()).toContain('/tmp/test.txt');
        expect(lastFrame()).toContain('[Y]');
        expect(lastFrame()).toContain('[N]');
    });
});

describe('PlanView', () => {
    it('should render steps with status icons', () => {
        const { lastFrame } = render(
            <PlanView
                steps={[
                    {
                        index: 0,
                        description: 'Read files',
                        status: 'completed',
                        result: { summary: 'done', toolCallCount: 2 },
                    },
                    { index: 1, description: 'Write code', status: 'executing' },
                    { index: 2, description: 'Run tests', status: 'pending' },
                ]}
            />,
        );
        expect(lastFrame()).toContain('Read files');
        expect(lastFrame()).toContain('Write code');
        expect(lastFrame()).toContain('Run tests');
    });
});

describe('ErrorMessage', () => {
    it('should render fatal error', () => {
        const { lastFrame } = render(
            <ErrorMessage message="API rate limit" fatal={true} />,
        );
        expect(lastFrame()).toContain('API rate limit');
        expect(lastFrame()).toContain('Fatal');
    });
});

describe('History', () => {
    it('should render message items', () => {
        const items: HistoryItem[] = [
            { type: 'message', role: 'user', content: '你好' },
            { type: 'message', role: 'assistant', content: '你好！有什么可以帮你？' },
        ];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('你好');
        expect(lastFrame()).toContain('你好！有什么可以帮你？');
    });

    it('should render tool call items', () => {
        const items: HistoryItem[] = [
            {
                type: 'tool_call',
                requestId: 'r1',
                name: 'readFile',
                args: { path: 'a.ts' },
                result: 'content',
                isError: false,
                durationMs: 200,
            },
        ];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('readFile');
    });

    it('should render streaming text', () => {
        const items: HistoryItem[] = [];
        const { lastFrame } = renderWithComponents(
            <History items={items} streaming="正在生成..." />,
        );
        expect(lastFrame()).toContain('正在生成...');
        expect(lastFrame()).toContain('▊');
    });

    it('should render error items', () => {
        const items: HistoryItem[] = [
            { type: 'error', message: 'API rate limit', fatal: true },
        ];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('API rate limit');
    });
});
