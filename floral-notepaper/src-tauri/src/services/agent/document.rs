use crate::services::notes::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;
const MAX_CHUNK_CHARS: usize = 1200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureDocumentSource {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub id: String,
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    pub content: String,
    pub order: usize,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub source: ArchitectureDocumentSource,
    pub content: String,
    pub chunks: Vec<DocumentChunk>,
}

fn clean_text(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = Vec::new();
    let mut previous_blank = false;
    for raw_line in normalized.lines() {
        let line: String = raw_line
            .chars()
            .filter(|character| *character == '\t' || !character.is_control())
            .collect();
        let line = line.trim_end().to_string();
        let blank = line.trim().is_empty();
        if blank && previous_blank {
            continue;
        }
        lines.push(if blank { String::new() } else { line });
        previous_blank = blank;
    }
    lines.join("\n").trim().to_string()
}

fn split_end(text: &str) -> usize {
    if text.chars().count() <= MAX_CHUNK_CHARS {
        return text.len();
    }
    let hard_end = text
        .char_indices()
        .nth(MAX_CHUNK_CHARS)
        .map(|(index, _)| index)
        .unwrap_or(text.len());
    let candidate = &text[..hard_end];
    candidate
        .char_indices()
        .rev()
        .find(|(_, character)| matches!(character, '\n' | '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';'))
        .map(|(index, character)| index + character.len_utf8())
        .filter(|end| candidate[..*end].chars().count() >= MAX_CHUNK_CHARS / 2)
        .unwrap_or(hard_end)
}

fn push_section_chunks(
    chunks: &mut Vec<DocumentChunk>,
    document_id: &str,
    heading: &Option<String>,
    content: &str,
    section_start: usize,
) {
    let leading = content.len() - content.trim_start().len();
    let mut rest = content.trim();
    let mut offset = section_start + leading;
    while !rest.is_empty() {
        let end = split_end(rest);
        let part = rest[..end].trim();
        if !part.is_empty() {
            let part_start = rest[..end].find(part).unwrap_or(0);
            let start_offset = offset + part_start;
            chunks.push(DocumentChunk {
                id: format!("{document_id}-chunk-{}", chunks.len() + 1),
                document_id: document_id.to_string(),
                heading: heading.clone(),
                content: part.to_string(),
                order: chunks.len(),
                start_offset,
                end_offset: start_offset + part.len(),
            });
        }
        let tail = &rest[end..];
        let trimmed_tail = tail.trim_start();
        offset += end + (tail.len() - trimmed_tail.len());
        rest = trimmed_tail;
    }
}

pub fn parse_text_document(
    source: ArchitectureDocumentSource,
    content: &str,
) -> Result<ParsedDocument, AppError> {
    if content.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::new("documentTooLarge", "文档超过 5MB 限制"));
    }
    if !matches!(source.mime_type.as_str(), "text/plain" | "text/markdown" | "text/x-markdown") {
        return Err(AppError::new("unsupportedDocument", "仅支持 Markdown 和 TXT 文档"));
    }
    let cleaned = clean_text(content);
    if cleaned.is_empty() {
        return Err(AppError::new("emptyDocument", "文档内容为空"));
    }

    let markdown = source.mime_type != "text/plain";
    let mut chunks = Vec::new();
    let mut heading = None;
    let mut section_start = 0;
    let mut section = String::new();
    let mut cursor = 0;

    for line in cleaned.split_inclusive('\n') {
        let line_without_newline = line.trim_end_matches('\n');
        let trimmed = line_without_newline.trim();
        let is_heading = markdown
            && trimmed.starts_with('#')
            && trimmed.chars().take_while(|character| *character == '#').count() <= 6
            && trimmed.trim_start_matches('#').starts_with(char::is_whitespace);
        if is_heading {
            push_section_chunks(&mut chunks, &source.id, &heading, &section, section_start);
            section.clear();
            heading = Some(trimmed.trim_start_matches('#').trim().to_string());
            section_start = cursor + line.len();
        } else {
            if section.is_empty() {
                section_start = cursor;
            }
            section.push_str(line);
        }
        cursor += line.len();
    }
    push_section_chunks(&mut chunks, &source.id, &heading, &section, section_start);

    Ok(ParsedDocument { source, content: cleaned, chunks })
}

