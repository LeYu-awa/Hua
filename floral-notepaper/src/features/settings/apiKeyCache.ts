import type { AppConfig, ProviderConfig } from "./types";

const API_KEY_CACHE_KEY = "floral_notepaper_provider_api_keys_v1";

type ApiKeyCache = Record<string, string>;

function readApiKeyCache(): ApiKeyCache {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(API_KEY_CACHE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ApiKeyCache)
      : {};
  } catch {
    return {};
  }
}

function writeApiKeyCache(cache: ApiKeyCache): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(API_KEY_CACHE_KEY, JSON.stringify(cache));
}

function providerCacheKeys(provider: ProviderConfig): string[] {
  return [provider.id, `${provider.protocol}:${provider.baseUrl}:${provider.name}`];
}

export function cacheProviderApiKeys(providers: ProviderConfig[] = []): void {
  const cache = readApiKeyCache();
  let changed = false;

  for (const provider of providers) {
    const apiKey = provider.apiKey?.trim();
    if (!apiKey) continue;
    for (const key of providerCacheKeys(provider)) {
      if (cache[key] !== apiKey) {
        cache[key] = apiKey;
        changed = true;
      }
    }
  }

  if (changed) writeApiKeyCache(cache);
}

export function withCachedProviderApiKeys<T extends { providers?: ProviderConfig[] }>(config: T): T {
  const providers = config.providers ?? [];
  if (providers.length === 0) return config;

  const cache = readApiKeyCache();
  return {
    ...config,
    providers: providers.map((provider) => {
      if (provider.apiKey) return provider;
      const cached = providerCacheKeys(provider).map((key) => cache[key]).find(Boolean);
      return cached ? { ...provider, apiKey: cached } : provider;
    }),
  };
}

export function stripProviderApiKeys<T extends { providers?: ProviderConfig[] }>(config: T): T {
  const providers = config.providers ?? [];
  if (providers.length === 0) return config;
  return {
    ...config,
    providers: providers.map((provider) => ({ ...provider, apiKey: "" })),
  };
}

export function prepareConfigForStorage(config: AppConfig): AppConfig {
  cacheProviderApiKeys(config.providers ?? []);
  return stripProviderApiKeys(config);
}

export function hydrateConfigFromCache(config: AppConfig): AppConfig {
  cacheProviderApiKeys(config.providers ?? []);
  return withCachedProviderApiKeys(stripProviderApiKeys(config));
}
