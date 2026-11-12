/**
 * The four guided scenarios and a pure runner that interleaves their scripts with ticks.
 * The demo store keeps a ScenarioRun and calls `advanceScenario` from its rAF loop.
 */
import { createInitialState, isSettled, reduce } from './engine';
import type { Config, Ms, NarrKey, Scenario, ScenarioId, ScriptStep, SimState } from './types';

const IDEMPOTENCY_KEY = 'order-7781';
const SECOND_SUBMIT_AT_MS = 250;
/** Upper bound for `runScenario`, in simulated time. */
export const DEFAULT_MAX_MS = 120_000;
const RUN_STEP_MS = 100;
/** Orders arrive this far apart, so the log clock moves from the first line. */
export const ARRIVAL_GAP_MS = 35;

/** `n` single orders, ARRIVAL_GAP_MS apart from t=0; the first one carries the narration. */
function arrivals(n: number): ScriptStep[] {
  return Array.from({ length: n }, (_, i) => ({
    at: i * ARRIVAL_GAP_MS,
    action: { type: 'submit', n: 1 },
    ...(i === 0 ? { narr: 'sim.jobs_submitted' as const } : {}),
  }));
}

function settledAfter(n: number): (s: SimState) => boolean {
  return (s) => s.metrics.submitted >= n && isSettled(s);
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  happy: {
    id: 'happy',
    seed: 1,
    cfg: { flakiness: 0 },
    intro: 'sim.intro.happy',
    script: arrivals(10),
    done: settledAfter(10),
    lesson: 'sim.lesson.happy',
  },
  'kill-worker': {
    id: 'kill-worker',
    seed: 2,
    cfg: { flakiness: 0 },
    intro: 'sim.intro.kill_worker',
    script: [
      ...arrivals(6),
      // After the side effect, before the ack: the classic double-charge window.
      {
        at: 0,
        action: { type: 'kill', worker: 'w2', atPhase: 'write' },
        narr: 'sim.prompt.kill_w2',
      },
    ],
    done: (s) => settledAfter(6)(s) && s.workers.w2.state !== 'dead',
    lesson: 'sim.lesson.kill_worker',
  },
  'flaky-downstream': {
    id: 'flaky-downstream',
    seed: 3,
    cfg: { flakiness: 0.5, maxAttempts: 5 },
    intro: 'sim.intro.flaky_downstream',
    script: arrivals(8),
    done: settledAfter(8),
    lesson: 'sim.lesson.flaky_downstream',
  },
  'double-submit': {
    id: 'double-submit',
    seed: 4,
    cfg: { flakiness: 0 },
    intro: 'sim.intro.double_submit',
    script: [
      { at: 0, action: { type: 'submit', n: 1, key: IDEMPOTENCY_KEY } },
      { at: SECOND_SUBMIT_AT_MS, action: { type: 'submit', n: 1, key: IDEMPOTENCY_KEY } },
    ],
    done: (s) => s.now >= SECOND_SUBMIT_AT_MS && isSettled(s),
    lesson: 'sim.lesson.double_submit',
  },
};

export interface ScenarioRun {
  sim: SimState;
  /** Index of the next script step to apply. */
  cursor: number;
  /** Narration of the most recently applied script step. */
  narr?: NarrKey;
}

function applyDueSteps(scenario: Scenario, run: ScenarioRun): ScenarioRun {
  let next = run;
  for (
    let step = scenario.script[next.cursor];
    step && step.at <= next.sim.now;
    step = scenario.script[next.cursor]
  ) {
    next = {
      sim: reduce(next.sim, step.action),
      cursor: next.cursor + 1,
      narr: step.narr ?? next.narr,
    };
  }
  return next;
}

/** A fresh run: the scenario's config (plus `patch`), its seed (or `seed`), and its t=0 steps. */
export function startScenario(
  scenario: Scenario,
  seed: number = scenario.seed,
  patch: Partial<Config> = {},
): ScenarioRun {
  const sim = createInitialState(seed, { ...scenario.cfg, ...patch });
  return applyDueSteps(scenario, { sim, cursor: 0 });
}

/** Advances simulated time by `dt`, applying script steps at their exact times. */
export function advanceScenario(scenario: Scenario, run: ScenarioRun, dt: Ms): ScenarioRun {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be a finite number >= 0');
  const target = run.sim.now + dt;
  let next = run;
  for (
    let step = scenario.script[next.cursor];
    step && step.at <= target;
    step = scenario.script[next.cursor]
  ) {
    const atStep = { ...next, sim: reduce(next.sim, { type: 'tick', dt: step.at - next.sim.now }) };
    next = applyDueSteps(scenario, atStep);
  }
  return { ...next, sim: reduce(next.sim, { type: 'tick', dt: target - next.sim.now }) };
}

export function isScenarioDone(scenario: Scenario, run: ScenarioRun): boolean {
  return run.cursor >= scenario.script.length && scenario.done(run.sim);
}

/** Runs a scenario headless until it is done or `maxMs` of simulated time passes. */
export function runScenario(
  scenario: Scenario,
  opts: { seed?: number; patch?: Partial<Config>; maxMs?: Ms } = {},
): ScenarioRun {
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  let run = startScenario(scenario, opts.seed ?? scenario.seed, opts.patch ?? {});
  while (!isScenarioDone(scenario, run) && run.sim.now < maxMs) {
    run = advanceScenario(scenario, run, Math.min(RUN_STEP_MS, maxMs - run.sim.now));
  }
  return run;
}
