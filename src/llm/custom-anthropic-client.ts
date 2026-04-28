import type {
  LLMConfig,
  ChatMessage,
  ToolDefinition,
  ChatCompletionResponse,
} from "./types.js";

export class CustomAnthropicClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    const timeoutMs = this.config.requestTimeoutMs ?? 8000;
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      console.log("Calling Anthropic API (custom client):", {
        baseURL: this.config.baseURL,
        model: this.config.model,
        messageCount: messages.length,
        toolCount: tools?.length || 0,
      });

      // Join all system messages so per-turn recall context is preserved.
      const systemMessage = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
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

      const requestBody = {
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        system: systemMessage,
        messages: userMessages,
        ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        temperature: this.config.temperature,
      };

      const baseURL = this.config.baseURL || "https://api.anthropic.com";
      const url = `${baseURL}/v1/messages`;

      const headers = {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      };

      console.log("Sending request to:", url);
      console.log("Request headers:", {
        "Content-Type": headers["Content-Type"],
        "x-api-key": headers["x-api-key"]?.substring(0, 20) + "...",
        "anthropic-version": headers["anthropic-version"],
      });
      console.log("Request body:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller?.signal,
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API error response:", errorText);
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      console.log("Anthropic API response received:", {
        stopReason: data.stop_reason,
        contentBlocks: data.content?.length || 0,
      });

      // Convert response to OpenAI-compatible format
      let content = "";
      let tool_calls: any[] | undefined;

      for (const block of data.content || []) {
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
        reasoning_content: null,
        tool_calls,
        finish_reason: data.stop_reason as any,
      };
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
      console.error("Anthropic API error:", {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    _onChunk?: (chunk: string) => void | Promise<void>
  ): Promise<ChatCompletionResponse> {
    return this.chat(messages, tools);
  }
}
