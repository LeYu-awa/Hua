pub mod desktop;
pub mod locales;
pub mod services;

use chrono::{DateTime, Utc};
use locales::Locale;
use services::agent::{
    self, AgentAnalysisResult, AgentCanvasNode, AgentCollaborationSegment, AgentEvent,
    AgentEventInput, AgentReplayMarker, AgentReviewReport, AgentSuggestion,
    llm_provider::agent_embed_text,
    orchestrator::{agent_skill_list, agent_task_confirm, agent_task_create_and_run, agent_task_run},
    rag::{agent_rag_delete_source, agent_rag_index, agent_rag_retrieve, index_source},
    task_store::{
        agent_task_create, agent_task_delete, agent_task_get, agent_task_list,
        agent_task_update_status, AgentTaskStore,
    },
    vector_store::VectorStore,
};
use services::assistant_tools::{
    self, AssistantAgentConfig, AssistantToolLog, AssistantToolRequest, AssistantToolResponse,
    NoteChangeRecord,
};
use services::canvas::{canvas_delete, canvas_get, canvas_list, canvas_save, CanvasStore};
use services::cowrite::{self, CoWriteSession, CoWriteSessionSummary, MergeToNoteResult};
use services::diary::{
    diary_create, diary_delete, diary_get, diary_list, diary_update, DiaryStore,
};
use services::embedding_cache::{
    embedding_cache_clear, embedding_cache_get, embedding_cache_put, EmbeddingCacheStore,
};
use services::ink::{ink_append_events, ink_clear, ink_get_session, ink_list_sessions, InkStore};
use services::notes::{default_store, AppConfig, AppError, Note, NoteMetadata, SaveNoteRequest};
use services::profile::{
    profile_add_historical_doc, profile_clear, profile_get_baseline, profile_list_historical_docs,
    profile_save_baseline, ProfileStore,
};
use services::stats;
use services::workflow_engine::{self, WorkflowDocument, WorkflowValidationResult};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
fn app_name() -> Result<String, AppError> {
    let locale = Locale::from_tag(&default_store()?.load_config()?.locale);
    Ok(locales::app_name(locale).to_string())
}

#[tauri::command]
fn notes_list() -> Result<Vec<NoteMetadata>, AppError> {
    default_store()?.list_notes()
}

#[tauri::command]
fn notes_get(id: String) -> Result<Note, AppError> {
    default_store()?.read_note(&id)
}

