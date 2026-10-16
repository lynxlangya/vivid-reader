export interface SelectionRange {
  start: string;
  end: string;
}
export interface Citation {
  cfi: string;
  chapter: number;
}
export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
}
export interface AskRequest {
  question: string;
  scope?: 'selection' | 'chapter' | 'to_boundary';
  selection?: SelectionRange;
}
export interface CompanionUpdate {
  messages: ConversationMessage[];
  busy: boolean;
  error?: string;
}
