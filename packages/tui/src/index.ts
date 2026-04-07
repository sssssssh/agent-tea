// @agent-tea/tui — Terminal UI framework for agent-tea

// Re-export SDK（开发者只需 import from '@agent-tea/tui'）
export * from '@agent-tea/sdk';

// Adapter 层
export { createEventCollector, type EventCollector } from './adapter/index.js';
export {
    type AgentSnapshot,
    type AgentStatus,
    type HistoryItem,
    type MessageItem,
    type ToolCallItem,
    type PlanItem,
    type ErrorItem,
    createInitialSnapshot,
} from './adapter/index.js';

// Hooks 层
export { useAgentEvents } from './hooks/index.js';
export { useApproval } from './hooks/index.js';

// Components 层
export { ComponentProvider, useComponents } from './components/index.js';
export type {
    ComponentMap,
    UserMessageProps,
    AgentMessageProps,
    ToolCallCardProps,
    ApprovalDialogProps,
    PlanViewProps,
    ErrorMessageProps,
    StatusBarProps,
} from './components/index.js';
export {
    UserMessage,
    AgentMessage,
    ToolCallCard,
    ApprovalDialog,
    PlanView,
    ErrorMessage,
    StatusBar,
    History,
} from './components/index.js';

// Runner 层
export { AgentTUI, type AgentTUIProps } from './runner/index.js';
export { DefaultLayout, type LayoutProps } from './runner/index.js';
export { Composer, type ComposerProps } from './runner/index.js';
