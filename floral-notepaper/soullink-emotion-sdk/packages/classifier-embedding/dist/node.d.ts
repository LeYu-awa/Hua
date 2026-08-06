import { i as EmbeddingVectorCache, j as EmbeddingVectorCacheEntry } from './types-DGYznx2s.js';
export { c as EmbeddingClassificationDetail, e as EmbeddingClassificationSource, f as EmbeddingClassifierLogger, g as EmbeddingEmotionScore, h as EmbeddingMatchedExample, b as EmbeddingMessageClassifierOptions, a as EmbeddingProvider, E as EmotionExampleInput, d as EmotionIntentTemplate } from './types-DGYznx2s.js';
import '@soullink-emotion/engine';

interface FileEmbeddingVectorCacheOptions {
    directory: string;
}
declare class FileEmbeddingVectorCache implements EmbeddingVectorCache {
    readonly directory: string;
    constructor(options: FileEmbeddingVectorCacheOptions);
    load(namespace: string): Promise<EmbeddingVectorCacheEntry | null>;
    save(namespace: string, entry: EmbeddingVectorCacheEntry): Promise<void>;
    private filePath;
}

export { EmbeddingVectorCache, EmbeddingVectorCacheEntry, FileEmbeddingVectorCache, type FileEmbeddingVectorCacheOptions };
