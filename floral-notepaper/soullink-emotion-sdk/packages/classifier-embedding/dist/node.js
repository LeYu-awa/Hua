// src/FileEmbeddingVectorCache.ts
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
var FileEmbeddingVectorCache = class {
  directory;
  constructor(options) {
    if (!options.directory.trim()) throw new Error("FileEmbeddingVectorCache requires a directory");
    this.directory = options.directory;
  }
  async load(namespace) {
    try {
      const parsed = JSON.parse(await readFile(this.filePath(namespace), "utf8"));
      return isCacheEntry(parsed) ? parsed : null;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }
  async save(namespace, entry) {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.filePath(namespace), JSON.stringify(entry), "utf8");
  }
  filePath(namespace) {
    const name = createHash("sha256").update(namespace).digest("hex");
    return join(this.directory, `${name}.json`);
  }
};
function isCacheEntry(value) {
  if (!value || typeof value !== "object") return false;
  const record = value;
  return record.version === 1 && Boolean(record.embeddings) && typeof record.embeddings === "object";
}
function isNodeError(value) {
  return value instanceof Error && "code" in value;
}
export {
  FileEmbeddingVectorCache
};
//# sourceMappingURL=node.js.map