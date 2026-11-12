import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTerminal } from './engine';
import {
  SCENARIOS,
  advanceScenario,
  isScenarioDone,
  runScenario,
  startScenario,
} from './scenarios';
import {
  NARR_KEYS,
  PHASES,
  WORKER_IDS,
  type Config,
  type Phase,
  type Scenario,
  type ScriptStep,
  type SimState,
  type WorkerId,
} from './types';

const SEEDS = 1000;
const SETTLE_MS = 600_000;

function msgs(s: SimState): string[] {
  return s.log.map((l) => `${l.src} ${l.msg}`);
}

function logSnapshot(s: SimState): string {
  return s.log.map((l) => JSON.stringify(l)).join('\n');
}

/** Runs an ad-hoc script to completion through the scenario runner. */
function runScript(seed: number, cfg: Partial<Config>, script: ScriptStep[]): SimState {
  const scenario: Scenario = { ...SCENARIOS.happy, seed, cfg, script };
  return advanceScenario(scenario, startScenario(scenario), SETTLE_MS).sim;
}

describe('scenarios', () => {
  it('lists only known narration keys', () => {
    for (const sc of Object.values(SCENARIOS)) {
      const keys = [sc.intro, sc.lesson, ...sc.script.flatMap((st) => (st.narr ? [st.narr] : []))];
      for (const k of keys) expect(NARR_KEYS).toContain(k);
    }
  });

  it.each(Object.keys(SCENARIOS))('%s finishes with every job terminal', (id) => {
    const sc = SCENARIOS[id as keyof typeof SCENARIOS];
    const run = runScenario(sc);
    expect(isScenarioDone(sc, run)).toBe(true);
    expect(Object.values(run.sim.jobs).every(isTerminal)).toBe(true);
  });

  it('happy: ten jobs succeed without retries', () => {
    const { sim } = runScenario(SCENARIOS.happy);
    expect(sim.metrics).toMatchObject({ submitted: 10, succeeded: 10, retries: 0, lost: 0 });
  });

  it('kill-worker: worker-2 dies after its side effect and nothing is lost or doubled', () => {
    const run = runScenario(SCENARIOS['kill-worker']);
    const lines = msgs(run.sim);
    const killAt = lines.indexOf('w2 celery@w2 lost (host down)');
    const firstCharge = lines.findIndex((m) =>
      m.startsWith('downstream POST /v1/charges 200 job=1042'),
    );
    expect(killAt).toBeGreaterThan(firstCharge);
    expect(lines).toContain('redis redelivering job 1042 (attempt 2)');
    expect(
      lines.some((m) => /job=1042 Idempotency-Key=\S+ \(replayed, no new charge\)$/.test(m)),
    ).toBe(true);
    expect(run.sim.metrics).toMatchObject({ lost: 0, duplicateSideEffects: 0, succeeded: 6 });
    expect(run.narr).toBe('sim.prompt.kill_w2');
  });

  it.each(['happy', 'kill-worker', 'flaky-downstream'] as const)(
    '%s: orders arrive spread over time, so the log clock moves',
    (id) => {
      const { sim } = runScenario(SCENARIOS[id]);
      const enqueued = sim.log.filter((l) => l.src === 'api').map((l) => l.t);
      expect(new Set(enqueued).size).toBe(enqueued.length);
      expect(enqueued[0]).toBe(0);
    },
  );

  it('kill-worker challenge: acks_late off loses a job', () => {
    const { sim } = runScenario(SCENARIOS['kill-worker'], { patch: { acksLate: false } });
    expect(sim.metrics.lost).toBe(1);
  });

  it('kill-worker challenge: idempotency off double-charges', () => {
    const { sim } = runScenario(SCENARIOS['kill-worker'], { patch: { idempotency: false } });
    expect(sim.metrics.duplicateSideEffects).toBe(1);
  });

  it('flaky-downstream: retries happen and every job still ends terminal', () => {
    const { sim } = runScenario(SCENARIOS['flaky-downstream']);
    expect(sim.metrics.retries).toBeGreaterThan(0);
    expect(sim.metrics.succeeded + sim.metrics.deadLettered).toBe(8);
  });

  it('double-submit: the same Idempotency-Key returns the existing job', () => {
    const { sim } = runScenario(SCENARIOS['double-submit']);
    expect(Object.keys(sim.jobs)).toHaveLength(1);
    expect(msgs(sim)).toContain(
      'api POST /jobs 200 Idempotency-Key=order-7781 returned existing job=1041',
    );
  });

  it('double-submit without API idempotency creates a duplicate job', () => {
    const { sim } = runScenario(SCENARIOS['double-submit'], {
      patch: { apiIdempotency: false, idempotency: false },
    });
    expect(Object.keys(sim.jobs)).toHaveLength(2);
    expect(sim.metrics.duplicateSideEffects).toBe(1);
  });

  it('stops at maxMs when a scenario cannot finish', () => {
    const run = runScenario(SCENARIOS.happy, {
      patch: { workers: 1, autoRestart: false },
      maxMs: 50,
    });
    expect(run.sim.now).toBe(50);
    expect(isScenarioDone(SCENARIOS.happy, run)).toBe(false);
  });

  it('applies script steps at their exact times when advanced in coarse steps', () => {
    const sc = SCENARIOS['double-submit'];
    const run = advanceScenario(sc, startScenario(sc), 1000);
    const second = run.sim.log.find((l) => l.narr === 'sim.api_existing_job');
    expect(second?.t).toBe(250);
    expect(() => advanceScenario(sc, run, -5)).toThrow(RangeError);
  });
});

