export interface DemoAPI {
  ping: () => Promise<{ message: string; timestamp: number }>;
  showSaveDialog: () => Promise<{ canceled: boolean; filePath: string | null }>;
  onMenuPing: (callback: () => void) => void;
  askAgent: (message: string) => Promise<string>;
}

declare global {
  interface Window {
    demoAPI: DemoAPI;
  }
}
