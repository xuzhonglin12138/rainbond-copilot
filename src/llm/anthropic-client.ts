import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMConfig,
  ChatMessage,
  ToolDefinition,
  ChatCompletionResponse,
} from "./types";

export class AnthropicClient {
  private client: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    try {
      console.log("Calling Anthropic API:", {
        baseURL: this.config.baseURL,
        model: this.config.model,
        messageCount: messages.length,
        toolCount: tools?.length || 0,
      });

      // Convert messages format: extract system message
      const systemMessage = messages.find((m) => m.role === "system")?.content || "";
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content || "",
        }));

      // Convert tools to Anthropic format
      const anthropicTools = tools?.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        system: systemMessage,
        messages: userMessages as any,
        tools: anthropicTools as any,
        temperature: this.config.temperature,
      });

      console.log("Anthropic API response received:", {
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
      });

      // Convert response to OpenAI-compatible format
      let content = "";
      let tool_calls: any[] | undefined;

      for (const block of response.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "tool_use") {
          if (!tool_calls) tool_calls = [];
          tool_calls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      return {
        content: content || null,
        tool_calls,
        finish_reason: response.stop_reason as any,
      };
    } catch (error: any) {
      console.error("Anthropic API error:", {
        message: error.message,
        status: error.status,
        type: error.type,
      });
      throw error;
    }
  }

  async streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    _onChunk?: (chunk: string) => void
  ): Promise<ChatCompletionResponse> {
    // For now, use non-streaming version
    // Streaming can be implemented later if needed
    return this.chat(messages, tools);
  }
}
