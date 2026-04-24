import { useCallback } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { writeFile } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { storageRead } from "../lib/tauri";
import { base64ToUint8Array } from "../lib/encoding";

/**
 * Drag-to-Finder helper: on `dragstart`, reads `remotePath` from the Flipper,
 * writes the bytes to a temp file named `filename`, then hands it to the OS
 * drag session via `@crabnebula/tauri-plugin-drag`.
 *
 * HTML5 drag is suppressed with `preventDefault` so the ghost image the plugin
 * sets up is the one the user sees. Errors (read failure, user cancel) are
 * swallowed — drag cancellation isn't an error the user needs to see.
 */
export function useExportDrag(remotePath: string, filename: string) {
  return useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      try {
        const b64 = await storageRead(remotePath);
        const bytes = base64ToUint8Array(b64);
        const tmp = await tempDir();
        const tmpFile = `${tmp}${filename}`;
        await writeFile(tmpFile, bytes);
        await startDrag({ item: [tmpFile], icon: "" });
      } catch {
        // silently ignore
      }
    },
    [remotePath, filename],
  );
}