describe('determinism', () => {
  it.each(Object.keys(SCENARIOS))('%s log matches its snapshot byte for byte', (id) => {
    const sc = SCENARIOS[id as keyof typeof SCENARIOS];
    const a = logSnapshot(runScenario(sc).sim);
    const b = logSnapshot(runScenario(sc).sim);
    expect(a).toBe(b);
    expect(a).toMatchSnapshot();
  });

  it('gives identical logs for the same seed and timeline across 1,000 seeds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const a = runScenario(SCENARIOS['kill-worker'], { seed });
        const b = runScenario(SCENARIOS['kill-worker'], { seed });
        expect(logSnapshot(a.sim)).toBe(logSnapshot(b.sim));
      }),
      { numRuns: SEEDS },
    );
  });
});

// ---------------------------------------------------------------- invariants (fast-check)

const workerArb = fc.constantFrom<WorkerId>(...WORKER_IDS);
const phaseArb = fc.option(fc.constantFrom<Phase>(...PHASES), { nil: undefined });

const killsArb = fc.array(
  fc.record({ at: fc.integer({ min: 0, max: 8000 }), worker: workerArb, atPhase: phaseArb }),
  { maxLength: 4 },
);

const submitsArb = fc.array(
  fc.record({
    at: fc.integer({ min: 0, max: 4000 }),
    n: fc.integer({ min: 1, max: 6 }),
    key: fc.option(fc.constantFrom('order-1', 'order-2'), { nil: undefined }),
  }),
  { minLength: 1, maxLength: 3 },
);

const cfgArb = fc.record({
  workers: fc.constantFrom<1 | 2 | 3>(1, 2, 3),
  acksLate: fc.boolean(),
  idempotency: fc.boolean(),
  apiIdempotency: fc.boolean(),
  flakiness: fc.double({ min: 0, max: 1, noNaN: true }),
  maxAttempts: fc.integer({ min: 1, max: 6 }),
});

type Kill = { at: number; worker: WorkerId; atPhase?: Phase };
type Submit = { at: number; n: number; key?: string };

function timeline(submits: Submit[], kills: Kill[]): ScriptStep[] {
  const steps: ScriptStep[] = [
    ...submits.map(({ at, n, key }) => ({ at, action: { type: 'submit' as const, n, key } })),
    ...kills.map(({ at, worker, atPhase }) => ({
      at,
      action: { type: 'kill' as const, worker, atPhase },
    })),
  ];
  return steps.sort((a, b) => a.at - b.at);
}

describe('invariants over 1,000 seeds', () => {
  it('every job ends in succeeded, dead_letter or lost', () => {
    fc.assert(
      fc.property(fc.nat(), cfgArb, submitsArb, killsArb, (seed, cfg, submits, kills) => {
        const s = runScript(seed, { ...cfg, autoRestart: true }, timeline(submits, kills));
        for (const job of Object.values(s.jobs)) {
          expect(['succeeded', 'dead_letter', 'lost']).toContain(job.state);
        }
        const m = s.metrics;
        expect(m.succeeded + m.deadLettered + m.lost).toBe(m.submitted);
      }),
      { numRuns: SEEDS },
    );
  });

  it('acks_late + idempotency: nothing is lost or doubled, even under kills', () => {
    fc.assert(
      fc.property(fc.nat(), cfgArb, submitsArb, killsArb, (seed, cfg, submits, kills) => {
        const safe = { ...cfg, acksLate: true, idempotency: true, autoRestart: true };
        const s = runScript(seed, safe, timeline(submits, kills));
        expect(s.metrics.lost).toBe(0);
        expect(s.metrics.duplicateSideEffects).toBe(0);
        for (const job of Object.values(s.jobs)) expect(job.sideEffects).toBeLessThanOrEqual(1);
      }),
      { numRuns: SEEDS },
    );
  });

  it('acks_late off and a kill mid-task: at least one job is lost', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<Phase>('fetch', 'compute', 'side_effect', 'write', 'ack'),
        (seed, n, atPhase) => {
          const s = runScript(seed, { acksLate: false, flakiness: 0 }, [
            { at: 0, action: { type: 'submit', n } },
            { at: 0, action: { type: 'kill', worker: 'w1', atPhase } },
          ]);
          expect(s.metrics.lost).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: SEEDS },
    );
  });

  it('idempotency off and a redelivery after the side effect: a duplicate side effect', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.integer({ min: 2, max: 8 }),
        fc.constantFrom<Phase>('write', 'ack'),
        (seed, n, atPhase) => {
          const s = runScript(seed, { idempotency: false, flakiness: 0 }, [
            { at: 0, action: { type: 'submit', n } },
            { at: 0, action: { type: 'kill', worker: 'w2', atPhase } },
          ]);
          expect(s.metrics.duplicateSideEffects).toBeGreaterThanOrEqual(1);
          expect(s.metrics.lost).toBe(0);
        },
      ),
      { numRuns: SEEDS },
    );
  });
});
