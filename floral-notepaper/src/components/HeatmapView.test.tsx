// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeatmapView } from "./HeatmapView";

const TODAY = new Date("2026-08-06T12:00:00+08:00");

class MockResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: (target as HTMLElement).clientWidth } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as ResizeObserver,
    );
  }

  disconnect() {}

  unobserve() {}
}

function setElementWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
}

function cellDates() {
  return screen
    .getAllByTitle(/\d{4}-\d{2}-\d{2}/)
    .map((node) => node.getAttribute("title"));
}

describe("HeatmapView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["desktop", 900],
    ["tablet", 640],
    ["mobile", 360],
  ])("%s 宽度下仅展示截至今天的最近日期", (_device, width) => {
    setElementWidth(width);
    render(<HeatmapView data={[{ date: "2026-08-06", count: 3 }]} />);

    const dates = cellDates();
    expect(dates.at(-1)).toBe("2026-08-06");
    expect(dates).toContain("2026-08-06");
    expect(dates).not.toContain("2026-03-01");
  });

  it("年度模式仍保留全年窗口", () => {
    setElementWidth(360);
    render(<HeatmapView data={[]} rangeMode="year" />);

    const dates = cellDates();
    expect(dates.at(-1)).toBe("2026-08-06");
    expect(dates[0]).toBe("2025-08-04");
  });

  it("热力单元使用主题 CSS 变量以支持深色模式色阶", () => {
    setElementWidth(360);
    render(<HeatmapView data={[{ date: "2026-08-06", count: 8 }]} />);

    const activeCell = screen.getByTitle("2026-08-06") as HTMLElement;
    expect(activeCell.style.backgroundColor).toBe("var(--heatmap-level-4)");
    expect(activeCell.style.border).toBe("1px solid var(--heatmap-cell-border)");
  });

  it("tooltip 使用低调卡片样式，避免绿色外框突出", () => {
    setElementWidth(360);
    render(<HeatmapView data={[{ date: "2026-08-06", count: 8 }]} />);

    fireEvent.mouseEnter(screen.getByTitle("2026-08-06"));
    const tooltipText = screen.getByText("8 次记录");
    expect(tooltipText).toBeTruthy();
    expect(tooltipText.parentElement?.className).toContain("bg-cloud/95");
    expect(tooltipText.parentElement?.className).toContain("rounded-md");
  });
});
