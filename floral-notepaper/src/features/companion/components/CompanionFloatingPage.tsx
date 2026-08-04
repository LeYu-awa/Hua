import { useEffect } from "react";
import { saveCompanionConfig, loadCompanionConfig } from "../companionConfig";

export function CompanionFloatingPage() {
  useEffect(() => {
    saveCompanionConfig({ ...loadCompanionConfig(), mode: "embedded" });
    window.close();
  }, []);

  return null;
}
