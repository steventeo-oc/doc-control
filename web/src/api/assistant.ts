import { api } from './client';

/**
 * The assistant ("Ask") lives in its own service, mounted under /api/assistant (AI_Assistant_Design_PlanBack.md,
 * section 2.4). These types are that contract; the service is the source of truth.
 */

/** answered: cited from the documents. not_found: the documents do not answer it (the text says what they do say).
 *  unavailable: a model is busy or down; the closest documents are still returned. */
export type AnswerState = 'answered' | 'not_found' | 'unavailable';

export interface AssistantConfig {
  enabled: boolean;
  /** enabled, and open to this user's departments */
  allowed: boolean;
  examples: string[];
  maxQuestionChars: number;
  /** how many documents can be searched right now */
  documents: number;
  /** when the index last caught up with document-control (ISO, UTC) */
  syncedAt: string | null;
}

export interface AssistantSource {
  /** "S1": what the [S1] marks in the answer point at */
  label: string;
  /** null when the source cannot be opened (the development folder source) */
  documentId: string | null;
  documentNumber: string;
  title: string;
  section: string;
  version: number | null;
  /** YYYY-MM-DD */
  effectiveAt: string | null;
  /** the answer cites this passage */
  cited: boolean;
}

export interface AssistantAnswer {
  /** the log row: what feedback refers to */
  id: number;
  state: AnswerState;
  /** plain text with light markdown; never render it as HTML */
  answer: string;
  sources: AssistantSource[];
  index: { syncedAt: string | null; documents: number };
  model: string;
  promptVersion: string;
  ms: number;
  /** the model ran out of room and the answer stops short */
  truncated: boolean;
}

export const assistantApi = {
  config: () => api.get<AssistantConfig>('/assistant/config'),
  ask: (question: string) => api.post<AssistantAnswer>('/assistant/ask', { question }),
  feedback: (id: number, rating: 'up' | 'down', comment?: string) =>
    api.post<void>('/assistant/feedback', { id, rating, comment: comment?.trim() || undefined }),
};
