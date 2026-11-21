export interface DesktopInfo {
  version: string;
  platform: string;
  updaterAvailable: boolean;
  autostartAvailable?: boolean;
  yaplayAvailable?: boolean;
  trayAvailable?: boolean;
}

export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: NativeBridge;
    YapmodClient?: { version: string };
  }
}

// The builder creates one module scope per plugin instance.
let bridge: NativeBridge | undefined;
export function connect(transport?: NativeBridge) {
  bridge = transport;
}

export function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!bridge) return Promise.reject(new Error("Desktop commands are unavailable."));
  return bridge.invoke<T>(command, args);
}
