import { create } from "zustand";
import type { DeviceInfo, FileEntry, PortInfo } from "../types/flipper";

interface FlipperStore {
  // Device state
  ports: PortInfo[];
  selectedPort: string | null;
  deviceInfo: DeviceInfo | null;
  isConnected: boolean;
  isConnecting: boolean;

  // File browser state
  currentPath: string;
  entries: FileEntry[];
  isLoading: boolean;
  error: string | null;

  // Transfer state (0–100, null when idle)
  transferProgress: number | null;

  // CLI state
  cliVisible: boolean;
  cliConnected: boolean;
  cliHistory: Array<{ type: "input" | "output" | "error"; text: string }>;

  // Screen viewer state
  screenVisible: boolean;

  // Actions
  setPorts: (ports: PortInfo[]) => void;
  setSelectedPort: (port: string | null) => void;
  setConnecting: (connecting: boolean) => void;
  setConnected: (info: DeviceInfo | null) => void;
  setCurrentPath: (path: string) => void;
  setEntries: (entries: FileEntry[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setTransferProgress: (progress: number | null) => void;
  setCliVisible: (visible: boolean) => void;
  setCliConnected: (connected: boolean) => void;
  addCliLine: (line: { type: "input" | "output" | "error"; text: string }) => void;
  clearCli: () => void;
  setScreenVisible: (visible: boolean) => void;
}

export const useFlipperStore = create<FlipperStore>((set) => ({
  ports: [],
  selectedPort: null,
  deviceInfo: null,
  isConnected: false,
  isConnecting: false,
  currentPath: "/ext",
  entries: [],
  isLoading: false,
  error: null,
  transferProgress: null,
  cliVisible: false,
  cliConnected: false,
  cliHistory: [],
  screenVisible: false,

  setPorts: (ports) => set({ ports }),
  setSelectedPort: (selectedPort) => set({ selectedPort }),
  setConnecting: (isConnecting) => set({ isConnecting }),
  setConnected: (deviceInfo) =>
    set({
      deviceInfo,
      isConnected: deviceInfo !== null,
      isConnecting: false,
      // Reset file browser on disconnect
      ...(deviceInfo === null
        ? { currentPath: "/ext", entries: [], error: null, cliVisible: false, cliConnected: false, cliHistory: [], screenVisible: false }
        : {}),
    }),
  setCurrentPath: (currentPath) => set({ currentPath }),
  setEntries: (entries) => set({ entries }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setTransferProgress: (transferProgress) => set({ transferProgress }),
  setCliVisible: (cliVisible) => set({ cliVisible }),
  setCliConnected: (cliConnected) => set({ cliConnected }),
  addCliLine: (line) =>
    set((s) => {
      const MAX_CLI_LINES = 5000;
      const history = [...s.cliHistory, line];
      return { cliHistory: history.length > MAX_CLI_LINES ? history.slice(-MAX_CLI_LINES) : history };
    }),
  clearCli: () => set({ cliHistory: [] }),
  setScreenVisible: (screenVisible) => set({ screenVisible }),
}));
