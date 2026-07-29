use super::types::{WorkflowDag, WorkflowValidationResult};

pub fn build_task_queue(dag: &WorkflowDag, validation: &WorkflowValidationResult) -> Vec<String> {
    if validation.execution_order.is_empty() {
        return dag.nodes.iter().map(|node| node.id.clone()).collect();
    }
    validation.execution_order.clone()
}
