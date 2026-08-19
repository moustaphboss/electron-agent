import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { randomUUID } from "crypto";
import { extractImagePaths } from "./extractImages";
import {
  RENDER_TABLE_JSON_SCHEMA,
  RENDER_TABLE_TOOL_DESCRIPTION,
  RENDER_TABLE_TOOL_NAME,
  UIBlock,
  validateTableBlock,
} from "./uiBlocks";
import { buildSystemPrompt } from "./systemPrompt";

const MODEL = "claude-sonnet-5";
const MAX_TURNS = 5;

export interface AgentReply {
  text: string;
  images: string[];
  ui: UIBlock[];
}

/**
 * A prior turn's plain-text content, as already shown in the UI — not the
 * raw tool_use/tool_result trace. The Messages API is stateless, so every
 * call has to resend everything the model should remember; this is the
 * simplest thing that's true to resend, since it's exactly what the model
 * itself said (or was asked) in earlier turns.
 */
export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export async function runAgentLoop(
  userMessage: string,
  mcpClient: Client,
  anthropic: Anthropic,
  onDelta: (text: string) => void,
  a2uiEnabled: boolean,
  history: ChatHistoryEntry[] = [],
): Promise<AgentReply> {
  const traceId = randomUUID();
  console.log(`[agent] turn start, traceId=${traceId}`);
  const images: string[] = [];
  const uiBlocks: UIBlock[] = [];
  // Every turn's text accumulates here — a turn that also calls a tool isn't
  // "wrong" reasoning to discard, it's real content the model said on its
  // way to the answer. What streams live is always exactly the final text.
  let fullText = "";

  const { tools } = await mcpClient.listTools();
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const allTools = a2uiEnabled
    ? [
        ...anthropicTools,
        {
          name: RENDER_TABLE_TOOL_NAME,
          description: RENDER_TABLE_TOOL_DESCRIPTION,
          input_schema: RENDER_TABLE_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ]
    : anthropicTools;

  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((h) => h.content.trim().length > 0)
      .map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (fullText) {
      // Separate this turn's text from the previous turn's in both the
      // live stream and the persisted message, so they don't run together.
      fullText += "\n\n";
      onDelta("\n\n");
    }

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(a2uiEnabled),
      messages,
      tools: allTools,
    });

    stream.on("text", (delta) => {
      fullText += delta;
      onDelta(delta);
    });

    const response = await stream.finalMessage();

    messages.push({ role: "assistant", content: response.content });

    const reasoning = response.content.find((b) => b.type === "text");
    if (reasoning && "text" in reasoning) {
      console.log(`[agent] reasoning: ${reasoning.text}`);
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      return { text: fullText, images, ui: uiBlocks };
    }

    // A fresh batch of get_photo_details calls supersedes any earlier batch
    // (the model is re-choosing which photos to show). A round with no
    // get_photo_details call — e.g. just render_table — isn't reselecting
    // photos, so it must not wipe out images gathered in an earlier round.
    if (toolUseBlocks.some((b) => b.name === "get_photo_details")) {
      images.length = 0;
    }
    uiBlocks.length = 0;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      console.log(
        `[agent] calling tool: ${block.name}`,
        JSON.stringify(block.input),
      );

      if (block.name === RENDER_TABLE_TOOL_NAME) {
        let resultText: string;
        let isError = false;
        try {
          uiBlocks.push(validateTableBlock(block.input));
          resultText = "Table rendered to the user.";
        } catch (e) {
          resultText = `Failed to render table: ${(e as Error).message}`;
          isError = true;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
          is_error: isError,
        });
        continue;
      }

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
    ui: uiBlocks,
  };
}
