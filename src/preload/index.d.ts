export interface DemoAPI {
  ping: () => Promise<{ message: string; timestamp: number }>;
  showSaveDialog: () => Promise<{ canceled: boolean; filePath: string | null }>;
  onMenuPing: (callback: () => void) => void;
}

declare global {
  interface Window {
    demoAPI: DemoAPI;
  }
}
