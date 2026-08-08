use chrono::Utc;
use serde_json::json;

use super::types::WorkflowDag;
use crate::services::agent::{self, AgentEvent, AgentEventInput};
use crate::services::notes::AppError;

pub fn record_workflow_run(
    dag: &WorkflowDag,
    queue: &[String],
) -> Result<Vec<AgentEvent>, AppError> {
    let conversation_id = dag.workflow_id.clone();
    let timestamp = Utc::now();
    let events = queue
        .iter()
        .enumerate()
        .map(|(index, node_id)| AgentEventInput {
            conversation_id: conversation_id.clone(),
            user_id: "workflow_engine".to_string(),
            event_type: "workflow_node_scheduled".to_string(),
            timestamp: Some(timestamp),
            payload: json!({
                "nodeId": node_id,
                "order": index,
                "workflowId": dag.workflow_id,
            }),
        })
        .collect();

    agent::record_events(events)
}
