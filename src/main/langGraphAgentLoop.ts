import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { isToolMessage } from "@langchain/core/messages";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { extractImagePaths } from "./extractImages";
import type { AgentReply } from "./agentLoop";

const MODEL = "claude-sonnet-5";

export async function runLangGraphAgentLoop(
  userMessage: string,
  mcpClient: Client,
): Promise<AgentReply> {
  const tools = await loadMcpTools("mcp-server", mcpClient);

  const llm = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: MODEL,
  });

  const agent = createReactAgent({ llm, tools });

  const result = await agent.invoke({
    messages: [{ role: "user", content: userMessage }],
  });

  const images: string[] = [];
  for (const m of result.messages) {
    if (isToolMessage(m) && m.name && typeof m.content === "string") {
      images.push(...extractImagePaths(m.name, m.content));
    }
  }

  const lastMessage = result.messages[result.messages.length - 1];
  const content = lastMessage?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);

  return { text, images };
}
