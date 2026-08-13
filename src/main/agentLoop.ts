import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { randomUUID } from "crypto";
import { extractImagePaths } from "./extractImages";

const MODEL = "claude-sonnet-5";
const MAX_TURNS = 5;

export interface AgentReply {
  text: string;
  images: string[];
}

export async function runAgentLoop(
  userMessage: string,
  mcpClient: Client,
  anthropic: Anthropic,
): Promise<AgentReply> {
  const traceId = randomUUID();
  console.log(`[agent] turn start, traceId=${traceId}`);
  const images: string[] = [];

  const { tools } = await mcpClient.listTools();
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools: anthropicTools,
    });

    messages.push({ role: "assistant", content: response.content });

    const reasoning = response.content.find((b) => b.type === "text");
    if (reasoning && "text" in reasoning) {
      console.log(`[agent] reasoning: ${reasoning.text}`);
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      return {
        text: reasoning && "text" in reasoning ? reasoning.text : "",
        images,
      };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      console.log(
        `[agent] calling tool: ${block.name}`,
        JSON.stringify(block.input),
      );
      const result = await mcpClient.callTool({
        name: block.name,
        arguments: block.input as Record<string, unknown>,
        _meta: { traceId } as Record<string, unknown>,
      });
      const textBlock = Array.isArray(result.content)
        ? result.content.find(
            (b): b is { type: "text"; text: string } =>
              typeof b === "object" &&
              b !== null &&
              "type" in b &&
              b.type === "text",
          )
        : undefined;
      if (textBlock) {
        images.push(...extractImagePaths(block.name, textBlock.text));
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result.content),
        is_error: !!result.isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    text: "I wasn't able to finish this after several attempts — could you rephrase or narrow the request?",
    images,
  };
}
