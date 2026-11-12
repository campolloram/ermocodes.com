// Queue demo controller. Takes over the build-time still frame in #queue with a ready state
// (counters at 0, idle lanes, a ready line, empty log); one control, "kill a worker", plays the sim
// engine's kill-worker scenario live (3 workers, 6 orders, w2 dies after it charges), draws it on
// the lanes canvas (<= 30 fps) and announces the outcome in an aria-live line. Reduced motion skips
// the animation: the press renders the settled run at once. The sim time only advances while the
// section is on screen and the tab is visible. The log shows the same window the page was built
// with (trimLog), inside a fixed-height cell, so nothing moves while it fills.
import {
  SCENARIOS,
  advanceScenario,
  isScenarioDone,
  runScenario,
  startScenario,
  type ScenarioRun,
} from '../sim/orchestrator/scenarios.ts';
import type { LogLine, WorkerId } from '../sim/orchestrator/types.ts';
import { FRAME_MS } from './queue-lanes-model.ts';
import { createLanes } from './queue-lanes.ts';
import {
  LOG_ROWS,
  SIM_SPEED,
  fillOutcome,
  seconds,
  shownMetrics,
  trimLog,
} from './queue-demo-model.ts';

const IDS: readonly WorkerId[] = ['w1', 'w2', 'w3'];

export function initQueueDemo(): void {
  const root = document.querySelector<HTMLElement>('[data-demo]');
  const btn = root?.querySelector<HTMLButtonElement>('[data-kill]');
  const logEl = root?.querySelector<HTMLOListElement>('[data-log]');
  const outEl = root?.querySelector<HTMLElement>('[data-outcome]');
  const canvas = root?.querySelector<HTMLCanvasElement>('[data-lanes]');
  const copy = document.querySelector<HTMLTemplateElement>('template[data-demo-copy]');
  if (!root || !btn || !logEl || !outEl || !canvas || !copy || root.dataset.ready) return;
  root.dataset.ready = '1';
  const log = logEl;
  const out = outEl;
  const text = (k: string) =>
    copy.content.querySelector(`[data-k="${k}"]`)?.textContent?.trim() ?? '';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scenario = SCENARIOS['kill-worker'];
  const lanes = reduce ? null : createLanes(canvas);
  const metricEls = new Map(
    [...root.querySelectorAll<HTMLElement>('[data-m]')].map((e) => [e.dataset.m as string, e]),
  );

  let visible = false;
  let state: 'ready' | 'running' | 'settled' = 'ready';
  const setState = (s: typeof state) => {
    state = s;
    root.dataset.state = s;
    btn.setAttribute('aria-disabled', String(s === 'running'));
  };

  function liFor(l: LogLine): HTMLLIElement {
    const li = document.createElement('li');
    li.className = `lv-${l.level}`;
    const t = document.createElement('time');
    t.textContent = seconds(l.t);
    const lvl = document.createElement('span');
    lvl.className = 'lvl';
    lvl.textContent = l.level;
    const msg = document.createElement('span');
    msg.textContent = `${l.src} ${l.msg}`;
    li.append(t, lvl, msg);
    return li;
  }
  function showMetrics(m: Record<string, number>): void {
    for (const [k, el] of metricEls) el.textContent = String(m[k] ?? 0);
  }
  let shown: string | null = null;
  /** Shows the log window for this point of the run, newest line in view. */
  function showLog(all: readonly LogLine[]): void {
    const lines = trimLog(all, LOG_ROWS);
    const key = lines.map((l) => l.seq).join(',');
    if (key === shown) return;
    shown = key;
    log.replaceChildren(...lines.map(liFor));
    log.scrollTop = log.scrollHeight;
  }
  function settle(run: ScenarioRun): void {
    const m = run.sim.metrics;
    out.textContent = fillOutcome(text('outcome'), m, 'w2');
    setState('settled');
    lanes?.run(false);
  }

  /** A new seed per press: job keys and timings differ each run, the story does not. */
  const freshSeed = (): number => 1 + Math.floor(Math.random() * 0xfffffffe);

  function playInstant(): void {
    const run = runScenario(scenario, { seed: freshSeed() });
    showLog(run.sim.log);
    showMetrics(shownMetrics(run.sim.metrics));
    settle(run);
  }

  function play(): void {
    out.textContent = text('running');
    showLog([]);
    let run = startScenario(scenario, freshSeed());
    let seen = 0;
    let last = 0;
    let lastDraw = 0;
    lanes?.clear();
    lanes?.run(true);
    setState('running');
    const frame = (now: number) => {
      if (state !== 'running') return;
      requestAnimationFrame(frame);
      if (document.hidden || !visible) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(100, now - last) : 0;
      last = now;
      // The sim advances every frame; the DOM repaints at the lane rate (30 fps at most).
      run = advanceScenario(scenario, run, dt * SIM_SPEED);
      if (now - lastDraw < FRAME_MS && !isScenarioDone(scenario, run)) return;
      lastDraw = now;
      for (const l of run.sim.log) {
        if (l.seq < seen) continue;
        seen = l.seq + 1;
        if (l.narr === 'sim.worker_killed') lanes?.killed(l.src as WorkerId);
        if (l.narr === 'sim.redelivered') lanes?.redelivered('w2');
      }
      showLog(run.sim.log);
      showMetrics(shownMetrics(run.sim.metrics));
      lanes?.setWorkers(
        Object.fromEntries(IDS.map((id) => [id, run.sim.workers[id].state])) as Record<
          WorkerId,
          (typeof run.sim.workers)[WorkerId]['state']
        >,
      );
      if (isScenarioDone(scenario, run)) settle(run);
    };
    requestAnimationFrame(frame);
  }

  // The ready state: the still frame was a finished run; this one has not started yet.
  showLog([]);
  showMetrics({});
  lanes?.clear();
  setState('ready');
  btn.hidden = false;
  btn.addEventListener('click', () => {
    if (state === 'running') return;
    if (reduce) playInstant();
    else play();
  });
  const syncLanes = () => {
    if (state === 'running') lanes?.run(visible && !document.hidden);
  };
  new IntersectionObserver(([e]) => {
    visible = e?.isIntersecting ?? false;
    syncLanes();
  }).observe(root);
  document.addEventListener('visibilitychange', syncLanes);
}
