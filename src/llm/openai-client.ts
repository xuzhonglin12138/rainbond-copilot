import OpenAI from "openai";
import type {
  LLMConfig,
  ChatMessage,
  ToolDefinition,
  ChatCompletionResponse,
} from "./types";

export class OpenAIClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.requestTimeoutMs ?? 8000,
      dangerouslyAllowBrowser: true, // Required for browser environment
    });
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    try {
      console.log("Calling OpenAI API:", {
        baseURL: this.config.baseURL,
        model: this.config.model,
        messageCount: messages.length,
        toolCount: tools?.length || 0,
      });

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxTokens,
      });

      console.log("OpenAI API response received:", {
        hasChoices: !!response.choices,
        choicesCount: response.choices?.length || 0,
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error("No response from LLM");
      }

      const choice = response.choices[0];
      const message = choice.message;

      return {
        content: message.content,
        tool_calls: message.tool_calls as any,
        finish_reason: choice.finish_reason as any,
      };
    } catch (error: any) {
      console.error("OpenAI API error:", {
        message: error.message,
        status: error.status,
        type: error.type,
        code: error.code,
      });
      throw error;
    }
  }

  async streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void
  ): Promise<ChatCompletionResponse> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens,
      stream: true,
    });

    let content = "";
    let tool_calls: any[] = [];
    let finish_reason: any = "stop";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        content += delta.content;
        onChunk?.(delta.content);
      }

      if (delta?.tool_calls) {
        tool_calls.push(...delta.tool_calls);
      }

      if (chunk.choices[0]?.finish_reason) {
        finish_reason = chunk.choices[0].finish_reason;
      }
    }

    return {
      content: content || null,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      finish_reason,
    };
  }
}
