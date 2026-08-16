import { useEffect, useState } from "react";
import { loadCompanionConfig } from "../companionConfig";
import { useCompanionEvents } from "../useCompanionEvents";
import type { CompanionConfig } from "../types";

export function CompanionEventBridge() {
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());
  const bridgeConfig = {
    ...config,
    enabled: config.enabled && config.visible && config.mode === "floating",
  };

  useCompanionEvents(bridgeConfig);

  useEffect(() => {
    const handleConfigChanged = () => setConfig(loadCompanionConfig());
    window.addEventListener("companion-config-changed", handleConfigChanged);
    return () => window.removeEventListener("companion-config-changed", handleConfigChanged);
  }, []);

  return null;
}
