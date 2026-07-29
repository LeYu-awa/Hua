mod agent_bridge;
mod parser;
mod scheduler;
mod types;
mod validation;

pub use types::{WorkflowDocument, WorkflowValidationResult};

use super::notes::AppError;

pub fn validate(workflow: WorkflowDocument) -> Result<WorkflowValidationResult, AppError> {
    let dag = parser::parse_workflow(&workflow);
    Ok(validation::validate_dag(&dag))
}

pub fn run(workflow: WorkflowDocument) -> Result<WorkflowValidationResult, AppError> {
    let dag = parser::parse_workflow(&workflow);
    let result = validation::validate_dag(&dag);
    if result.valid {
        let queue = scheduler::build_task_queue(&dag, &result);
        let _ = agent_bridge::record_workflow_run(&dag, &queue)?;
    }
    Ok(result)
}
