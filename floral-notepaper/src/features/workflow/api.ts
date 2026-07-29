import { invoke } from "@tauri-apps/api/core";
import type { WorkflowDocument, WorkflowValidationResult } from "./types";

export function validateWorkflow(workflow: WorkflowDocument): Promise<WorkflowValidationResult> {
  return invoke("workflow_validate", { workflow });
}

export function runWorkflow(workflow: WorkflowDocument): Promise<WorkflowValidationResult> {
  return invoke("workflow_run", { workflow });
}
