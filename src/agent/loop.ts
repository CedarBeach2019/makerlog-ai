// Agent Loop — the core of makerlog.ai
// Mirrors Claude Code's architecture: tool_use → tool_result → think cycle

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentConfig {
  maxTurns: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  permissions: PermissionChecker;
  onTokenCount?: (count: number) => void;
  onCostUpdate?: (cost: number) => void;
}

export interface AgentLoopResult {
  messages: Message[];
  finalResponse: string;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
}

export interface ToolExecutor {
  execute(name: string, input: Record<string, unknown>): Promise<string>;
}

export interface PermissionChecker {
  check(tool: string, input: Record<string, unknown>): Promise<'allow' | 'deny' | 'ask'>;
}

interface LLMResponse {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

interface LLMProvider {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

/** Cost per 1K tokens (input / output) — defaults to Claude Sonnet pricing. */
const COST_PER_1K = { input: 0.003, output: 0.015 };

export class AgentLoop {
  private config: AgentConfig;
  private toolExecutor: ToolExecutor;
  private llmProvider: LLMProvider;
  private totalTokens: number = 0;
  private totalCost: number = 0;
  private toolCallCount: number = 0;

  constructor(
    config: AgentConfig,
    toolExecutor: ToolExecutor,
    llmProvider: LLMProvider,
  ) {
    this.config = config;
    this.toolExecutor = toolExecutor;
    this.llmProvider = llmProvider;
  }

  /**
   * Main agentic loop.
   * 1. Build context (system prompt + history + user message)
   * 2. Send to LLM provider
   * 3. If response contains tool_use:
   *    a. Check permission
   *    b. Execute tool
   *    c. Add tool_result to conversation
   *    d. Go back to step 2
   * 4. If response is text only, return it
   * 5. Enforce maxTurns limit
   */
  async run(userMessage: string, history: Message[]): Promise<AgentLoopResult> {
    this.totalTokens = 0;
    this.totalCost = 0;
    this.toolCallCount = 0;

    const conversation: Message[] = this.buildContext(history, userMessage);
    let turn = 0;

    while (turn < this.config.maxTurns) {
      turn++;

      // Step 2 — call the LLM
      const response = await this.llmProvider.chat(conversation, this.config.tools);

      // Track usage
      this.totalTokens += response.usage.inputTokens + response.usage.outputTokens;
      this.totalCost +=
        (response.usage.inputTokens / 1000) * COST_PER_1K.input +
        (response.usage.outputTokens / 1000) * COST_PER_1K.output;

      this.config.onTokenCount?.(this.totalTokens);
      this.config.onCostUpdate?.(this.totalCost);

      // If the model produced a text assistant message, push it
      if (response.content) {
        conversation.push({
          role: 'assistant',
          content: response.content,
        });
      }

      // Step 3 — handle tool calls
      if (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
        // Push each tool_use message and its result
        for (const toolCall of response.toolCalls) {
          this.toolCallCount++;

          // Push the assistant tool_use message
          conversation.push({
            role: 'assistant',
            content: '',
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
            tool_input: toolCall.input,
          });

          // Step 3a — check permission
          const permission = await this.config.permissions.check(
            toolCall.name,
            toolCall.input,
          );

          let result: string;
          if (permission === 'deny') {
            result = `Permission denied for tool "${toolCall.name}".`;
          } else if (permission === 'ask') {
            // In ask mode we default to deny unless a handler resolved it.
            // The PermissionManager is responsible for prompting; it returns
            // 'allow' only when the user explicitly consents.
            result = `Tool "${toolCall.name}" requires user approval. Denied by default.`;
          } else {
            // Step 3b — execute tool
            result = await this.handleToolUse(toolCall);
          }

          // Step 3c — add tool_result
          conversation.push({
            role: 'tool',
            content: result,
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
          });
        }

        // Step 3d — loop back to step 2
        continue;
      }

      // Step 4 — text-only response, we are done
      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return {
          messages: conversation,
          finalResponse: response.content,
          totalTokens: this.totalTokens,
          totalCost: this.totalCost,
          toolCalls: this.toolCallCount,
        };
      }
    }

    // Step 5 — maxTurns exceeded
    throw new Error(
      `Agent loop exceeded maximum turns (${this.config.maxTurns}). ` +
        `Last response may be incomplete.`,
    );
  }

  /** Build the full context array sent to the LLM. */
  private buildContext(history: Message[], userMessage: string): Message[] {
    const context: Message[] = [];

    // System prompt always goes first
    context.push({
      role: 'system',
      content: this.config.systemPrompt,
    });

    // Then conversation history
    for (const msg of history) {
      context.push({ ...msg });
    }

    // Finally the new user message
    context.push({
      role: 'user',
      content: userMessage,
    });

    return context;
  }

  /** Execute a single tool call and return its string result. */
  private async handleToolUse(toolCall: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  }): Promise<string> {
    try {
      const result = await this.toolExecutor.execute(toolCall.name, toolCall.input);
      return result;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return `Tool execution error (${toolCall.name}): ${message}`;
    }
  }
}

/** Simple in-memory LLM provider for testing. Wraps a function. */
export class FunctionLLMProvider implements LLMProvider {
  private handler: (
    messages: Message[],
    tools: ToolDefinition[],
  ) => Promise<LLMResponse>;

  constructor(
    handler: (
      messages: Message[],
      tools: ToolDefinition[],
    ) => Promise<LLMResponse>,
  ) {
    this.handler = handler;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    return this.handler(messages, tools);
  }
}
