import { invoke } from "@tauri-apps/api/core";
import type { CanvasDocument } from "./types";

export function saveCanvasDocument(doc: CanvasDocument): Promise<CanvasDocument> {
  return invoke("canvas_save", { doc });
}

export function getCanvasDocument(id: string): Promise<CanvasDocument> {
  return invoke("canvas_get", { id });
}

export function deleteCanvasDocument(id: string): Promise<void> {
  return invoke("canvas_delete", { id });
}

export function listCanvasDocuments(): Promise<CanvasDocument[]> {
  return invoke("canvas_list");
}
