// Pure helpers for the queue demo: which log lines to show, the counters, the outcome sentence,
// the speed.
import type { LogLine, Metrics } from '../sim/orchestrator/types.ts';

/** Simulated ms per real ms: the 3.7s scenario plays in about 6s. */
export const SIM_SPEED = 0.62;
/** Log lines on screen: while the run plays, at its end, and in the build-time still frame. */
export const LOG_ROWS = 9;

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

/** Jobs whose charge the log must keep: the job a dead worker held, and the one redelivered. */
function keptJobs(all: readonly LogLine[]): Set<string> {
  const jobs = new Set<string>();
  const held = new Map<string, Set<string>>();
  for (const l of all) {
    const job = /\bjobs\.process\[(\d+)\]/.exec(l.msg)?.[1];
    if (job && /received/.test(l.msg)) {
      const set = held.get(l.src) ?? new Set<string>();
      set.add(job);
      held.set(l.src, set);
    }
    const lost = l.level === 'ERROR' ? /celery@(\w+) lost/.exec(l.msg)?.[1] : undefined;
    if (lost) held.get(lost)?.forEach((j) => jobs.add(j));
    const again = /redelivering job (\d+)/.exec(l.msg)?.[1];
    if (again) jobs.add(again);
  }
  return jobs;
}

/**
 * The log window: lines in order, at most `max`; when one more comes in, the oldest INFO line goes
 * first, so the kill and the redelivery stay on screen, and so do the downstream charge lines of the
 * job the dead worker held (the original charge and the replayed one, the proof of idempotency). The still frame is the window at the end of
 * the run, so the live run ends on exactly the lines (and the height) the page was built with.
 */
export function trimLog(all: readonly LogLine[], max: number): LogLine[] {
  const out: LogLine[] = [];
  const kept = keptJobs(all);
  const keep = (x: LogLine) =>
    x.level !== 'INFO' ||
    (x.src === 'downstream' && [...kept].some((j) => x.msg.includes(`job=${j}`)));
  for (const l of all) {
    out.push(l);
    if (out.length > max) {
      const i = out.findIndex((x) => !keep(x));
      out.splice(i < 0 ? 0 : i, 1);
    }
  }
  return out;
}

/** The four counters. "retries" counts every second try, Celery retries and redeliveries alike,
 * so it matches the log and the outcome sentence ("the retry was recognised"). */
export function shownMetrics(
  m: Metrics,
): Record<'submitted' | 'succeeded' | 'retries' | 'lost', number> {
  return {
    submitted: m.submitted,
    succeeded: m.succeeded,
    retries: m.retries + m.redelivered,
    lost: m.lost,
  };
}

/** Fills the `{slot}` placeholders of the outcome sentence. */
export function fillOutcome(template: string, m: Metrics, worker: string): string {
  const slots: Record<string, string | number> = {
    done: m.succeeded,
    total: m.submitted,
    lost: m.lost,
    double: m.duplicateSideEffects,
    worker,
  };
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(slots[k] ?? ''));
}
