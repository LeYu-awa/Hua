import { describe, expect, it } from "vitest";
import { summarizeWritingProfile, type HistoricalDocLike } from "./writingProfile";

function doc(noteId: string, deleteRatio: number): HistoricalDocLike {
  return { noteId, title: noteId, summary: "", deleteRatio };
}

describe("summarizeWritingProfile", () => {
  it("无历史返回 null（可降级）", () => {
    expect(summarizeWritingProfile([])).toBeNull();
  });

  it("单篇：趋势未知，均值等于该篇", () => {
    const r = summarizeWritingProfile([doc("a", 50)]);
    expect(r?.docCount).toBe(1);
    expect(r?.avgDeleteRatio).toBe(50);
    expect(r?.trend).toBe("unknown");
  });

  it("删改率下降视为 improving", () => {
    const r = summarizeWritingProfile([doc("a", 60), doc("b", 61), doc("c", 50)]);
    expect(r?.trend).toBe("improving");
  });

  it("删改率上升视为 worsening", () => {
    const r = summarizeWritingProfile([doc("a", 40), doc("b", 41), doc("c", 55)]);
    expect(r?.trend).toBe("worsening");
  });

  it("变化很小视为 steady", () => {
    const r = summarizeWritingProfile([doc("a", 50), doc("b", 51), doc("c", 51)]);
    expect(r?.trend).toBe("steady");
  });

  it("均值四舍五入正确", () => {
    const r = summarizeWritingProfile([doc("a", 50), doc("b", 51)]);
    expect(r?.avgDeleteRatio).toBe(51); // (50+51)/2=50.5 → 51
  });
});
