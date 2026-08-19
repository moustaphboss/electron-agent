import { contextBridge, ipcRenderer } from "electron";
import type { UIBlock } from "../main/uiBlocks";
import type { ChatHistoryEntry } from "../main/agentLoop";

contextBridge.exposeInMainWorld("demoAPI", {
  ping: () => ipcRenderer.invoke("ping"),
  showSaveDialog: () => ipcRenderer.invoke("show-save-dialog"),
  onMenuPing: (callback: () => void) => {
    ipcRenderer.on("menu-ping", callback);
  },
  askAgentStream: (
    requestId: string,
    message: string,
    mode: "hand-rolled" | "langgraph",
    a2uiEnabled: boolean,
    history: ChatHistoryEntry[],
  ) =>
    ipcRenderer.send(
      "ask-agent-stream",
      requestId,
      message,
      mode,
      a2uiEnabled,
      history,
    ),
  onAgentChunk: (callback: (requestId: string, delta: string) => void) => {
    ipcRenderer.on("agent-chunk", (_e, requestId, delta) =>
      callback(requestId, delta),
    );
  },
  onAgentDone: (
    callback: (
      requestId: string,
      reply: { text: string; images: string[]; ui: UIBlock[] },
    ) => void,
  ) => {
    ipcRenderer.on("agent-done", (_e, requestId, reply) =>
      callback(requestId, reply),
    );
  },
  onAgentError: (callback: (requestId: string, message: string) => void) => {
    ipcRenderer.on("agent-error", (_e, requestId, message) =>
      callback(requestId, message),
    );
  },
  listMcpConnections: () => ipcRenderer.invoke("list-mcp-connections"),
});
