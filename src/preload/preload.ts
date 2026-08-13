import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("demoAPI", {
  ping: () => ipcRenderer.invoke("ping"),
  showSaveDialog: () => ipcRenderer.invoke("show-save-dialog"),
  onMenuPing: (callback: () => void) => {
    ipcRenderer.on("menu-ping", callback);
  },
  askAgent: (message: string) => ipcRenderer.invoke("ask-agent", message),
});
