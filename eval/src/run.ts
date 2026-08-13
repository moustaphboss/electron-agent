import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runEvalTurn } from "./agent.js";
import { cases } from "./cases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// __dirname here is eval/dist — .env lives two levels up, at the repo root.
config({ path: path.join(__dirname, "../../.env") });

async function main() {
  const serverPath = path.join(__dirname, "../../mcp-server/dist/index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
  });
  const mcpClient = new Client({ name: "eval-harness", version: "1.0.0" });
  await mcpClient.connect(transport);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`Running ${cases.length} eval case(s) against ${serverPath}\n`);

  let failures = 0;
  for (const testCase of cases) {
    process.stdout.write(`  ${testCase.name} ... `);
    try {
      const result = await runEvalTurn(testCase.query, mcpClient, anthropic);
      const failureReason = testCase.check(result);
      if (failureReason) {
        failures++;
        console.log("FAIL");
        console.log(`    query: ${JSON.stringify(testCase.query)}`);
        console.log(`    reason: ${failureReason}`);
        console.log(
          `    tool calls: ${JSON.stringify(result.toolCalls, null, 2).replace(/\n/g, "\n    ")}`,
        );
      } else {
        console.log("PASS");
      }
    } catch (err) {
      failures++;
      console.log("ERROR");
      console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed.`);

  await mcpClient.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
