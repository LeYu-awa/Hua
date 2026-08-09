//! 输出总线（Phase E）：Agent 产出 → 统一分发到 Live2D / 画布 / 语音 / UI 事件
//!
//! 前端只消费事件，不感知 Rust 内部编排。AppHandle 可选（测试传 None）。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// 输出通道
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputChannel {
    /// Live2D 情绪/动作/气泡（消费 agent.live2d）
    Live2D,
    /// 画布写入（消费 agent.canvas）
    Canvas,
    /// 语音播报（消费 agent.speech）
    Speech,
    /// UI 事件（进度/预览/确认，消费 agent.ui）
    Ui,
}

/// 统一输出信封
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutput {
    pub output_id: String,
    pub task_id: String,
    pub channel: OutputChannel,
    pub payload: Value,
    pub created_at: String,
}

impl AgentOutput {
    pub fn new(task_id: impl Into<String>, channel: OutputChannel, payload: Value) -> Self {
        Self {
            output_id: format!("out-{}", Utc::now().timestamp_millis()),
            task_id: task_id.into(),
            channel,
            payload,
            created_at: Utc::now().to_rfc3339(),
        }
    }
}

/// 通道名 → Tauri 事件名
pub fn event_for(channel: OutputChannel) -> &'static str {
    match channel {
        OutputChannel::Live2D => "agent.live2d",
        OutputChannel::Canvas => "agent.canvas",
        OutputChannel::Speech => "agent.speech",
        OutputChannel::Ui => "agent.ui",
    }
}

/// 分发一条输出（emit 对应通道事件）
pub fn dispatch(app: Option<&AppHandle>, output: AgentOutput) {
    let Some(app) = app else { return };
    let event = event_for(output.channel);
    let _ = app.emit(event, &output);
}

/// 便捷构造：Live2D 信号
pub fn live2d(
    app: Option<&AppHandle>,
    task_id: &str,
    action: &str,
    priority: i64,
    text: &str,
) {
    dispatch(
        app,
        AgentOutput::new(
            task_id,
            OutputChannel::Live2D,
            serde_json::json!({
                "action": action,
                "priority": priority,
                "text": text,
            }),
        ),
    );
}

/// 便捷构造：语音播报
pub fn speech(app: Option<&AppHandle>, task_id: &str, text: &str) {
    dispatch(
        app,
        AgentOutput::new(
            task_id,
            OutputChannel::Speech,
            serde_json::json!({ "text": text }),
        ),
    );
}

/// 便捷构造：UI 事件
pub fn ui(app: Option<&AppHandle>, task_id: &str, payload: Value) {
    dispatch(
        app,
        AgentOutput::new(task_id, OutputChannel::Ui, payload),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_maps_to_event_name() {
        assert_eq!(event_for(OutputChannel::Live2D), "agent.live2d");
        assert_eq!(event_for(OutputChannel::Canvas), "agent.canvas");
        assert_eq!(event_for(OutputChannel::Speech), "agent.speech");
        assert_eq!(event_for(OutputChannel::Ui), "agent.ui");
    }

    #[test]
    fn builds_output_envelope() {
        let output = AgentOutput::new("t1", OutputChannel::Speech, serde_json::json!({"text": "hi"}));
        assert_eq!(output.task_id, "t1");
        assert_eq!(output.channel, OutputChannel::Speech);
        assert_eq!(output.payload["text"], "hi");
    }

    #[test]
    fn dispatch_without_app_is_noop() {
        // 测试环境没有 AppHandle → 不应 panic
        live2d(None, "t1", "complete", 80, "完成了");
        speech(None, "t1", "语音");
    }
}
