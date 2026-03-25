export const FAILURE_KINDS = [
  'execution-failed',
  'completion-missing',
  'completion-review-required'
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];
