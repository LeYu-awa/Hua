/**
 * MOC3 格式版本检测：保留诊断能力，但渲染统一走项目自研 Pixi v8 后端。
 *
 * 之前这里按 MOC3 版本把低版本模型分流到 @soullink-emotion/live2d-pixi，
 * 会绕开项目原有自研 v8 渲染器，导致 Hiyori 这类模型进入错误路径。
 */
export type Live2DRenderBackend = "legacy";

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

/** 统一选择项目自研 Pixi v8 渲染后端。 */
export async function pickLive2DRenderBackend(_modelUrl: string): Promise<Live2DRenderBackend> {
  return "legacy";
}
