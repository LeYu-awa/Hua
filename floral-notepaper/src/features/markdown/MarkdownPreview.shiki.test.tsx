// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview Shiki 集成", () => {
  it("代码块显示语言标签并渲染 One Dark Pro 彩色 token", async () => {
    render(
      <MarkdownPreview
        content={'```ts\nconst greet = (name: string) => name;\n// hello\n```'}
      />,
    );

    // 语言标签从 hast 的 language-ts 提取（验证 pre 组件修复）
    await waitFor(() => {
      expect(screen.getByText("ts")).toBeTruthy();
    });

    // Shiki token 以内联色值渲染：#C678DD 为 One Dark Pro 关键字紫
    await waitFor(
      () => {
        const keyword = screen.getByText("const");
        expect(keyword.style.color).toBe("rgb(198, 120, 221)");
      },
      { timeout: 10000 },
    );
  });

  it("无语言代码块回退纯文本且不报错", async () => {
    render(<MarkdownPreview content={"```\nplain text\n```"} />);
    await waitFor(() => {
      expect(screen.getByText("plain text")).toBeTruthy();
    });
  });
});
