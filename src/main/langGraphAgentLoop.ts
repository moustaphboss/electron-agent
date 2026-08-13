import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { tool } from "@langchain/core/tools";
import { AIMessageChunk, isToolMessage } from "@langchain/core/messages";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { extractImagePaths } from "./extractImages";
import type { AgentReply } from "./agentLoop";
import {
  RENDER_TABLE_JSON_SCHEMA,
  RENDER_TABLE_TOOL_DESCRIPTION,
  RENDER_TABLE_TOOL_NAME,
  UIBlock,
  validateTableBlock,
} from "./uiBlocks";
import { buildSystemPrompt } from "./systemPrompt";

const MODEL = "claude-sonnet-5";

function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("");
  }
  return "";
}

export async function runLangGraphAgentLoop(
  userMessage: string,
  mcpClient: Client,
  onDelta: (text: string) => void,
  a2uiEnabled: boolean,
): Promise<AgentReply> {
  const tools = await loadMcpTools("mcp-server", mcpClient);

  const uiBlocks: UIBlock[] = [];
  const renderTableTool = tool(
    async (input) => {
      try {
        uiBlocks.push(validateTableBlock(input));
        return "Table rendered to the user.";
      } catch (e) {
        return `Failed to render table: ${(e as Error).message}`;
      }
    },
    {
      name: RENDER_TABLE_TOOL_NAME,
      description: RENDER_TABLE_TOOL_DESCRIPTION,
      schema: RENDER_TABLE_JSON_SCHEMA,
    },
  );

  const llm = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: MODEL,
  });

  const agent = createReactAgent({
    llm,
    tools: a2uiEnabled ? [...tools, renderTableTool] : tools,
    prompt: buildSystemPrompt(a2uiEnabled),
  });

  const stream = await agent.stream(
    { messages: [{ role: "user", content: userMessage }] },
    // `runName` labels the trace in LangSmith (see LANGSMITH_TRACING in
    // .env) so it's identifiable at a glance in the project dashboard.
    { streamMode: "messages", runName: "mustipix-ask-agent" },
  );

  const images: string[] = [];
  let text = "";
  // Tracks whether the previous stream item was part of an AI turn, so we
  // can tell when a fresh batch of tool calls starts.
  let lastWasAi = false;
  // Set on every AI turn; consumed by the first get_photo_details call that
  // follows it. Only a fresh get_photo_details batch supersedes the earlier
  // photo selection — a render_table (or any other) call isn't reselecting
  // which photos to show, so it must not wipe `images` out.
  let awaitingFreshPhotoSelection = true;

  for await (const [message] of stream) {
    if (message instanceof AIMessageChunk) {
      lastWasAi = true;
      awaitingFreshPhotoSelection = true;
      const delta = chunkText(message.content);
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    } else if (
      isToolMessage(message) &&
      message.name &&
      typeof message.content === "string"
    ) {
      if (lastWasAi) {
        uiBlocks.length = 0;
      }
      lastWasAi = false;
      if (message.name === "get_photo_details" && awaitingFreshPhotoSelection) {
        images.length = 0;
        awaitingFreshPhotoSelection = false;
      }
      images.push(...extractImagePaths(message.name, message.content));
    }
  }

  return { text, images, ui: uiBlocks };
}
