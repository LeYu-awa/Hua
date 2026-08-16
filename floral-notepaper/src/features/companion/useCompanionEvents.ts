import { useEffect, useMemo, useState } from "react";
import { BongocatActionCore } from "./bongocatActionCore";
import { saveCompanionActionState } from "./companionConfig";
import type { BongocatActionState, CompanionConfig, CompanionInputEvent } from "./types";

export function useCompanionEvents(config: CompanionConfig) {
  const core = useMemo(() => new BongocatActionCore(config.sensitivity), []);
  const [state, setState] = useState<BongocatActionState>(() => core.getState());

  useEffect(() => {
    core.updateSensitivity(config.sensitivity);
  }, [core, config.sensitivity]);

  useEffect(() => {
    const syncState = (next: BongocatActionState) => {
      setState(next);
      saveCompanionActionState(next);
    };

    if (!config.enabled || !config.visible) {
      syncState(core.dispatch({ type: "hide", timestamp: Date.now() }));
      return;
    }

    syncState(core.dispatch({ type: "show", timestamp: Date.now() }));

    const emit = (type: CompanionInputEvent["type"]) => {
      syncState(core.dispatch({ type, timestamp: Date.now() }));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (config.inputMode !== "keyboard") return;

      const key = event.key.toLowerCase();
      const target = event.target;
      const isTextTarget =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        emit("save");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "enter") {
        event.preventDefault();
        emit("complete");
        return;
      }
      if (key === "escape") {
        emit("pause");
        return;
      }
      if (key === "arrowleft" || (!isTextTarget && key === "a")) {
        emit("moveLeft");
        return;
      }
      if (key === "arrowright" || (!isTextTarget && key === "d")) {
        emit("moveRight");
        return;
      }
      if (key === "arrowup" || (!isTextTarget && key === "w")) {
        emit("moveUp");
        return;
      }
      if (key === "arrowdown" || (!isTextTarget && key === "s")) {
        emit("moveDown");
        return;
      }
      if (key === " " || key === "spacebar") {
        if (!isTextTarget) event.preventDefault();
        emit(isTextTarget ? "input" : "effect");
        return;
      }
      if (!isTextTarget) return;
      if (key === "backspace" || key === "delete") {
        emit("delete");
        return;
      }
      if (event.key.length === 1 || key === "enter") {
        emit("input");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    const interval = window.setInterval(
      () => {
        syncState(core.tick(Date.now()));
      },
      Math.max(180, Math.round(config.sensitivity.idleTimeoutMs / 4)),
    );

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.clearInterval(interval);
    };
  }, [config.enabled, config.visible, config.inputMode, config.sensitivity.idleTimeoutMs, core]);

  return state;
}
