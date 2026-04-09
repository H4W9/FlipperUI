import { useEffect } from "react";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { Toolbar } from "./Toolbar";
import { FileList } from "./FileList";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";
import { ProgressBar } from "../ui/ProgressBar";
import { ErrorBanner } from "../ui/ErrorBanner";

export function FileBrowser() {
  const { currentPath, transferProgress } = useFlipperStore();
  const { refresh } = useStorage();

  // Load root directory on mount
  useEffect(() => {
    refresh(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      <ErrorBanner />
      <BreadcrumbBar />
      <Toolbar />
      <FileList />
      {transferProgress !== null && <ProgressBar value={transferProgress} />}
    </div>
  );
}
