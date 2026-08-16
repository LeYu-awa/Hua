/**
 * 为内置 Live2D 模型生成 Soullink 专属 Profile（soullink.profile.json）。
 *
 * 使用 @soullink-emotion/profile-generator 的确定性启发式模式（无需 API Key），
 * 读取各模型的 .model3.json / .cdi3.json / .exp3.json / .motion3.json，
 * 输出 parameterMap / idleConfig / neutralParams / parameterSmoothing /
 * nativeAnimationCatalog 等模型专属配置，供 runtime-core 会话运行时加载。
 *
 * 运行：npm run profiles:generate
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const modelsRoot = path.join(projectRoot, "public", "live2d");

/** 生成任务：modelsRoot（生成器根目录）+ modelDir + 展示名 */
const JOBS = [
  {
    modelsRoot,
    modelsBaseUrl: "/live2d",
    modelDir: "haru",
    displayName: "Haru",
  },
  {
    modelsRoot,
    modelsBaseUrl: "/live2d",
    modelDir: "hiyori",
    displayName: "Hiyori",
  },
  {
    // 水瓶座之恋的 model3 位于 aquarius-love/model-4096 子目录，
    // 而生成器要求 modelDir 为单层目录名，因此以 aquarius-love 为根。
    modelsRoot: path.join(modelsRoot, "aquarius-love"),
    modelsBaseUrl: "/live2d/aquarius-love",
    modelDir: "model-4096",
    displayName: "水瓶座之恋",
  },
];

for (const { modelsRoot: root, modelsBaseUrl, modelDir, displayName } of JOBS) {
  const generator = new Live2DProfileAutoGenerator({
    modelsRoot: root,
    modelsBaseUrl,
    useConfiguredOpenAI: false,
  });
  try {
    const result = await generator.ensure({
      modelDir,
      displayName,
      force: true,
    });
    const profilePath = path.join(root, modelDir, "soullink.profile.json");
    console.log(
      `[soullink-profiles] ${modelDir}: generated=${result.generated} reason=${result.reason} provider=${result.provider}`,
    );
    console.log(`[soullink-profiles] ${modelDir}: -> ${path.relative(projectRoot, profilePath)}`);
    for (const note of result.notes) {
      console.log(`[soullink-profiles] ${modelDir}: note: ${note}`);
    }
  } catch (err) {
    console.error(
      `[soullink-profiles] ${modelDir}: FAILED`,
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
  }
}

console.log("[soullink-profiles] done");
