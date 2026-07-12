import { describe, expect, it } from "vitest";
import { diffText } from "./useInkRecorder";

describe("diffText", () => {
  it("detects a simple insertion", () => {
    expect(diffText("abc", "abxc")).toEqual([{ type: "insert", index: 2, text: "x" }]);
  });

  it("detects a simple deletion", () => {
    expect(diffText("abc", "ac")).toEqual([{ type: "delete", index: 1, length: 1 }]);
  });

  it("detects a replacement", () => {
    expect(diffText("abc", "axc")).toEqual([
      { type: "delete", index: 1, length: 1 },
      { type: "insert", index: 1, text: "x" },
    ]);
  });

  it("returns empty when strings are equal", () => {
    expect(diffText("abc", "abc")).toEqual([]);
  });

  it("detects insertion at the beginning", () => {
    expect(diffText("world", "hello world")).toEqual([
      { type: "insert", index: 0, text: "hello " },
    ]);
  });

  it("detects deletion at the end", () => {
    expect(diffText("hello world", "hello")).toEqual([{ type: "delete", index: 5, length: 6 }]);
  });
});
