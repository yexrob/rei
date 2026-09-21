import type { Result } from './desktop'

export type ReviewScope = 'unstaged' | 'staged'
export type ReviewFile = { path: string; additions: number | null; deletions: number | null; binary: boolean; patch: string | null; truncated: boolean }
export type ReviewSnapshot = {
  status: 'ready' | 'no-workspace' | 'not-repository'
  scope: ReviewScope
  files: ReviewFile[]
  totalFiles: number
  additions: number
  deletions: number
  truncated: boolean
}
export interface BingoReviewApi { snapshot(input: { scope: ReviewScope }): Promise<Result<ReviewSnapshot>> }
export const REVIEW_IPC = { snapshot: 'review:snapshot' } as const

declare global { interface Window { bingoReview?: BingoReviewApi } }
