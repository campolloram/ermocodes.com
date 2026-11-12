import { describe, expect, it } from 'vitest';
import { SCENARIOS, runScenario } from '../sim/orchestrator/scenarios';
import { LOG_ROWS, fillOutcome, shownMetrics, trimLog } from './queue-demo-model';

describe('queue demo model', () => {
  const run = runScenario(SCENARIOS['kill-worker']);

  it('keeps at most the window, the kill and the redelivery, and the newest line', () => {
    const lines = trimLog(run.sim.log, LOG_ROWS);
    expect(lines).toHaveLength(LOG_ROWS);
    expect(lines.some((l) => l.level === 'ERROR')).toBe(true);
    expect(lines.some((l) => l.level === 'WARN')).toBe(true);
    expect(lines.at(-1)).toBe(run.sim.log.at(-1));
    // In order, and every dropped line was an INFO line.
    const seqs = lines.map((l) => l.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const kept = new Set(seqs);
    expect(run.sim.log.filter((l) => !kept.has(l.seq)).every((l) => l.level === 'INFO')).toBe(true);
  });

  it('keeps the original charge and the replay of the job the dead worker held, on every seed', () => {
    for (const seed of [1, 2, 7, 99, 123456]) {
      const r = runScenario(SCENARIOS['kill-worker'], { seed });
      const lines = trimLog(r.sim.log, LOG_ROWS);
      const charges = lines.filter((l) => l.src === 'downstream' && l.msg.includes('job=1042'));
      expect(charges, `seed ${seed}`).toHaveLength(2);
      expect(charges[1]?.msg).toContain('replayed');
      expect(lines.at(-1)).toBe(r.sim.log.at(-1));
    }
  });

  it('a prefix of the log gives the window the live demo shows at that moment', () => {
    const all = run.sim.log;
    for (let n = 1; n <= all.length; n += 1) {
      const win = trimLog(all.slice(0, n), LOG_ROWS);
      expect(win.length).toBeLessThanOrEqual(LOG_ROWS);
      expect(win.at(-1)).toBe(all[n - 1]);
    }
  });

  it('drops the oldest line when there is no INFO line left', () => {
    const warn = run.sim.log.filter((l) => l.level !== 'INFO');
    expect(trimLog(warn, 1)).toEqual([warn.at(-1)]);
  });

  it('counts the redelivery as a retry, as the log and the outcome tell it', () => {
    expect(run.sim.metrics.redelivered).toBe(1);
    expect(shownMetrics(run.sim.metrics)).toEqual({
      submitted: 6,
      succeeded: 6,
      retries: 1,
      lost: 0,
    });
    const retryLines = run.sim.log.filter((l) => / retry in |redelivering /.test(` ${l.msg}`));
    expect(shownMetrics(run.sim.metrics).retries).toBe(retryLines.length);
  });

  it('fills the outcome slots from the metrics', () => {
    const text = fillOutcome(
      '{done}/{total} done, {lost} lost, {double} double, {worker}',
      run.sim.metrics,
      'w2',
    );
    expect(text).toBe('6/6 done, 0 lost, 0 double, w2');
  });
});
