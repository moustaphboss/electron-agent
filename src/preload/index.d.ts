export interface McpConnection {
  name: string;
  tools: { name: string; description?: string }[];
}

export interface TableColumn {
  key: string;
  label: string;
}

export type TableCellValue = string | number | null;

export interface TableUIBlock {
  type: "table";
  title?: string;
  columns: TableColumn[];
  rows: Record<string, TableCellValue>[];
}

export type UIBlock = TableUIBlock;

export interface AgentReply {
  text: string;
  images: string[];
  ui: UIBlock[];
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface DemoAPI {
  ping: () => Promise<{ message: string; timestamp: number }>;
  showSaveDialog: () => Promise<{ canceled: boolean; filePath: string | null }>;
  onMenuPing: (callback: () => void) => void;
  askAgentStream: (
    requestId: string,
    message: string,
    mode: "hand-rolled" | "langgraph",
    a2uiEnabled: boolean,
    history: ChatHistoryEntry[],
  ) => void;
  onAgentChunk: (callback: (requestId: string, delta: string) => void) => void;
  onAgentDone: (
    callback: (requestId: string, reply: AgentReply) => void,
  ) => void;
  onAgentError: (
    callback: (requestId: string, message: string) => void,
  ) => void;
  listMcpConnections: () => Promise<McpConnection[]>;
}

declare global {
  interface Window {
    demoAPI: DemoAPI;
  }
}
