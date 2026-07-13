// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("../features/agent/writingReport", () => ({
  generateWritingReport: vi.fn().mockResolvedValue(null),
}));
vi.mock("../features/agent/profileApi", () => ({
  listHistoricalDocs: () =>
    Promise.resolve([
      { noteId: "a", title: "A", summary: "", deleteRatio: 60 },
      { noteId: "b", title: "B", summary: "", deleteRatio: 61 },
      { noteId: "c", title: "C", summary: "", deleteRatio: 50 },
    ]),
}));

import { WritingReportPage } from "./WritingReportPage";

afterEach(cleanup);

describe("WritingReportPage — 场景十二跨项目画像", () => {
  it("挂载后渲染跨项目写作画像区块", async () => {
    render(<WritingReportPage noteId="demo" providers={[]} />);
    await waitFor(() => expect(screen.getByText("跨项目写作画像")).toBeTruthy());
    // 3 篇历史 + 平均删改率 57%（(60+61+50)/3=57），最近一篇 50% 低于历史 → improving 措辞
    expect(screen.getByText(/已经陪你写了 3 篇/)).toBeTruthy();
    expect(screen.getByText(/更稳/)).toBeTruthy();
  });
});
