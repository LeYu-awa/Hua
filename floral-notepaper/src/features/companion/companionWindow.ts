import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { buildCompanionUrl } from "../windows/windowRoutes";
import type { CompanionConfig } from "./types";

const LIVE2D_COMPANION_WINDOW_WIDTH = 260;
const LIVE2D_COMPANION_WINDOW_HEIGHT = 380;

export async function openCompanionWindow(config: CompanionConfig) {
  const position = new LogicalPosition(config.position.x, config.position.y);

  try {
    const existing = await WebviewWindow.getByLabel("companion");
    if (existing) {
      await existing.setPosition(position);
      await existing.setSize(new LogicalSize(LIVE2D_COMPANION_WINDOW_WIDTH, LIVE2D_COMPANION_WINDOW_HEIGHT));
      await existing.show();
      await existing.setFocus();
      return;
    }
  } catch {
    // If lookup is unavailable, fall through and create a new window.
  }

  const companionWindow = new WebviewWindow("companion", {
    url: buildCompanionUrl(),
    title: "Live2D Companion",
    width: LIVE2D_COMPANION_WINDOW_WIDTH,
    height: LIVE2D_COMPANION_WINDOW_HEIGHT,
    minWidth: LIVE2D_COMPANION_WINDOW_WIDTH,
    minHeight: LIVE2D_COMPANION_WINDOW_HEIGHT,
    x: config.position.x,
    y: config.position.y,
    decorations: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    visible: true,
    dragDropEnabled: false,
  });

  await new Promise<void>((resolve, reject) => {
    companionWindow.once("tauri://created", () => resolve());
    companionWindow.once("tauri://error", (event) => reject(event.payload));
  });
}
