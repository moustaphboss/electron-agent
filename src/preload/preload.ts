import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("demoAPI", {
  ping: () => ipcRenderer.invoke("ping"),
  showSaveDialog: () => ipcRenderer.invoke("show-save-dialog"),
  onMenuPing: (callback: () => void) => {
    ipcRenderer.on("menu-ping", callback);
  },
  askAgent: (message: string, mode: "hand-rolled" | "langgraph") =>
    ipcRenderer.invoke("ask-agent", message, mode),
  listMcpConnections: () => ipcRenderer.invoke("list-mcp-connections"),
});
