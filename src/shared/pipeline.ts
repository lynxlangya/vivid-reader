export interface PipelineStatus {
  state: 'idle' | 'running' | 'done' | 'missing-key' | 'failed';
  chapters: number;
  entities: number;
  completedSteps: number;
}