pub fn parse_note(id: &str, title: &str, content: &str) -> Result<ParsedDocument, AppError> {
    parse_text_document(
        ArchitectureDocumentSource {
            kind: "note".to_string(),
            id: id.to_string(),
            title: title.trim().to_string(),
            mime_type: "text/markdown".to_string(),
            path: None,
        },
        content,
    )
}

pub fn parse_file(path: impl AsRef<Path>) -> Result<ParsedDocument, AppError> {
    let path = path.as_ref();
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        _ => return Err(AppError::new("unsupportedDocument", "仅支持 .md、.markdown 和 .txt 文件")),
    };
    let metadata = std::fs::metadata(path)
        .map_err(|error| AppError::new("documentRead", format!("读取文档失败: {error}")))?;
    if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err(AppError::new("documentTooLarge", "文档超过 5MB 限制"));
    }
    let bytes = std::fs::read(path)
        .map_err(|error| AppError::new("documentRead", format!("读取文档失败: {error}")))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::new("documentEncoding", "文档必须为 UTF-8 编码"))?;
    let canonical_path = path.canonicalize()
        .map_err(|error| AppError::new("documentRead", format!("读取文档失败: {error}")))?;
    let id = format!("file:{}", canonical_path.to_string_lossy());
    let title = path.file_stem().and_then(|value| value.to_str()).unwrap_or("未命名文档");
    parse_text_document(
        ArchitectureDocumentSource {
            kind: "file".to_string(),
            id,
            title: title.to_string(),
            mime_type: mime_type.to_string(),
            path: Some(canonical_path.to_string_lossy().to_string()),
        },
        &content,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(mime_type: &str) -> ArchitectureDocumentSource {
        ArchitectureDocumentSource {
            kind: "note".to_string(),
            id: "doc-1".to_string(),
            title: "测试".to_string(),
            mime_type: mime_type.to_string(),
            path: None,
        }
    }

    #[test]
    fn cleans_text_and_preserves_heading_metadata() {
        let parsed = parse_text_document(source("text/markdown"), "# 架构\r\n\r\n\r\nAPI  \r\n\0\r\n## 数据\r\nDB").unwrap();
        assert_eq!(parsed.content, "# 架构\n\nAPI\n\n## 数据\nDB");
        assert_eq!(parsed.chunks.len(), 2);
        assert_eq!(parsed.chunks[0].heading.as_deref(), Some("架构"));
        assert_eq!(parsed.chunks[1].heading.as_deref(), Some("数据"));
        assert_eq!(&parsed.content[parsed.chunks[0].start_offset..parsed.chunks[0].end_offset], "API");
    }

    #[test]
    fn splits_long_cjk_text_at_sentence_boundary() {
        let content = format!("{}。{}。", "甲".repeat(700), "乙".repeat(700));
        let parsed = parse_text_document(source("text/plain"), &content).unwrap();
        assert_eq!(parsed.chunks.len(), 2);
        assert!(parsed.chunks[0].content.ends_with('。'));
        assert!(parsed.chunks.iter().all(|chunk| chunk.content.chars().count() <= MAX_CHUNK_CHARS));
    }

    #[test]
    fn validates_empty_unsupported_and_oversized_documents() {
        assert_eq!(parse_text_document(source("text/plain"), " \n ").unwrap_err().code, "emptyDocument");
        assert_eq!(parse_text_document(source("application/pdf"), "x").unwrap_err().code, "unsupportedDocument");
        assert_eq!(parse_text_document(source("text/plain"), &"字".repeat(MAX_DOCUMENT_BYTES)).unwrap_err().code, "documentTooLarge");
    }

    #[test]
    fn parses_utf8_txt_file_with_source_metadata() {
        let path = std::env::temp_dir().join(format!("floral-document-{}.txt", std::process::id()));
        std::fs::write(&path, "中文内容").unwrap();
        let parsed = parse_file(&path).unwrap();
        assert_eq!(parsed.source.kind, "file");
        assert_eq!(parsed.source.mime_type, "text/plain");
        assert_eq!(parsed.source.title, path.file_stem().unwrap().to_string_lossy());
        assert_eq!(parsed.chunks[0].content, "中文内容");
        std::fs::remove_file(path).unwrap();
    }
}
