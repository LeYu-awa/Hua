use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRecord {
    pub text_hash: String,
    pub text: String,
    pub vector: Vec<f32>,
    pub dimension: usize,
    pub provider: String,
    pub expires_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityResult {
    pub text_hash: String,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbeddingError {
    EmptyText,
    InvalidDimension,
}

pub trait EmbeddingProvider {
    fn name(&self) -> &str;
    fn embed(&self, text: &str, dimension: usize) -> Result<Vec<f32>, EmbeddingError>;
}

pub struct DeterministicEmbeddingProvider {
    name: String,
    fail: bool,
}

impl DeterministicEmbeddingProvider {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            fail: false,
        }
    }

    pub fn failing(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            fail: true,
        }
    }
}

impl EmbeddingProvider for DeterministicEmbeddingProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn embed(&self, text: &str, dimension: usize) -> Result<Vec<f32>, EmbeddingError> {
        if self.fail {
            return Err(EmbeddingError::EmptyText);
        }
        if text.trim().is_empty() {
            return Err(EmbeddingError::EmptyText);
        }
        if dimension == 0 {
            return Err(EmbeddingError::InvalidDimension);
        }
        let mut vector = Vec::with_capacity(dimension);
        for index in 0..dimension {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            text.hash(&mut hasher);
            index.hash(&mut hasher);
            self.name.hash(&mut hasher);
            let value = (hasher.finish() % 10_000) as f32 / 10_000.0;
            vector.push(value);
        }
        normalize(vector)
    }
}

pub struct EmbeddingService<P: EmbeddingProvider, F: EmbeddingProvider> {
    primary: P,
    fallback: F,
    dimension: usize,
    ttl_days: i64,
    cache: BTreeMap<String, EmbeddingRecord>,
}

impl<P: EmbeddingProvider, F: EmbeddingProvider> EmbeddingService<P, F> {
    pub fn new(primary: P, fallback: F, dimension: usize) -> Self {
        Self {
            primary,
            fallback,
            dimension,
            ttl_days: 7,
            cache: BTreeMap::new(),
        }
    }

    pub fn embed(&mut self, text: &str) -> Result<EmbeddingRecord, EmbeddingError> {
        if text.trim().is_empty() {
            return Err(EmbeddingError::EmptyText);
        }
        if self.dimension == 0 {
            return Err(EmbeddingError::InvalidDimension);
        }
        let text_hash = hash_text(text);
        if let Some(record) = self.cache.get(&text_hash) {
            if record.expires_at > Utc::now() && record.dimension == self.dimension {
                return Ok(record.clone());
            }
        }

        let (provider, vector) = match self.primary.embed(text, self.dimension) {
            Ok(vector) => (self.primary.name().to_string(), vector),
            Err(_) => (
                self.fallback.name().to_string(),
                self.fallback.embed(text, self.dimension)?,
            ),
        };
        let now = Utc::now();
        let record = EmbeddingRecord {
            text_hash: text_hash.clone(),
            text: text.trim().to_string(),
            vector,
            dimension: self.dimension,
            provider,
            expires_at: now + Duration::days(self.ttl_days),
            updated_at: now,
        };
        self.cache.insert(text_hash, record.clone());
        Ok(record)
    }

    pub fn upsert_vector(&mut self, record: EmbeddingRecord) {
        self.cache.insert(record.text_hash.clone(), record);
    }

    pub fn similar(&self, vector: &[f32], top_n: usize) -> Vec<SimilarityResult> {
        let mut results: Vec<_> = self
            .cache
            .values()
            .map(|record| SimilarityResult {
                text_hash: record.text_hash.clone(),
                text: record.text.clone(),
                score: cosine_similarity(vector, &record.vector),
            })
            .collect();
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(top_n);
        results
    }

    pub fn cache_len(&self) -> usize {
        self.cache.len()
    }
}

fn hash_text(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.trim().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn normalize(mut vector: Vec<f32>) -> Result<Vec<f32>, EmbeddingError> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm == 0.0 {
        return Ok(vector);
    }
    for value in &mut vector {
        *value /= norm;
    }
    Ok(vector)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    let len = left.len().min(right.len());
    if len == 0 {
        return 0.0;
    }
    left.iter()
        .take(len)
        .zip(right.iter().take(len))
        .map(|(l, r)| l * r)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_embedding_for_same_text() {
        let mut service = EmbeddingService::new(
            DeterministicEmbeddingProvider::new("primary"),
            DeterministicEmbeddingProvider::new("fallback"),
            8,
        );
        let first = service.embed("栀子花").unwrap();
        let second = service.embed("栀子花").unwrap();
        assert_eq!(first.text_hash, second.text_hash);
        assert_eq!(service.cache_len(), 1);
    }

    #[test]
    fn falls_back_when_primary_fails() {
        let mut service = EmbeddingService::new(
            DeterministicEmbeddingProvider::failing("primary"),
            DeterministicEmbeddingProvider::new("fallback"),
            4,
        );
        let record = service.embed("用户行为文本").unwrap();
        assert_eq!(record.provider, "fallback");
        assert_eq!(record.vector.len(), 4);
    }

    #[test]
    fn returns_top_similarity() {
        let mut service = EmbeddingService::new(
            DeterministicEmbeddingProvider::new("primary"),
            DeterministicEmbeddingProvider::new("fallback"),
            4,
        );
        let record = service.embed("画布节点文本").unwrap();
        service.embed("另一段文本").unwrap();
        let results = service.similar(&record.vector, 1);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].text_hash, record.text_hash);
    }
}
