import OpenAI from "openai";
export class OpenAIClient {
    constructor(config) {
        this.config = config;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            timeout: config.requestTimeoutMs ?? 8000,
            dangerouslyAllowBrowser: true, // Required for browser environment
        });
    }
    async chat(messages, tools) {
        try {
            console.log("Calling OpenAI API:", {
                baseURL: this.config.baseURL,
                model: this.config.model,
                messageCount: messages.length,
                toolCount: tools?.length || 0,
            });
            const response = await this.client.chat.completions.create({
                model: this.config.model,
                messages: messages,
                tools: tools,
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
            const reasoningContent = typeof message.reasoning_content === "string"
                ? message.reasoning_content
                : null;
            return {
                content: message.content,
                reasoning_content: reasoningContent,
                tool_calls: message.tool_calls,
                finish_reason: choice.finish_reason,
            };
        }
        catch (error) {
            console.error("OpenAI API error:", {
                message: error.message,
                status: error.status,
                type: error.type,
                code: error.code,
            });
            throw error;
        }
    }
    async streamChat(messages, tools, onChunk) {
        const stream = await this.client.chat.completions.create({
            model: this.config.model,
            messages: messages,
            tools: tools,
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens,
            stream: true,
        });
        let content = "";
        let reasoning_content = "";
        let tool_calls = [];
        let finish_reason = "stop";
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
                content += delta.content;
                onChunk?.(delta.content);
            }
            if (typeof delta?.reasoning_content === "string") {
                reasoning_content += delta.reasoning_content;
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
            reasoning_content: reasoning_content || null,
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
            finish_reason,
        };
    }
}