#[tauri::command]
async fn notes_create(
    app: AppHandle,
    vectors: tauri::State<'_, VectorStore>,
    request: SaveNoteRequest,
) -> Result<Note, AppError> {
    let note = default_store()?.create_note(request)?;
    // 记忆写入：新笔记落盘即入向量库（best-effort，失败不影响落盘）
    if let Err(error) =
        index_source(&vectors, &format!("note:{}", note.id), &note.content).await
    {
        log::debug!("[memory] 索引新笔记失败: {}", error.message);
    }
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
async fn notes_update(
    app: AppHandle,
    vectors: tauri::State<'_, VectorStore>,
    id: String,
    request: SaveNoteRequest,
) -> Result<Note, AppError> {
    let note = default_store()?.update_note(&id, request)?;
    // 记忆更新：内容变更后重索引（先删源再写入，不残留陈旧块）
    if let Err(error) =
        index_source(&vectors, &format!("note:{}", note.id), &note.content).await
    {
        log::debug!("[memory] 重索引笔记失败: {}", error.message);
    }
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_delete(
    app: AppHandle,
    id: String,
    store: tauri::State<InkStore>,
    vectors: tauri::State<'_, VectorStore>,
) -> Result<(), AppError> {
    default_store()?.delete_note(&id)?;
    let _ = store.clear_note_ink(&id);
    let _ = vectors.delete_source_all_models(&format!("note:{id}"));
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_import_markdown(
    app: AppHandle,
    path: String,
    category: Option<String>,
) -> Result<Note, AppError> {
    let note = default_store()?
        .import_markdown_file(&PathBuf::from(path), &category.unwrap_or_default())?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_export_markdown(id: String, path: String) -> Result<(), AppError> {
    default_store()?.export_markdown_file(&id, &PathBuf::from(path))
}

#[tauri::command]
fn read_external_file(path: String) -> Result<String, AppError> {
    std::fs::read_to_string(&path).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn get_file_modified_time(path: String) -> Result<f64, AppError> {
    let metadata = std::fs::metadata(&path).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let modified = metadata.modified().map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(duration.as_secs_f64() * 1000.0)
}

#[tauri::command]
fn save_external_file(path: String, content: String) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }
    std::fs::write(&path, content).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

/// 保存二进制文件（如对话截图导出的 PNG），按用户选择路径写入
#[tauri::command]
fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }
    std::fs::write(&path, data).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn categories_list() -> Result<Vec<String>, AppError> {
    default_store()?.list_categories()
}

#[tauri::command]
fn categories_create(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.create_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_rename(app: AppHandle, old_name: String, new_name: String) -> Result<(), AppError> {
    default_store()?.rename_category(&old_name, &new_name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_delete(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.delete_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_move_category(
    app: AppHandle,
    id: String,
    category: String,
) -> Result<NoteMetadata, AppError> {
    let result = default_store()?.move_note_to_category(&id, &category)?;
    let _ = app.emit("notes-changed", ());
    Ok(result)
}

#[tauri::command]
fn images_save(note_id: String, data: Vec<u8>, extension: String) -> Result<String, AppError> {
    default_store()?.save_image(&note_id, &data, &extension)
}

#[tauri::command]
fn images_get_base_dir() -> Result<String, AppError> {
    let store = default_store()?;
    store
        .base_dir()
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError {
            code: "path".into(),
            message: "invalid base dir path".into(),
            details: Default::default(),
        })
}

#[tauri::command]
fn images_clean_unused(note_id: String, content: String) -> Result<Vec<String>, AppError> {
    default_store()?.clean_unused_images(&note_id, &content)
}

#[tauri::command]
fn config_get() -> Result<AppConfig, AppError> {
    default_store()?.load_config()
}

#[tauri::command]
fn copy_background_image(_app: AppHandle, source_path: String) -> Result<String, AppError> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err(AppError {
            code: "invalidSource".into(),
            message: "background image source not found".into(),
            details: Default::default(),
        });
    }

    let store = default_store()?;
    let dir = store.base_dir().join("backgrounds");
    fs::create_dir_all(&dir)?;

    let old_config = store.load_config()?;
    if !old_config.background_image_path.is_empty() {
        let old_path = PathBuf::from(&old_config.background_image_path);
        if old_path.starts_with(&dir) && old_path.is_file() {
            let _ = fs::remove_file(&old_path);
        }
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png");
    let dest = dir.join(format!("bg-{}.{}", uuid::Uuid::new_v4(), ext));
    fs::copy(&source, &dest)?;

    dest.to_str().map(str::to_string).ok_or_else(|| AppError {
        code: "path".into(),
        message: "invalid destination path".into(),
        details: Default::default(),
    })
}

#[tauri::command]
fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let previous = store.load_config()?;
    desktop::apply_runtime_config(&app, &previous, &config).map_err(|error| {
        match error.downcast::<AppError>() {
            Ok(app_error) => *app_error,
            Err(error) => AppError {
                code: "desktopConfig".into(),
                message: error.to_string(),
                details: Default::default(),
            },
        }
    })?;
    let saved = store.save_config(config)?;
    if let Err(error) = desktop::refresh_shell_state(&app, &saved) {
        eprintln!("failed to refresh desktop shell state: {error}");
    }
    let _ = app.emit("config-changed", &saved);
    Ok(saved)
}

#[tauri::command]
fn global_shortcut_check(
    app: AppHandle,
    shortcut: String,
) -> Result<desktop::ShortcutCheckResult, AppError> {
    desktop::check_global_shortcut(&app, &shortcut)
}

#[tauri::command]
fn start_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::start_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn stop_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::stop_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
async fn open_notepad_window(
    app: AppHandle,
    note_id: Option<String>,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_notepad_window(app, note_id, bounds).await
}

#[tauri::command]
async fn recycle_notepad_window(app: AppHandle, label: String) -> Result<(), AppError> {
    desktop::recycle_notepad_window(&app, &label)
}

#[tauri::command]
async fn open_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn toggle_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<bool, AppError> {
    desktop::toggle_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn open_note_in_editor(app: AppHandle, note_id: String) -> Result<(), AppError> {
    desktop::show_main_window(&app)?;
    let _ = app.emit("open-note", &note_id);
    Ok(())
}

#[tauri::command]
fn take_startup_file() -> Option<String> {
    desktop::take_startup_file()
}

#[tauri::command]
fn stats_get() -> Result<stats::StatsData, AppError> {
    stats::get_stats()
}

#[tauri::command]
fn stats_log_usage(
    provider: String,
    input_tokens: u64,
    output_tokens: u64,
    cached_tokens: u64,
) -> Result<(), AppError> {
    stats::log_usage(provider, input_tokens, output_tokens, cached_tokens)
}

#[tauri::command]
fn agent_record_event(event: AgentEventInput) -> Result<AgentEvent, AppError> {
    agent::record_event(event)
}

#[tauri::command]
fn agent_record_events(events: Vec<AgentEventInput>) -> Result<Vec<AgentEvent>, AppError> {
    agent::record_events(events)
}

#[tauri::command]
fn agent_list_events(
    conversation_id: String,
    limit: Option<u32>,
) -> Result<Vec<AgentEvent>, AppError> {
    agent::list_events(conversation_id, limit)
}

#[tauri::command]
fn agent_list_canvas_nodes(conversation_id: String) -> Result<Vec<AgentCanvasNode>, AppError> {
    agent::list_canvas_nodes(conversation_id)
}

#[tauri::command]
fn agent_analyze_conversation(conversation_id: String) -> Result<AgentAnalysisResult, AppError> {
    agent::analyze_conversation(conversation_id)
}

#[tauri::command]
fn agent_list_suggestions(
    conversation_id: String,
    status: Option<String>,
) -> Result<Vec<AgentSuggestion>, AppError> {
    agent::list_suggestions(conversation_id, status)
}

#[tauri::command]
fn agent_dismiss_suggestion(suggestion_id: String) -> Result<AgentSuggestion, AppError> {
    agent::dismiss_suggestion(suggestion_id)
}

#[tauri::command]
fn agent_accept_suggestion(suggestion_id: String) -> Result<AgentSuggestion, AppError> {
    agent::accept_suggestion(suggestion_id)
}

#[tauri::command]
fn agent_list_replay_markers(conversation_id: String) -> Result<Vec<AgentReplayMarker>, AppError> {
    agent::list_replay_markers(conversation_id)
}

#[tauri::command]
fn agent_list_collaboration_segments(
    conversation_id: String,
) -> Result<Vec<AgentCollaborationSegment>, AppError> {
    agent::list_collaboration_segments(conversation_id)
}

#[tauri::command]
fn agent_generate_review_report(conversation_id: String) -> Result<AgentReviewReport, AppError> {
    agent::generate_review_report(conversation_id)
}

#[tauri::command]
fn agent_record_chat_message_event(
    conversation_id: String,
    message_id: String,
    user_id: String,
    content: String,
    timestamp: Option<DateTime<Utc>>,
) -> Result<AgentEvent, AppError> {
    agent::record_chat_message_event(conversation_id, message_id, user_id, content, timestamp)
}

#[tauri::command]
fn workflow_validate(workflow: WorkflowDocument) -> Result<WorkflowValidationResult, AppError> {
    workflow_engine::validate(workflow)
}

#[tauri::command]
fn workflow_run(workflow: WorkflowDocument) -> Result<WorkflowValidationResult, AppError> {
    workflow_engine::run(workflow)
}

#[tauri::command]
fn cowrite_create_session(
    note_id: String,
    identity: String,
    custom_prompt: Option<String>,
) -> Result<CoWriteSession, AppError> {
    cowrite::create_session(&note_id, &identity, custom_prompt.as_deref())
}

#[tauri::command]
fn cowrite_append_human(session_id: String, text: String) -> Result<CoWriteSession, AppError> {
    cowrite::append_human_text(&session_id, &text)
}

#[tauri::command]
fn cowrite_append_ai(session_id: String, text: String) -> Result<CoWriteSession, AppError> {
    cowrite::append_ai_text(&session_id, &text)
}

#[tauri::command]
async fn cowrite_request_ai(session_id: String) -> Result<CoWriteSession, AppError> {
    cowrite::request_ai_turn(&session_id).await
}

#[tauri::command]
fn cowrite_get_session(session_id: String) -> Result<CoWriteSession, AppError> {
    cowrite::get_session(&session_id)
}

#[tauri::command]
fn cowrite_list_sessions(note_id: String) -> Result<Vec<CoWriteSessionSummary>, AppError> {
    cowrite::list_sessions(&note_id)
}

#[tauri::command]
fn cowrite_merge_to_note(
    app: AppHandle,
    session_id: String,
    selected_block_indices: Vec<usize>,
) -> Result<MergeToNoteResult, AppError> {
    cowrite::merge_to_note(&app, &session_id, &selected_block_indices)
}

#[tauri::command]
fn cowrite_replace_last_ai(session_id: String, text: String) -> Result<CoWriteSession, AppError> {
    cowrite::replace_last_ai_text(&session_id, &text)
}

#[tauri::command]
fn cowrite_undo_last(session_id: String) -> Result<CoWriteSession, AppError> {
    cowrite::undo_last(&session_id)
}

#[tauri::command]
fn cowrite_delete_session(session_id: String) -> Result<(), AppError> {
    cowrite::delete_session(&session_id)
}

/// Toggles the macOS native "document edited" indicator — a dot rendered inside
/// the red traffic-light close button when there are unsaved changes. No-op on
/// other platforms.
#[tauri::command]
fn set_document_edited(window: tauri::Window, edited: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        if let Ok(ptr) = window.ns_window() {
            let ns_window = ptr as *mut AnyObject;
            if !ns_window.is_null() {
                unsafe {
                    let _: () = msg_send![&*ns_window, setDocumentEdited: Bool::new(edited)];
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, edited);
    }
}

#[tauri::command]
async fn assistant_tool_execute(
    request: AssistantToolRequest,
) -> Result<AssistantToolResponse, AppError> {
    assistant_tools::execute_tool(request).await
}

#[tauri::command]
fn assistant_tool_logs(limit: Option<usize>) -> Result<Vec<AssistantToolLog>, AppError> {
    assistant_tools::list_logs(limit.unwrap_or(50))
}

#[tauri::command]
fn assistant_tool_changes(limit: Option<usize>) -> Result<Vec<NoteChangeRecord>, AppError> {
    assistant_tools::list_note_changes(limit.unwrap_or(50))
}

#[tauri::command]
fn note_change_restore(change_id: String) -> Result<(Note, NoteChangeRecord), AppError> {
    assistant_tools::restore_note_change(&change_id)
}

#[tauri::command]
fn assistant_agent_config_get() -> Result<AssistantAgentConfig, AppError> {
    assistant_tools::load_agent_config()
}

#[tauri::command]
fn assistant_agent_config_save(
    config: AssistantAgentConfig,
) -> Result<AssistantAgentConfig, AppError> {
    assistant_tools::save_agent_config(config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // MCP 模式：`floral-notepaper --mcp` 直接以 stdio 运行 MCP 服务器，跳过 Tauri 初始化
    if crate::services::agent::mcp_server::is_mcp_mode() {
        eprintln!("[mcp] 以 MCP stdio 服务器模式启动");
        let code = match crate::services::agent::mcp_server::run_stdio() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("[mcp] 服务器异常退出: {e}");
                1
            }
        };
        std::process::exit(code);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = desktop::extract_file_arg(&args) {
                let _ = app.emit("open-external-file", file_path);
            }
            let _ = desktop::show_main_window(app);
        }))
        .setup(|app| {
            if let Ok(store) = default_store() {
                let base = store.base_dir().to_path_buf();
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(base.join("images"), true);
                let _ = scope.allow_directory(base.join("backgrounds"), true);
                app.manage(InkStore::new(base.clone()));
                app.manage(CanvasStore::new(base.clone()));
                app.manage(DiaryStore::new(base.clone()));
                app.manage(EmbeddingCacheStore::new(base.clone()));
                app.manage(ProfileStore::new(base.clone()));
                let agent_dir = base.join("agent");
                let _ = std::fs::create_dir_all(&agent_dir);
                app.manage(VectorStore::new(agent_dir.join("agent-vectors.sqlite")));
                app.manage(AgentTaskStore::new(agent_dir.join("agent-tasks.sqlite")));
            }
            desktop::setup_desktop(app)?;
            Ok(())
        })
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            app_name,
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_import_markdown,
            notes_export_markdown,
            notes_move_category,
            read_external_file,
            save_external_file,
            save_binary_file,
            get_file_modified_time,
            categories_list,
            categories_create,
            categories_rename,
            categories_delete,
            images_save,
            images_get_base_dir,
            images_clean_unused,
            config_get,
            copy_background_image,
            config_save,
            global_shortcut_check,
            start_shortcut_recording,
            stop_shortcut_recording,
            open_notepad_window,
            recycle_notepad_window,
            open_tile_window,
            toggle_tile_window,
            open_note_in_editor,
            take_startup_file,
            stats_get,
            stats_log_usage,
            agent_record_event,
            agent_record_events,
            agent_list_events,
            agent_list_canvas_nodes,
            agent_analyze_conversation,
            agent_list_suggestions,
            agent_dismiss_suggestion,
            agent_accept_suggestion,
            agent_list_replay_markers,
            agent_list_collaboration_segments,
            agent_generate_review_report,
            agent_record_chat_message_event,
            workflow_validate,
            workflow_run,
            cowrite_create_session,
            cowrite_append_human,
            cowrite_append_ai,
            cowrite_request_ai,
            cowrite_get_session,
            cowrite_list_sessions,
            cowrite_merge_to_note,
            cowrite_delete_session,
            cowrite_replace_last_ai,
            cowrite_undo_last,
            set_document_edited,
            assistant_tool_execute,
            assistant_tool_logs,
            assistant_tool_changes,
            note_change_restore,
            assistant_agent_config_get,
            assistant_agent_config_save,
            ink_append_events,
            ink_list_sessions,
            ink_get_session,
            ink_clear,
            diary_create,
            diary_get,
            diary_list,
            diary_update,
            diary_delete,
            canvas_save,
            canvas_get,
            canvas_delete,
            canvas_list,
            embedding_cache_get,
            embedding_cache_put,
            embedding_cache_clear,
            profile_get_baseline,
            profile_save_baseline,
            profile_list_historical_docs,
            profile_add_historical_doc,
            profile_clear,
            agent_task_create,
            agent_task_get,
            agent_task_list,
            agent_task_update_status,
            agent_task_delete,
            agent_task_create_and_run,
            agent_task_run,
            agent_task_confirm,
            agent_skill_list,
            agent_embed_text,
            agent_rag_index,
            agent_rag_retrieve,
            agent_rag_delete_source
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Cmd+Q / Quit menu / app.exit(): flag the app as exiting so that any
            // window CloseRequested during teardown is allowed to close instead of
            // being hidden to the Dock.
            tauri::RunEvent::ExitRequested { .. } => {
                desktop::mark_app_exiting(app);
            }
            // macOS: clicking the Dock icon with no visible windows re-shows the
            // main window (the close button only hides it).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    let _ = desktop::show_main_window(app);
                }
            }
            _ => {}
        });
}
