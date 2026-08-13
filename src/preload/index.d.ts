export interface McpConnection {
  name: string;
  tools: { name: string; description?: string }[];
}

export interface AgentReply {
  text: string;
  images: string[];
}

export interface DemoAPI {
  ping: () => Promise<{ message: string; timestamp: number }>;
  showSaveDialog: () => Promise<{ canceled: boolean; filePath: string | null }>;
  onMenuPing: (callback: () => void) => void;
  askAgent: (
    message: string,
    mode: "hand-rolled" | "langgraph",
  ) => Promise<AgentReply>;
  listMcpConnections: () => Promise<McpConnection[]>;
}

declare global {
  interface Window {
    demoAPI: DemoAPI;
  }
}
