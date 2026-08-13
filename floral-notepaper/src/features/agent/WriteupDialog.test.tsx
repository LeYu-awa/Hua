// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WriteupDialog } from "./WriteupDialog";

describe("WriteupDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when closed", () => {
    render(<WriteupDialog open={false} nodeIds={["n1"]} onClose={() => {}} onStart={() => {}} />);
    expect(screen.queryByText("整理成文")).toBeNull();
  });

  it("encodes selected kind, intent and card ids into the goal", () => {
    const onStart = vi.fn();
    render(
      <WriteupDialog open nodeIds={["n1", "n2", "n3"]} onClose={() => {}} onStart={onStart} />,
    );

    // 默认初稿；切到"设定集"
    fireEvent.click(screen.getByText("设定集"));
    fireEvent.change(screen.getByPlaceholderText("补充一句你想怎么写（可选）"), {
      target: { value: "角色的矛盾" },
    });
    fireEvent.click(screen.getByText("开始整理"));

    expect(onStart).toHaveBeenCalledTimes(1);
    const goal = onStart.mock.calls[0][0] as string;
    expect(goal).toContain("整理成文：设定集");
    expect(goal).toContain("意图：角色的矛盾");
    expect(goal).toContain("卡片：n1,n2,n3");
  });

  it("shows the selected card count", () => {
    render(<WriteupDialog open nodeIds={["n1", "n2"]} onClose={() => {}} onStart={() => {}} />);
    expect(screen.getByText(/将整理 2 张卡片/)).toBeTruthy();
  });

  it("does not start when no cards are selected", () => {
    const onStart = vi.fn();
    render(<WriteupDialog open nodeIds={[]} onClose={() => {}} onStart={onStart} />);
    fireEvent.click(screen.getByText("开始整理"));
    expect(onStart).not.toHaveBeenCalled();
  });
});
