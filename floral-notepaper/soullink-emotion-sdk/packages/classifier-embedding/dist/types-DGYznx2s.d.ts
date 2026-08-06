import { EmotionIntent, VADVector } from '@soullink-emotion/engine';

type EmotionIntentTemplate = Omit<EmotionIntent, "sourceMessage">;
interface EmotionExampleInput {
    text: string;
    intent: EmotionIntentTemplate;
    embedding?: readonly number[] | null;
}
interface EmbeddingProvider<TOptions = unknown> {
    isConfigured?(options?: TOptions): boolean;
    getCacheKey?(options?: TOptions): string;
    embed(text: string, options?: TOptions): Promise<number[]>;
    batchEmbed(texts: string[], options?: TOptions): Promise<number[][]>;
}
interface EmbeddingVectorCacheEntry {
    version: 1;
    embeddings: Readonly<Record<string, readonly number[]>>;
}
interface EmbeddingVectorCache {
    load(namespace: string): Promise<EmbeddingVectorCacheEntry | null>;
    save(namespace: string, entry: EmbeddingVectorCacheEntry): Promise<void>;
}
type EmbeddingClassificationSource = "exact" | "embedding" | "neutral" | "fallback";
interface EmbeddingMatchedExample {
    text: string;
    emotion: string;
    variant?: string;
    intensity: number;
    similarity: number;
    weight: number;
}
interface EmbeddingEmotionScore {
    emotion: string;
    score: number;
    share: number;
}
interface EmbeddingClassificationDetail {
    intent: EmotionIntent;
    source: EmbeddingClassificationSource;
    confidence: number;
    similarity: number;
    naturalVAD: VADVector;
    matchedExamples: EmbeddingMatchedExample[];
    emotionScores: EmbeddingEmotionScore[];
    cacheHit: boolean;
    fallbackReason?: string;
}
interface EmbeddingClassifierLogger {
    debug?(message: string): void;
    warn?(message: string): void;
    error?(message: string, error?: unknown): void;
}
interface EmbeddingMessageClassifierOptions {
    /** Cosine similarity must be greater than this value to accept a match. */
    similarityThreshold?: number;
    /** Number of nearest examples used for weighted voting. Defaults to 5. */
    topK?: number;
    /** Maximum normalized query results retained in memory. Set to 0 to disable. */
    queryCacheSize?: number;
    /** Maximum examples sent to the provider in one initialization request. */
    initializationBatchSize?: number;
    /** Optional persistent cache for the built-in and dynamic example vectors. */
    embeddingCache?: EmbeddingVectorCache;
    /** Required for persistent caching when the provider has no getCacheKey(). */
    embeddingCacheKey?: string;
    includeDefaultExamples?: boolean;
    examples?: readonly EmotionExampleInput[];
    fallbackClassifier?: (message: string) => EmotionIntent | Promise<EmotionIntent>;
    logger?: EmbeddingClassifierLogger;
}

export type { EmotionExampleInput as E, EmbeddingProvider as a, EmbeddingMessageClassifierOptions as b, EmbeddingClassificationDetail as c, EmotionIntentTemplate as d, EmbeddingClassificationSource as e, EmbeddingClassifierLogger as f, EmbeddingEmotionScore as g, EmbeddingMatchedExample as h, EmbeddingVectorCache as i, EmbeddingVectorCacheEntry as j };
