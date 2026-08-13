import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { randomUUID } from "node:crypto";

const MODEL = "claude-sonnet-5";
const MAX_TURNS = 5;

/** One tool invocation the model made during the run, in call order. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface EvalRunResult {
  text: string;
  /** Every tool call made across the whole run — for tool-selection checks. */
  toolCalls: ToolCall[];
  /**
   * Photo paths extracted from the LAST round of tool calls only (mirrors
   * agentLoop.ts's fix: an earlier, exploratory round of tool calls doesn't
   * leak into what's ultimately shown for the answer).
   */
  images: string[];
}

function extractPhotoPaths(toolName: string, jsonText: string): string[] {
  try {
    const parsed = JSON.parse(jsonText);
    if (toolName === "search_photos" && Array.isArray(parsed?.photos)) {
      return parsed.photos
        .map((p: unknown) => (p as { file_path?: unknown })?.file_path)
        .filter((p: unknown): p is string => typeof p === "string");
    }
    if (
      toolName === "get_photo_details" &&
      typeof parsed?.file_path === "string"
    ) {
      return [parsed.file_path];
    }
  } catch {
    // Not JSON — nothing to extract.
  }
  return [];
}

/**
 * A non-streaming, eval-mode version of src/main/agentLoop.ts's tool loop.
 * Deliberately re-implemented here rather than imported: the root app is a
 * "commonjs" package built by electron-vite, and this package runs plain
 * `.ts` files directly under Node's native TypeScript support, which needs
 * "type": "module" — the two module systems don't resolve across a shared
 * import without changing the root package's type (a bigger, riskier change
 * than this harness warrants). What's being evaluated here is tool-
 * selection quality, which doesn't depend on the streaming/turn-discard
 * mechanics that differ between the two — see eval/README.md.
 */
export async function runEvalTurn(
  userMessage: string,
  mcpClient: Client,
  anthropic: Anthropic,
): Promise<EvalRunResult> {
  const traceId = randomUUID();

  const { tools } = await mcpClient.listTools();
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];
  const toolCalls: ToolCall[] = [];
  let images: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools: anthropicTools,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      const reasoning = response.content.find((b) => b.type === "text");
      return {
        text: reasoning && "text" in reasoning ? reasoning.text : "",
        toolCalls,
        images,
      };
    }

    // This round supersedes any earlier one — same fix as agentLoop.ts.
    images = [];

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      toolCalls.push({
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
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
        images.push(...extractPhotoPaths(block.name, textBlock.text));
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
    text: "(gave up after MAX_TURNS)",
    toolCalls,
    images,
  };
}
