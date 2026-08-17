import { describe, expect, it } from "vitest";
import { shouldOpenExternally } from "./externalLinks";

const APP_ORIGIN = "tauri://localhost";

describe("shouldOpenExternally", () => {
  it("外部 http/https 链接判定为外部", () => {
    expect(shouldOpenExternally("https://github.com/tauri-apps/tauri", APP_ORIGIN)).toBe(true);
    expect(shouldOpenExternally("http://127.0.0.1:8188", APP_ORIGIN)).toBe(true);
  });

  it("同源链接不拦截", () => {
    expect(shouldOpenExternally("tauri://localhost/?view=notepad", APP_ORIGIN)).toBe(false);
    expect(shouldOpenExternally("tauri://localhost/#anchor", APP_ORIGIN)).toBe(false);
  });

  it("mailto / tel 一律视为外部", () => {
    expect(shouldOpenExternally("mailto:someone@example.com", APP_ORIGIN)).toBe(true);
    expect(shouldOpenExternally("tel:+8613800138000", APP_ORIGIN)).toBe(true);
  });

  it("非法 URL 不拦截", () => {
    expect(shouldOpenExternally("not a url", APP_ORIGIN)).toBe(false);
    expect(shouldOpenExternally("", APP_ORIGIN)).toBe(false);
  });
});
