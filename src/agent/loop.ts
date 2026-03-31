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
  onStreamingText?: (text: string) => void;
  abortSignal?: AbortSignal;
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
  chatStream(messages: Message[], tools: ToolDefinition[]): AsyncIterable<StreamChunk>;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'done';
  content?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
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
   * Main agentic loop (non-streaming).
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
      this.checkAbort();
      turn++;

      // Step 2 — call the LLM
      const response = await this.llmProvider.chat(conversation, this.config.tools);

      // Track usage
      this.trackUsage(response.usage);

      // If the model produced a text assistant message, push it
      if (response.content) {
        conversation.push({
          role: 'assistant',
          content: response.content,
        });
      }

      // Step 3 — handle tool calls
      if (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
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
        return this.buildResult(conversation, response.content);
      }
    }

    // Step 5 — maxTurns exceeded
    throw new AgentLoopError(
      'max_turns_exceeded',
      `Agent loop exceeded maximum turns (${this.config.maxTurns}). Last response may be incomplete.`,
      conversation,
      this.totalTokens,
      this.totalCost,
      this.toolCallCount,
    );
  }

  /**
   * Streaming agentic loop.
   * Yields text chunks as they arrive from the LLM. When the model
   * requests tool_use, the loop processes it internally and continues.
   */
  async *runStream(
    userMessage: string,
    history: Message[],
  ): AsyncGenerator<StreamChunk, AgentLoopResult> {
    this.totalTokens = 0;
    this.totalCost = 0;
    this.toolCallCount = 0;

    const conversation: Message[] = this.buildContext(history, userMessage);
    let turn = 0;

    while (turn < this.config.maxTurns) {
      this.checkAbort();
      turn++;

      // Collect the full response from the stream
      let fullContent = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let stopReason: LLMResponse['stopReason'] = 'end_turn';

      try {
        const stream = this.llmProvider.chatStream(conversation, this.config.tools);
        for await (const chunk of stream) {
          this.checkAbort();

          if (chunk.type === 'text' && chunk.content) {
            fullContent += chunk.content;
            // Yield text chunk to caller
            yield { type: 'text', content: chunk.content };
            // Also invoke the callback if set
            this.config.onStreamingText?.(chunk.content);
          }

          if (chunk.type === 'tool_use' && chunk.toolUse) {
            toolCalls.push(chunk.toolUse);
          }

          if (chunk.type === 'done') {
            stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
          }
        }
      } catch (error) {
        // If streaming fails, emit error as text and stop
        const msg = error instanceof Error ? error.message : String(error);
        yield { type: 'text', content: `\n[stream error: ${msg}]` };
        break;
      }

      // Rough token estimate from collected content (provider should give exact)
      this.trackUsage({
        inputTokens: 0, // Will be updated by next non-stream call if available
        outputTokens: Math.ceil(fullContent.length / 4),
      });

      // Push assistant message
      if (fullContent) {
        conversation.push({ role: 'assistant', content: fullContent });
      }

      // Handle tool calls
      if (stopReason === 'tool_use' && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          this.toolCallCount++;

          conversation.push({
            role: 'assistant',
            content: '',
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
            tool_input: toolCall.input,
          });

          const permission = await this.config.permissions.check(
            toolCall.name,
            toolCall.input,
          );

          let result: string;
          if (permission === 'deny') {
            result = `Permission denied for tool "${toolCall.name}".`;
          } else if (permission === 'ask') {
            result = `Tool "${toolCall.name}" requires user approval. Denied by default.`;
          } else {
            result = await this.handleToolUse(toolCall);
          }

          conversation.push({
            role: 'tool',
            content: result,
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
          });

          // Yield tool execution info
          yield {
            type: 'text',
            content: `\n[tool: ${toolCall.name} — ${permission === 'allow' ? 'executed' : permission}]\n`,
          };
        }

        // Loop again — model needs to process tool results
        continue;
      }

      // Final response
      yield { type: 'done' };
      return this.buildResult(conversation, fullContent);
    }

    yield { type: 'done' };
    throw new AgentLoopError(
      'max_turns_exceeded',
      `Agent loop exceeded maximum turns (${this.config.maxTurns}).`,
      conversation,
      this.totalTokens,
      this.totalCost,
      this.toolCallCount,
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
      this.checkAbort();
      const result = await this.toolExecutor.execute(toolCall.name, toolCall.input);
      return result;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return `Tool execution error (${toolCall.name}): ${message}`;
    }
  }

  /** Track token usage and cost. */
  private trackUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this.totalTokens += usage.inputTokens + usage.outputTokens;
    this.totalCost +=
      (usage.inputTokens / 1000) * COST_PER_1K.input +
      (usage.outputTokens / 1000) * COST_PER_1K.output;

    this.config.onTokenCount?.(this.totalTokens);
    this.config.onCostUpdate?.(this.totalCost);
  }

  /** Check if the operation has been aborted. */
  private checkAbort(): void {
    if (this.config.abortSignal?.aborted) {
      throw new AgentLoopError(
        'aborted',
        'Agent loop was aborted by the user.',
        [],
        this.totalTokens,
        this.totalCost,
        this.toolCallCount,
      );
    }
  }

  /** Build the final result object. */
  private buildResult(
    messages: Message[],
    finalResponse: string,
  ): AgentLoopResult {
    return {
      messages,
      finalResponse,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      toolCalls: this.toolCallCount,
    };
  }
}

/** Structured error from the agent loop. */
export class AgentLoopError extends Error {
  readonly code: string;
  readonly messages: Message[];
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly toolCalls: number;

  constructor(
    code: 'max_turns_exceeded' | 'aborted',
    message: string,
    messages: Message[],
    totalTokens: number,
    totalCost: number,
    toolCalls: number,
  ) {
    super(message);
    this.name = 'AgentLoopError';
    this.code = code;
    this.messages = messages;
    this.totalTokens = totalTokens;
    this.totalCost = totalCost;
    this.toolCalls = toolCalls;
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

  async *chatStream(
    messages: Message[],
    tools: ToolDefinition[],
  ): AsyncIterable<StreamChunk> {
    const response = await this.handler(messages, tools);
    if (response.content) {
      // Simulate streaming by yielding word by word
      const words = response.content.split(' ');
      for (let i = 0; i < words.length; i++) {
        yield {
          type: 'text',
          content: (i > 0 ? ' ' : '') + words[i],
        };
      }
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_use', toolUse: tc };
    }
    yield { type: 'done' };
  }
}
