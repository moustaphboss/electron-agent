import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

export async function connectMcpClient(): Promise<Client> {
  const serverPath = path.join(__dirname, "../../mcp-server/dist/index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
  });

  const client = new Client({ name: "electron-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}
