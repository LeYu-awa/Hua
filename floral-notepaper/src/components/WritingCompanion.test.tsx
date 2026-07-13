// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WritingCompanion } from "./WritingCompanion";

afterEach(cleanup);

// 场景四：焦虑关怀提示（可观察 + 可忽略 + 不评价）
describe("WritingCompanion — 场景四焦虑关怀", () => {
  it("alertMessage 非空时立即渲染关怀气泡", () => {
    render(
      <WritingCompanion
        enabled
        thresholdMs={20_000}
        lastActivityAt={Date.now()}
        alertMessage="卡在这里了？先写别的段落也可以。"
      />,
    );
    expect(screen.getByText("卡在这里了？先写别的段落也可以。")).toBeTruthy();
  });

  it("点击忽略后回调触发且提示消失", () => {
    const onAlertDismiss = vi.fn();
    const { rerender } = render(
      <WritingCompanion
        enabled
        thresholdMs={20_000}
        lastActivityAt={Date.now()}
        alertMessage="要不要先停一下，我在这儿。"
        onAlertDismiss={onAlertDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText("忽略"));
    expect(onAlertDismiss).toHaveBeenCalledTimes(1);
    // 忽略后同一条 alert 不再显示
    rerender(
      <WritingCompanion
        enabled
        thresholdMs={20_000}
        lastActivityAt={Date.now()}
        alertMessage="要不要先停一下，我在这儿。"
        onAlertDismiss={onAlertDismiss}
      />,
    );
    expect(screen.queryByText("要不要先停一下，我在这儿。")).toBeNull();
  });

  it("Agent 关闭时不渲染任何提示", () => {
    render(
      <WritingCompanion
        enabled={false}
        thresholdMs={20_000}
        lastActivityAt={Date.now()}
        alertMessage="这条不该出现"
      />,
    );
    expect(screen.queryByText("这条不该出现")).toBeNull();
  });

  it("无 alert 且未到停顿阈值时不打扰", () => {
    render(
      <WritingCompanion enabled thresholdMs={20_000} lastActivityAt={Date.now()} />,
    );
    // 刚活动过、无 alert → 角落无提示
    expect(screen.queryByRole("status")).toBeNull();
  });
});
