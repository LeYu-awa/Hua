/**
 * MOC3 格式版本检测：决定 Live2D 模型使用哪种渲染后端。
 *
 * - official：官方 @soullink-emotion/live2d-pixi 的 Live2DRenderer（Pixi v7 + Cubism 4 Core）
 * - legacy：项目保留的 Pixi v8 + @naari3/pixi-live2d-display（Cubism 5 Core）
 *
 * Cubism 4 Core 只能加载 MOC3 v4（含 v3）及更早的模型；MOC3 v5（Cubism 5）
 * 模型必须回退到 legacy 后端，否则会抛 “MOC3 version is newer than the core”。
 */
export type Live2DRenderBackend = "official" | "legacy";

/** 读取 .moc3 文件头部的格式版本（magic "MOC3" + uint32 LE version）。 */
export async function detectMoc3Version(modelUrl: string): Promise<number | null> {
  try {
    const settingsResponse = await fetch(modelUrl);
    if (!settingsResponse.ok) return null;
    const settings = (await settingsResponse.json()) as { FileReferences?: { Moc?: string } };
    const mocRef = settings.FileReferences?.Moc;
    if (!mocRef) return null;

    const mocUrl = new URL(mocRef, modelUrl).pathname;
    const mocResponse = await fetch(mocUrl);
    if (!mocResponse.ok) return null;

    const buffer = await mocResponse.arrayBuffer();
    if (buffer.byteLength < 8) return null;

    const magic = String.fromCharCode(
      new Uint8Array(buffer)[0],
      new Uint8Array(buffer)[1],
      new Uint8Array(buffer)[2],
      new Uint8Array(buffer)[3],
    );
    if (magic !== "MOC3") return null;

    return new DataView(buffer, 0, 8).getUint32(4, true);
  } catch {
    return null;
  }
}

/** 选择渲染后端：v5 及以上回退 legacy，其余走官方 SDK 渲染器。 */
export async function pickLive2DRenderBackend(modelUrl: string): Promise<Live2DRenderBackend> {
  const version = await detectMoc3Version(modelUrl);
  if (version !== null && version >= 5) return "legacy";
  return "official";
}
