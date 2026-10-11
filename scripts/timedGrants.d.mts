// 型定義（src/lib/timedGrants.test.ts から scripts/timedGrants.mjs を読むため）
export const MAX_TTL_MS: number;
export const CLOCK_SKEW_MS: number;
export type TimedGrant = { label?: string; sha256?: unknown; issuedAt?: unknown; expiresAt?: unknown };
export type TimedGrantVerdict = { valid: boolean; reason: string };
export function judgeTimedGrant(grant: unknown, now: number): TimedGrantVerdict;
export function activeTimedGrantHashes(grants: unknown, now?: number): string[];
export function summarizeTimedGrants(grants: unknown, now?: number): { active: number; rejected: Record<string, number> };
export function composeActiveHashes(args: {
  stripeHashes?: string[];
  manualHashes?: string[];
  timedGrants?: unknown;
  now?: number;
}): string[];
export function pruneExpiredTimedHashes(prevActive: unknown, timedGrants: unknown, now?: number): unknown;
