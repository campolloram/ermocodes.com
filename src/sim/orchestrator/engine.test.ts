import { describe, expect, it } from 'vitest';
import {
  BOOT_MS,
  DEFAULT_CONFIG,
  FIRST_JOB_NUMBER,
  LOG_LIMIT,
  MAX_JOBS,
  SUBMIT_N,
  canSubmit,
  RESTART_DELAY_MS,
  createInitialState,
  isSettled,
  isTerminal,
  reduce,
  validateConfig,
} from './engine';
import type { Action, Config, SimState } from './types';

const SETTLE_MS = 600_000;

function run(s: SimState, ...actions: Action[]): SimState {
  return actions.reduce(reduce, s);
}

function settle(s: SimState): SimState {
  return reduce(s, { type: 'tick', dt: SETTLE_MS });
}

function start(patch: Partial<Config> = {}, seed = 1): SimState {
  return createInitialState(seed, { flakiness: 0, ...patch });
}

function msgs(s: SimState): string[] {
  return s.log.map((l) => `${l.src} ${l.msg}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('createInitialState and config', () => {
  it('starts idle with the default config', () => {
    const s = createInitialState(5);
    expect(s.cfg).toEqual(DEFAULT_CONFIG);
    expect(s.now).toBe(0);
    expect(Object.values(s.workers).map((w) => w.state)).toEqual(['idle', 'idle', 'idle']);
    expect(isSettled(s)).toBe(true);
  });

  it.each<[string, Partial<Config>]>([
    ['workers', { workers: 4 as 3 }],
    ['acksLate', { acksLate: 'yes' as unknown as boolean }],
    ['visibilityTimeout', { visibilityTimeout: 10 }],
    ['maxAttempts', { maxAttempts: 1.5 }],
    ['flakiness', { flakiness: 1.2 }],
    ['taskMs', { taskMs: [900, 100] }],
    ['backoff.factor', { backoff: { ...DEFAULT_CONFIG.backoff, factor: 0.5 } }],
    ['backoff.jitter', { backoff: { ...DEFAULT_CONFIG.backoff, jitter: 'half' as 'full' } }],
  ])('rejects an invalid %s', (field, patch) => {
    expect(() => createInitialState(1, patch)).toThrow(new RegExp(field.replace('.', '\\.')));
  });

  it('rejects a malformed taskMs and backoff', () => {
    const bad = { ...DEFAULT_CONFIG, taskMs: undefined, backoff: undefined } as unknown as Config;
    expect(() => validateConfig(bad)).toThrow(/taskMs.*backoff\.baseMs/);
  });

  it('merges a partial backoff patch through setConfig', () => {
    const s = run(start(), {
      type: 'setConfig',
      patch: { backoff: { baseMs: 100 } as Config['backoff'] },
    });
    expect(s.cfg.backoff).toEqual({ ...DEFAULT_CONFIG.backoff, baseMs: 100 });
    expect(() => reduce(s, { type: 'setConfig', patch: { flakiness: -1 } })).toThrow(RangeError);
  });

  it('dispatches only to the configured number of workers', () => {
    const s = run(start({ workers: 1 }), { type: 'submit', n: 3 });
    expect(s.workers.w1.state).toBe('busy');
    expect(s.workers.w2.state).toBe('idle');
    const more = run(s, { type: 'setConfig', patch: { workers: 3 } });
    expect(more.workers.w2.state).toBe('busy');
    expect(more.workers.w3.state).toBe('busy');
  });
});

describe('submit and the happy path', () => {
  it('creates jobs, logs them and runs every one to success', () => {
    // Arrange
    const s0 = start();

    // Act
    const s1 = run(s0, { type: 'submit', n: 5 });
    const done = settle(s1);

    // Assert
    expect(Object.keys(s1.jobs)).toHaveLength(5);
    expect(s1.jobs[String(FIRST_JOB_NUMBER)].state).toBe('running');
    expect(s1.log[0].narr).toBe('sim.jobs_submitted');
    expect(Object.values(done.jobs).every((j) => j.state === 'succeeded')).toBe(true);
    expect(done.metrics).toMatchObject({ submitted: 5, succeeded: 5, lost: 0, retries: 0 });
    expect(done.metrics.p50Ms).toBeGreaterThan(0);
    expect(done.queue).toEqual([]);
    expect(done.appliedKeys).toHaveLength(5);
    expect(Object.values(done.workers).every((w) => w.state === 'idle')).toBe(true);
  });

  it.each([0, 101, 1.5])('rejects submit n=%s', (n) => {
    expect(() => reduce(start(), { type: 'submit', n })).toThrow(RangeError);
  });

  it('rejects malformed idempotency keys', () => {
    expect(() => reduce(start(), { type: 'submit', n: 1, key: '' })).toThrow(/key/);
    expect(() => reduce(start(), { type: 'submit', n: 1, key: 'a b' })).toThrow(/key/);
  });

  it('caps the log at LOG_LIMIT lines', () => {
    const s = settle(run(start(), { type: 'submit', n: 100 }));
    expect(s.log.length).toBe(LOG_LIMIT);
    expect(s.metrics.succeeded).toBe(100);
  });

  it('rejects an invalid tick and treats dt=0 as a no-op in time', () => {
    const s = start();
    expect(() => reduce(s, { type: 'tick', dt: -1 })).toThrow(RangeError);
    expect(() => reduce(s, { type: 'tick', dt: Number.NaN })).toThrow(RangeError);
    expect(reduce(s, { type: 'tick', dt: 0 }).now).toBe(0);
  });
});

describe('API idempotency', () => {
  const twice: Action[] = [
    { type: 'submit', n: 1, key: 'order-1' },
    { type: 'submit', n: 1, key: 'order-1' },
  ];

  it('returns the existing job when Idempotency-Key repeats', () => {
    const s = settle(run(start(), ...twice));
    expect(Object.keys(s.jobs)).toHaveLength(1);
    expect(s.log.some((l) => l.narr === 'sim.api_existing_job')).toBe(true);
    expect(s.metrics.duplicateSideEffects).toBe(0);
  });

  it('creates a duplicate job without it, which worker idempotency still absorbs', () => {
    const s = settle(run(start({ apiIdempotency: false }), ...twice));
    expect(Object.keys(s.jobs)).toHaveLength(2);
    expect(s.log.some((l) => l.narr === 'sim.api_duplicate_job')).toBe(true);
    expect(s.log.some((l) => l.narr === 'sim.idempotent_skip')).toBe(true);
    expect(s.metrics.duplicateSideEffects).toBe(0);
  });

  it('double-charges when both layers are off', () => {
    const s = settle(run(start({ apiIdempotency: false, idempotency: false }), ...twice));
    expect(s.metrics.duplicateSideEffects).toBe(1);
    expect(s.log.some((l) => l.narr === 'sim.duplicate_side_effect')).toBe(true);
  });
});

describe('retries and dead letters', () => {
  it('retries with exponential back-off and dead-letters after maxAttempts', () => {
    const noJitter = { ...DEFAULT_CONFIG.backoff, jitter: 'none' as const };
    const s = settle(
      run(start({ flakiness: 1, maxAttempts: 3, backoff: noJitter, workers: 1 }), {
        type: 'submit',
        n: 1,
      }),
    );
    const job = s.jobs[String(FIRST_JOB_NUMBER)];
    expect(job.state).toBe('dead_letter');
    expect(job).toMatchObject({ attempt: 3, retries: 2 });
    expect(s.metrics).toMatchObject({ retries: 2, deadLettered: 1, succeeded: 0 });
    const retries = msgs(s).filter((m) => m.includes('retry in'));
    expect(retries).toEqual([
      'w1 Task jobs.process[1041] retry in 400ms (try 2/3)',
      'w1 Task jobs.process[1041] retry in 800ms (try 3/3)',
    ]);
    expect(msgs(s).at(-1)).toMatch(/failed after 3 tries, moved to dead_letter/);
  });

  it('does not count redeliveries against maxAttempts or the back-off index', () => {
    // Arrange: two kills force two redeliveries before the downstream starts failing
    const noJitter = { ...DEFAULT_CONFIG.backoff, jitter: 'none' as const };
    const redelivered = run(
      start({ maxAttempts: 2, workers: 1, backoff: noJitter }),
      { type: 'submit', n: 1 },
      { type: 'kill', worker: 'w1' },
      { type: 'tick', dt: 3500 },
      { type: 'kill', worker: 'w1' },
      { type: 'tick', dt: 3000 }, // redelivered at 6000 (3000 after the reservation), now running
    );
    expect(redelivered.jobs['1041']).toMatchObject({ state: 'running', attempt: 3, retries: 0 });

    // Act
    const s = settle(reduce(redelivered, { type: 'setConfig', patch: { flakiness: 1 } }));

    // Assert: one retry (first back-off step), then dead_letter
    expect(s.jobs['1041']).toMatchObject({ state: 'dead_letter', attempt: 4, retries: 1 });
    expect(s.metrics).toMatchObject({ retries: 1, deadLettered: 1 });
    expect(msgs(s)).toContain('w1 Task jobs.process[1041] retry in 400ms (try 2/2)');
    for (const [, n, max] of msgs(s)
      .join('\n')
      .matchAll(/(\d+)\/(\d+)\)/g)) {
      expect(Number(n)).toBeLessThanOrEqual(Number(max));
    }
  });

  it('marks a retrying job retry_wait with its next attempt time', () => {
    const s0 = run(start({ flakiness: 1, workers: 1 }), { type: 'submit', n: 1 });
    let s = s0;
    while (s.jobs['1041'].state !== 'retry_wait') s = reduce(s, { type: 'tick', dt: 10 });
    expect(s.jobs['1041'].nextAttemptAt).toBeGreaterThanOrEqual(s.now);
    expect(s.workers.w1.state).toBe('idle');
  });
});

describe('worker kills', () => {
  it('redelivers after the visibility timeout and skips the applied side effect', () => {
    // Arrange: kill w2 after its side effect, before the ack
    const s0 = run(
      start(),
      { type: 'submit', n: 3 },
      { type: 'kill', worker: 'w2', atPhase: 'write' },
    );

    // Act
    const s = settle(s0);

    // Assert
    const lines = msgs(s);
    expect(lines).toContain('w2 celery@w2 lost (host down)');
    expect(lines).toContain('redis redelivering job 1042 (attempt 2)');
    expect(lines.some((m) => m.endsWith('(replayed, no new charge)'))).toBe(true);
    expect(s.jobs['1042']).toMatchObject({ state: 'succeeded', sideEffects: 1, attempt: 2 });
    expect(s.metrics).toMatchObject({ lost: 0, duplicateSideEffects: 0, succeeded: 3 });
  });

  it('holds a killed job in reserved until the visibility timeout', () => {
    const s = run(
      start({ autoRestart: false }),
      { type: 'submit', n: 2 },
      { type: 'kill', worker: 'w2' },
    );
    expect(s.jobs['1042'].state).toBe('reserved');
    expect(s.workers.w2.state).toBe('dead');
    const before = reduce(s, { type: 'tick', dt: DEFAULT_CONFIG.visibilityTimeout - 1 });
    expect(before.jobs['1042'].attempt).toBe(1);
    const after = reduce(s, { type: 'tick', dt: DEFAULT_CONFIG.visibilityTimeout });
    expect(after.jobs['1042'].attempt).toBe(2);
  });

  it('loses the job when acks_late is off', () => {
    const s = settle(
      run(
        start({ acksLate: false }),
        { type: 'submit', n: 3 },
        { type: 'kill', worker: 'w1', atPhase: 'compute' },
      ),
    );
    expect(s.jobs['1041'].state).toBe('lost');
    expect(s.metrics.lost).toBe(1);
    expect(s.log.some((l) => l.narr === 'sim.job_lost')).toBe(true);
    expect(s.queue).toEqual([]);
  });

  it('runs the side effect twice when idempotency is off', () => {
    const s = settle(
      run(
        start({ idempotency: false }),
        { type: 'submit', n: 2 },
        { type: 'kill', worker: 'w2', atPhase: 'write' },
      ),
    );
    expect(s.jobs['1042'].sideEffects).toBe(2);
    expect(s.metrics.duplicateSideEffects).toBe(1);
  });

  it('kills immediately when the worker is already in the armed phase', () => {
    let s = run(start(), { type: 'submit', n: 1 });
    while (s.jobs['1041'].phase !== 'compute') s = reduce(s, { type: 'tick', dt: 5 });
    const killed = reduce(s, { type: 'kill', worker: 'w1', atPhase: 'compute' });
    expect(killed.workers.w1.state).toBe('dead');
  });

  it('arms a kill on an idle worker for its next job', () => {
    const armed = run(start({ workers: 1 }), { type: 'kill', worker: 'w1', atPhase: 'fetch' });
    expect(armed.workers.w1).toMatchObject({ state: 'idle', killAtPhase: 'fetch' });
    const s = reduce(armed, { type: 'submit', n: 1 });
    expect(s.workers.w1.state).toBe('dead');
    expect(s.jobs['1041'].state).toBe('reserved');
  });

  it('ignores kills of dead workers and rejects unknown workers and phases', () => {
    const dead = run(start({ autoRestart: false }), { type: 'kill', worker: 'w3' });
    expect(reduce(dead, { type: 'kill', worker: 'w3' })).toBe(dead);
    expect(reduce(dead, { type: 'kill', worker: 'w3', atPhase: 'ack' })).toBe(dead);
    expect(() => reduce(dead, { type: 'kill', worker: 'w9' as 'w1' })).toThrow(/unknown worker/);
    expect(() => reduce(dead, { type: 'kill', worker: 'w1', atPhase: 'nap' as 'ack' })).toThrow(
      /unknown phase/,
    );
    expect(() => reduce(dead, { type: 'restart', worker: 'w0' as 'w1' })).toThrow(/unknown worker/);
  });
});

describe('restarts', () => {
  it('auto-restarts a killed worker after the delay plus boot time', () => {
    const s = run(start(), { type: 'kill', worker: 'w1' });
    expect(s.workers.w1).toMatchObject({ state: 'dead', restartAt: RESTART_DELAY_MS });
    const booting = reduce(s, { type: 'tick', dt: RESTART_DELAY_MS });
    expect(booting.workers.w1.state).toBe('booting');
    const ready = reduce(booting, { type: 'tick', dt: BOOT_MS });
    expect(ready.workers.w1.state).toBe('idle');
    expect(ready.log.at(-1)).toMatchObject({
      src: 'w1',
      msg: 'celery@w1 ready',
      narr: 'sim.worker_ready',
    });
  });

  it('restarts only dead workers on demand', () => {
    const s0 = start({ autoRestart: false });
    expect(reduce(s0, { type: 'restart', worker: 'w1' })).toBe(s0);
    const dead = settle(reduce(s0, { type: 'kill', worker: 'w1' }));
    expect(dead.workers.w1.state).toBe('dead');
    const booting = reduce(dead, { type: 'restart', worker: 'w1' });
    expect(booting.workers.w1.state).toBe('booting');
    expect(reduce(booting, { type: 'tick', dt: BOOT_MS }).workers.w1.state).toBe('idle');
  });

  it('ignores stale restart and boot timers after another kill or restart', () => {
    // A manual restart pre-empts the pending auto-restart; a kill while booting cancels the boot.
    const s = run(
      start(),
      { type: 'kill', worker: 'w1' },
      { type: 'restart', worker: 'w1' },
      { type: 'kill', worker: 'w1' },
    );
    const later = reduce(s, { type: 'tick', dt: BOOT_MS + 1 });
    expect(later.workers.w1.state).toBe('dead');
    const settled = settle(later);
    expect(settled.workers.w1.state).toBe('idle');
  });
});

describe('visibility and stuck-job detection edge cases', () => {
  it('rejects a visibility timeout that a task could outlive', () => {
    expect(() => start({ visibilityTimeout: 1200, taskMs: [600, 1200] })).toThrow(
      /visibilityTimeout must exceed taskMs\[1\]/,
    );
    expect(() => reduce(start(), { type: 'setConfig', patch: { taskMs: [600, 5000] } })).toThrow(
      RangeError,
    );
  });

  it.each([true, false])(
    'keeps an in-flight task inside its delivery deadline after setConfig (acksLate %s)',
    (acksLate) => {
      // A slower config applies to new deliveries only, so a running task never outlives its
      // visibility timeout or trips the stuck-job detector.
      const slow = run(
        start({ acksLate, workers: 1 }),
        { type: 'submit', n: 2 },
        { type: 'setConfig', patch: { visibilityTimeout: 200_000, taskMs: [100_000, 100_000] } },
      );
      const s = settle(slow);
      expect(msgs(s).some((m) => m.includes('redelivering'))).toBe(false);
      expect(s.metrics).toMatchObject({ succeeded: 2, lost: 0, duplicateSideEffects: 0 });
      expect(s.jobs['1041'].finishedAt).toBeLessThan(DEFAULT_CONFIG.taskMs[1] + 10);
    },
  );

  it('ignores a stale stuck check once a retry is running on a new delivery', () => {
    const s = settle(
      run(start({ acksLate: false, flakiness: 0.6, workers: 1 }, 3), { type: 'submit', n: 4 }),
    );
    expect(s.metrics.retries).toBeGreaterThan(0);
    expect(s.metrics.lost).toBe(0);
    expect(Object.values(s.jobs).every(isTerminal)).toBe(true);
  });
});

describe('purity', () => {
  it('never mutates a deep-frozen input state', () => {
    // Arrange: a timeline touching every action and most timer kinds
    const timeline: Action[] = [
      { type: 'submit', n: 4 },
      { type: 'kill', worker: 'w2', atPhase: 'write' },
      { type: 'tick', dt: 700 },
      { type: 'setConfig', patch: { flakiness: 0.5, acksLate: false } },
      { type: 'submit', n: 2, key: 'order-9' },
      { type: 'kill', worker: 'w1' },
      { type: 'restart', worker: 'w1' },
      { type: 'tick', dt: 5000 },
      { type: 'tick', dt: SETTLE_MS },
    ];

    // Act + Assert: frozen objects throw on write in strict-mode modules
    let s = deepFreeze(start({}, 11));
    for (const action of timeline) {
      const before = JSON.stringify(s);
      const next = reduce(s, action);
      expect(JSON.stringify(s)).toBe(before);
      s = deepFreeze(next);
    }
    expect(isSettled(s)).toBe(true);
  });

  it('is deterministic for the same seed and timeline', () => {
    const timeline: Action[] = [
      { type: 'submit', n: 6 },
      { type: 'kill', worker: 'w3', atPhase: 'side_effect' },
      { type: 'tick', dt: SETTLE_MS },
    ];
    const a = run(createInitialState(99), ...timeline);
    const b = run(createInitialState(99), ...timeline);
    const c = run(createInitialState(100), ...timeline);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(c.log));
  });
});

describe('round-1 review: accurate crash and idempotency story', () => {
  const crashed = (patch: Partial<Config> = {}) =>
    settle(
      run(start(patch), { type: 'submit', n: 3 }, { type: 'kill', worker: 'w2', atPhase: 'write' }),
    );

  it('logs a whole-host crash, not a pool child dying (WorkerLostError)', () => {
    const lines = msgs(crashed());
    expect(lines).toContain('w2 celery@w2 lost (host down)');
    expect(lines.some((m) => m.includes('WorkerLostError'))).toBe(false);
  });

  it('sends the idempotency key with the charge and the provider replays the repeat', () => {
    const s = crashed();
    const key = s.jobs['1042'].key;
    const lines = msgs(s);
    expect(lines).toContain(`downstream POST /v1/charges 200 job=1042 Idempotency-Key=${key}`);
    expect(lines).toContain(
      `downstream POST /v1/charges 200 job=1042 Idempotency-Key=${key} (replayed, no new charge)`,
    );
    expect(lines.some((m) => /unique|skipping side effect/.test(m))).toBe(false);
  });

  it('sends no key when idempotency is off', () => {
    const lines = msgs(crashed({ idempotency: false }));
    expect(lines).toContain('downstream POST /v1/charges 200 job=1042');
    expect(lines).toContain('downstream second charge for job=1042 (customer billed twice)');
    expect(lines.some((m) => m.includes('idempotency_key'))).toBe(false);
  });

  it('numbers log lines with a monotonic seq that survives the head trim', () => {
    const s = settle(run(start(), { type: 'submit', n: 100 }, { type: 'submit', n: 100 }));
    expect(s.log).toHaveLength(LOG_LIMIT);
    const seqs = s.log.map((l) => l.seq);
    expect(seqs.every((q, i) => i === 0 || q === seqs[i - 1] + 1)).toBe(true);
    expect(seqs[0]).toBeGreaterThan(0);
  });

  it('prunes the oldest finished jobs so free mode never grows without bound', () => {
    let s = start();
    for (let i = 0; i < 40; i += 1) s = settle(reduce(s, { type: 'submit', n: 10 }));
    expect(Object.keys(s.jobs).length).toBeLessThanOrEqual(MAX_JOBS);
    expect(s.metrics.submitted).toBe(400);
    expect(s.appliedKeys.length).toBeLessThanOrEqual(MAX_JOBS);
    // The newest job is kept.
    expect(s.jobs[String(FIRST_JOB_NUMBER + 399)]).toBeDefined();
  });

  it('never prunes a job that is still in flight, and blocks submit before the cap', () => {
    let s = start();
    for (let i = 0; i < 25; i += 1) s = reduce(s, { type: 'submit', n: SUBMIT_N });
    // Nothing settles, so submit stops once another batch would exceed MAX_JOBS unfinished jobs.
    const unfinished = Object.values(s.jobs).filter((j) => !isTerminal(j));
    expect(unfinished.length + SUBMIT_N).toBeGreaterThan(MAX_JOBS);
    expect(unfinished.length).toBeLessThanOrEqual(MAX_JOBS);
    expect(canSubmit(s)).toBe(false);
    expect(s.metrics.submitted).toBe(unfinished.length);
    expect(reduce(s, { type: 'submit', n: SUBMIT_N })).toBe(s);
  });

  it('checks room for the requested batch size, not just the default', () => {
    let s = reduce(start(), { type: 'submit', n: 100 });
    s = reduce(s, { type: 'submit', n: 50 });
    // 150 unfinished: room for 50 more, but not for 100.
    expect(canSubmit(s)).toBe(true);
    expect(canSubmit(s, 50)).toBe(true);
    expect(canSubmit(s, 100)).toBe(false);
    expect(reduce(s, { type: 'submit', n: 100 })).toBe(s);
  });

  it('allows submit again once jobs finish', () => {
    let s = start();
    for (let i = 0; i < 25; i += 1) s = reduce(s, { type: 'submit', n: SUBMIT_N });
    s = settle(s);
    expect(canSubmit(s)).toBe(true);
  });
});
