/**
 * Retry back-off, as Celery's `retry_backoff` + `retry_jitter`:
 * delay = min(maxMs, baseMs · factor^retry), times U(0,1) with full jitter.
 * `retry` is the 0-based retry count (Celery's `request.retries`, `Job.retries`); redeliveries
 * don't count. The first retry's ceiling is baseMs.
 */
import type { BackoffConfig, Ms } from './types';

/** The un-jittered delay ceiling for a 0-based retry index. */
export function backoffCeiling(cfg: BackoffConfig, retry: number): Ms {
  const raw = cfg.baseMs * Math.pow(cfg.factor, Math.max(0, retry));
  return Math.floor(Math.min(cfg.maxMs, raw));
}

/** The delay for a retry. `u` is a uniform draw in [0, 1), used only with full jitter. */
export function backoffDelay(cfg: BackoffConfig, retry: number, u: number): Ms {
  const ceiling = backoffCeiling(cfg, retry);
  return cfg.jitter === 'full' ? Math.floor(ceiling * u) : ceiling;
}

/** The range a retry's delay can fall in, for the back-off chart's jitter band. */
export function backoffBand(cfg: BackoffConfig, retry: number): { min: Ms; max: Ms } {
  const ceiling = backoffCeiling(cfg, retry);
  return { min: cfg.jitter === 'full' ? 0 : ceiling, max: ceiling };
}
