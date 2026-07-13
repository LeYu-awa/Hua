import { useEffect } from "react";
import { BongoCompanionLayer } from "./BongoCompanionLayer";
import { Live2DCompanionLayer } from "../../live2d/Live2DCompanionLayer";

export function CompanionFloatingPage() {
  useEffect(() => {
    document.documentElement.classList.add("companion-transparent-window");
    document.body.classList.add("companion-transparent-window");
    return () => {
      document.documentElement.classList.remove("companion-transparent-window");
      document.body.classList.remove("companion-transparent-window");
    };
  }, []);

  return (
    <main className="companion-floating-page" aria-label="陪伴悬浮窗">
      <BongoCompanionLayer surface="floating" />
      <Live2DCompanionLayer surface="floating" />
    </main>
  );
}
