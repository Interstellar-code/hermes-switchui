// Switch UI local replacement for @archon/providers/types.
// CONTRACT LAYER — no SDK imports, no runtime deps.
// HARD RULE: This file must never import SDK packages or other @archon/* packages.

// ─── Provider Config Defaults ──────────────────────────────────────────────

export interface ClaudeProviderDefaults {
  [key: string]: unknown;
  model?: string;
  settingSources?: ('project' | 'user')[];
  claudeBinaryPath?: string;
}

export interface CodexProviderDefaults {
  [key: string]: unknown;
  model?: string;
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  webSearchMode?: 'disabled' | 'cached' | 'live';
  additionalDirectories?: string[];
  codexBinaryPath?: string;
}

export interface PiProviderDefaults {
  [key: string]: unknown;
  model?: string;
  enableExtensions?: boolean;
  interactive?: boolean;
  extensionFlags?: Record<string, boolean | string>;
  env?: Record<string, string>;
  maxConcurrent?: number;
}

export type ProviderDefaults = Record<string, unknown>;
export type ProviderDefaultsMap = Record<string, ProviderDefaults>;

export interface TokenUsage {
  input: number;
  output: number;
  total?: number;
  cost?: number;
}

export type MessageChunk =
  | {
      type: 'assistant';
      content: string;
      flush?: boolean;
    }
  | { type: 'system'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'result';
      sessionId?: string;
      tokens?: TokenUsage;
      structuredOutput?: unknown;
      isError?: boolean;
      errorSubtype?: string;
      errors?: string[];
      cost?: number;
      stopReason?: string;
      numTurns?: number;
      modelUsage?: Record<string, unknown>;
    }
  | { type: 'rate_limit'; rateLimitInfo: Record<string, unknown> }
  | {
      type: 'tool';
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolCallId?: string;
    }
  | {
      type: 'tool_result';
      toolName: string;
      toolOutput: string;
      toolCallId?: string;
    }
  | { type: 'workflow_dispatch'; workerConversationId: string; workflowName: string };

export interface AgentRequestOptions {
  model?: string;
  abortSignal?: AbortSignal;
  systemPrompt?: string;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  env?: Record<string, string>;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  forkSession?: boolean;
  persistSession?: boolean;
}

export interface NodeConfig {
  mcp?: string;
  hooks?: unknown;
  skills?: string[];
  agents?: Record<
    string,
    {
      description: string;
      prompt: string;
      model?: string;
      tools?: string[];
      disallowedTools?: string[];
      skills?: string[];
      maxTurns?: number;
    }
  >;
  allowed_tools?: string[];
  denied_tools?: string[];
  effort?: string;
  thinking?: unknown;
  sandbox?: unknown;
  betas?: string[];
  output_format?: Record<string, unknown>;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  fallbackModel?: string;
  idle_timeout?: number;
  [key: string]: unknown;
}

export interface SendQueryOptions extends AgentRequestOptions {
  nodeConfig?: NodeConfig;
  assistantConfig?: Record<string, unknown>;
}

export interface ProviderCapabilities {
  sessionResume: boolean;
  mcp: boolean;
  hooks: boolean;
  skills: boolean;
  agents: boolean;
  toolRestrictions: boolean;
  structuredOutput: boolean;
  envInjection: boolean;
  costControl: boolean;
  effortControl: boolean;
  thinkingControl: boolean;
  fallbackModel: boolean;
  sandbox: boolean;
}

export interface ProviderRegistration {
  id: string;
  displayName: string;
  factory: () => IAgentProvider;
  capabilities: ProviderCapabilities;
  builtIn: boolean;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  builtIn: boolean;
}

export interface IAgentProvider {
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions
  ): AsyncGenerator<MessageChunk>;

  getType(): string;
  getCapabilities(): ProviderCapabilities;
}
