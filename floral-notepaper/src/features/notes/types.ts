export interface NoteMetadata {
  id: string;
  title: string;
  fileName: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  preview: string;
  filePath?: string;
}

export interface Note extends Omit<NoteMetadata, "preview"> {
  content: string;
  preview?: string;
  filePath?: string;
}

export interface SaveNoteRequest {
  title: string;
  content: string;
  category: string;
}

export interface ExternalFile {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
}
