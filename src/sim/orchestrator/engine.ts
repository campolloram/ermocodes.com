/**
 * The orchestrator simulation: a pure, deterministic reducer over SimState.
 * `reduce` never mutates its input; every helper returns a new state.
 * Illustrative re-creation of Celery + Redis semantics, not client code.
 */
import { backoffDelay } from './backoff';
import { heapPeek, heapPop, heapPush } from './heap';
import { nextFloat, nextHex, seedState } from './rng';
import {
  PHASES,
  WORKER_IDS,
  type Action,
  type BrokerMsg,
  type Config,
  type Job,
  type JobState,
  type LogLevel,
  type LogLine,
  type LogSrc,
  type Metrics,
  type Ms,
  type NarrKey,
  type Phase,
  type SimState,
  type Timer,
  type TimerInput,
  type Worker,
  type WorkerId,
} from './types';

export const DEFAULT_CONFIG: Config = {
  workers: 3,
  acksLate: true,
  idempotency: true,
  apiIdempotency: true,
  visibilityTimeout: 3000,
  maxAttempts: 5,
  flakiness: 0.1,
  taskMs: [600, 1200],
  backoff: { baseMs: 400, factor: 2, maxMs: 8000, jitter: 'full' },
  autoRestart: true,
};

export const LOG_LIMIT = 500;
/** Finished jobs beyond this many are pruned, oldest first (free mode can submit forever). */
export const MAX_JOBS = 200;
export const MAX_SUBMIT = 100;
/** Jobs the sandbox's "send jobs" button submits at once. */
export const SUBMIT_N = Math.min(10, MAX_SUBMIT);
export const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = new RegExp(`^[\\w.:-]{1,${MAX_KEY_LENGTH}}$`);
export const FIRST_JOB_NUMBER = 1041;
export const RESTART_DELAY_MS = 1500;
export const BOOT_MS = 600;
/** The stuck-job detector fires this many times the longer of visibility timeout and max task time. */
export const STUCK_FACTOR = 2;

const MIN_VISIBILITY_MS = 100;
const MAX_DURATION_MS = 600_000;
const MAX_ATTEMPTS_LIMIT = 20;
const TRACE_HEX_CHARS = 16;
const KEY_HEX_CHARS = 8;
const TASK = 'jobs.process';
const DOWNSTREAM = 'POST /v1/charges';
/** Share of the task duration spent in each phase. */
const PHASE_SHARE: Record<Phase, number> = {
  fetch: 0.15,
  compute: 0.35,
  side_effect: 0.25,
  write: 0.15,
  ack: 0.1,
};
const TERMINAL: ReadonlySet<JobState> = new Set(['succeeded', 'dead_letter', 'lost']);

// ---------------------------------------------------------------- config

function isFiniteIn(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export function validateConfig(cfg: Config): Config {
  const [lo, hi] = Array.isArray(cfg.taskMs) ? cfg.taskMs : [NaN, NaN];
  const b = cfg.backoff;
  const checks: [boolean, string][] = [
    [[1, 2, 3].includes(cfg.workers), 'workers must be 1, 2 or 3'],
    [typeof cfg.acksLate === 'boolean', 'acksLate must be a boolean'],
    [typeof cfg.idempotency === 'boolean', 'idempotency must be a boolean'],
    [typeof cfg.apiIdempotency === 'boolean', 'apiIdempotency must be a boolean'],
    [typeof cfg.autoRestart === 'boolean', 'autoRestart must be a boolean'],
    [
      isFiniteIn(cfg.visibilityTimeout, MIN_VISIBILITY_MS, MAX_DURATION_MS),
      `visibilityTimeout must be ${MIN_VISIBILITY_MS}..${MAX_DURATION_MS} ms`,
    ],
    [
      Number.isInteger(cfg.maxAttempts) && isFiniteIn(cfg.maxAttempts, 1, MAX_ATTEMPTS_LIMIT),
      `maxAttempts must be an integer 1..${MAX_ATTEMPTS_LIMIT}`,
    ],
    [isFiniteIn(cfg.flakiness, 0, 1), 'flakiness must be 0..1'],
    // Real Redis redelivers an unacked message after the visibility timeout even while its
    // worker is alive, so every task must finish inside it.
    [Number.isNaN(hi) || cfg.visibilityTimeout > hi, 'visibilityTimeout must exceed taskMs[1]'],
    [
      isFiniteIn(lo, 1, MAX_DURATION_MS) && isFiniteIn(hi, lo, MAX_DURATION_MS),
      'taskMs must be [min, max] with 1 <= min <= max',
    ],
    [isFiniteIn(b?.baseMs, 0, MAX_DURATION_MS), 'backoff.baseMs must be 0..600000'],
    [isFiniteIn(b?.factor, 1, 100), 'backoff.factor must be 1..100'],
    [isFiniteIn(b?.maxMs, 0, MAX_DURATION_MS), 'backoff.maxMs must be 0..600000'],
    [b?.jitter === 'none' || b?.jitter === 'full', "backoff.jitter must be 'none' or 'full'"],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (failed.length > 0) throw new RangeError(`Invalid sim config: ${failed.join('; ')}`);
  return cfg;
}

export function mergeConfig(cfg: Config, patch: Partial<Config>): Config {
  return validateConfig({
    ...cfg,
    ...patch,
    taskMs: patch.taskMs ? [...patch.taskMs] : cfg.taskMs,
    backoff: patch.backoff ? { ...cfg.backoff, ...patch.backoff } : cfg.backoff,
  });
}

// ---------------------------------------------------------------- state

function initialWorker(id: WorkerId): Worker {
  return { id, state: 'idle' };
}

export function createInitialState(seed = 1, patch: Partial<Config> = {}): SimState {
  return {
    now: 0,
    seed,
    rngState: seedState(seed),
    cfg: mergeConfig(DEFAULT_CONFIG, patch),
    jobs: {},
    queue: [],
    workers: { w1: initialWorker('w1'), w2: initialWorker('w2'), w3: initialWorker('w3') },
    appliedKeys: [],
    timers: [],
    log: [],
    metrics: {
      submitted: 0,
      succeeded: 0,
      retries: 0,
      redelivered: 0,
      deadLettered: 0,
      lost: 0,
      duplicateSideEffects: 0,
      p50Ms: 0,
    },
    counters: { job: 0, deliveryTag: 1, timer: 0, log: 0 },
  };
}

export function isTerminal(job: Job): boolean {
  return TERMINAL.has(job.state);
}

/** True when every submitted job has reached succeeded, dead_letter or lost. */
export function isSettled(s: SimState): boolean {
  return Object.values(s.jobs).every(isTerminal);
}

// ---------------------------------------------------------------- pure helpers

function draw(s: SimState): [number, SimState] {
  const [u, rngState] = nextFloat(s.rngState);
  return [u, { ...s, rngState }];
}

function drawHex(s: SimState, chars: number): [string, SimState] {
  const [hex, rngState] = nextHex(s.rngState, chars);
  return [hex, { ...s, rngState }];
}

type LineInput = Omit<LogLine, 't' | 'seq'>;

function line(level: LogLevel, src: LogSrc, msg: string, job?: Job, narr?: NarrKey): LineInput {
  return {
    level,
    src,
    msg,
    ...(job ? { jobId: job.id, traceId: job.traceId } : {}),
    ...(narr ? { narr } : {}),
  };
}

function appendLog(s: SimState, ...lines: LineInput[]): SimState {
  const first = s.counters.log;
  const log = [...s.log, ...lines.map((l, i) => ({ t: s.now, seq: first + i, ...l }))];
  return {
    ...s,
    log: log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log,
    counters: { ...s.counters, log: first + lines.length },
  };
}

function patchJob(s: SimState, id: string, patch: Partial<Job>): SimState {
  return { ...s, jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...patch } } };
}

function patchWorker(s: SimState, id: WorkerId, patch: Partial<Worker>): SimState {
  return { ...s, workers: { ...s.workers, [id]: { ...s.workers[id], ...patch } } };
}

function patchMetrics(s: SimState, patch: Partial<Metrics>): SimState {
  return { ...s, metrics: { ...s.metrics, ...patch } };
}

function schedule(s: SimState, input: TimerInput): SimState {
  const timer: Timer = { ...input, seq: s.counters.timer };
  return {
    ...s,
    timers: heapPush(s.timers, timer),
    counters: { ...s.counters, timer: s.counters.timer + 1 },
  };
}

function findMsg(s: SimState, tag: number | undefined): BrokerMsg | undefined {
  return tag === undefined ? undefined : s.queue.find((m) => m.deliveryTag === tag);
}

function removeMsg(s: SimState, tag: number | undefined): SimState {
  return { ...s, queue: s.queue.filter((m) => m.deliveryTag !== tag) };
}

function enqueue(s: SimState, jobId: string, visibleAt: Ms): SimState {
  const msg: BrokerMsg = { jobId, deliveryTag: s.counters.deliveryTag, visibleAt };
  const next: SimState = {
    ...s,
    queue: [...s.queue, msg],
    counters: { ...s.counters, deliveryTag: s.counters.deliveryTag + 1 },
  };
  return visibleAt > s.now ? schedule(next, { kind: 'wake', at: visibleAt }) : next;
}

function releaseWorker(s: SimState, id: WorkerId): SimState {
  return patchWorker(s, id, {
    state: 'idle',
    jobId: undefined,
    deliveryTag: undefined,
    phaseEndsAt: undefined,
    taskMs: undefined,
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

function stuckAfter(cfg: Config): Ms {
  return STUCK_FACTOR * Math.max(cfg.visibilityTimeout, cfg.taskMs[1]);
}

function taskLabel(job: Job): string {
  return `${TASK}[${job.id}]`;
}

// ---------------------------------------------------------------- API

function findJobByKey(s: SimState, key: string): Job | undefined {
  return Object.values(s.jobs).find((j) => j.key === key);
}

/** Unfinished jobs are never pruned, so submit stops while there is no room for another batch. */
export function canSubmit(s: SimState, n: number = SUBMIT_N): boolean {
  return Object.values(s.jobs).filter((j) => !isTerminal(j)).length + n <= MAX_JOBS;
}

/** Drops the oldest finished jobs (and their applied keys) to make room for one more. */
function pruneJobs(s: SimState): SimState {
  const excess = Object.keys(s.jobs).length + 1 - MAX_JOBS;
  if (excess <= 0) return s;
  // Job ids are increasing integers, so the record already iterates oldest first.
  const drop = new Set(
    Object.values(s.jobs)
      .filter(isTerminal)
      .slice(0, excess)
      .map((j) => j.id),
  );
  if (drop.size === 0) return s;
  const jobs = Object.fromEntries(Object.entries(s.jobs).filter(([id]) => !drop.has(id)));
  const kept = new Set(Object.values(jobs).map((j) => j.key));
  return { ...s, jobs, appliedKeys: s.appliedKeys.filter((k) => kept.has(k)) };
}

function createJob(prev: SimState, key: string | undefined, narr?: NarrKey): SimState {
  const s = pruneJobs(prev);
  const id = String(FIRST_JOB_NUMBER + s.counters.job);
  const [traceId, s1] = drawHex(s, TRACE_HEX_CHARS);
  const [keyHex, s2] = key === undefined ? drawHex(s1, KEY_HEX_CHARS) : ['', s1];
  const job: Job = {
    id,
    key: key ?? `idem-${keyHex}`,
    state: 'queued',
    attempt: 0,
    retries: 0,
    maxAttempts: s.cfg.maxAttempts,
    enqueuedAt: s.now,
    sideEffects: 0,
    traceId,
  };
  const s3: SimState = {
    ...s2,
    jobs: { ...s2.jobs, [id]: job },
    counters: { ...s2.counters, job: s2.counters.job + 1 },
    metrics: { ...s2.metrics, submitted: s2.metrics.submitted + 1 },
  };
  return appendLog(
    enqueue(s3, id, s.now),
    line('INFO', 'api', `POST /jobs 202 job=${id} Idempotency-Key=${job.key}`, job, narr),
    line('INFO', 'redis', `LPUSH celery ${taskLabel(job)}`, job),
  );
}

function submitOne(s: SimState, key: string | undefined, isFirst: boolean): SimState {
  const existing = key === undefined ? undefined : findJobByKey(s, key);
  if (existing && s.cfg.apiIdempotency) {
    const msg = `POST /jobs 200 Idempotency-Key=${key} returned existing job=${existing.id}`;
    return appendLog(s, line('INFO', 'api', msg, existing, 'sim.api_existing_job'));
  }
  if (existing) return createJob(s, key, 'sim.api_duplicate_job');
  return createJob(s, key, isFirst ? 'sim.jobs_submitted' : undefined);
}

function submit(s: SimState, n: number, key: string | undefined): SimState {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SUBMIT) {
    throw new RangeError(`submit n must be an integer 1..${MAX_SUBMIT}`);
  }
  if (key !== undefined && (typeof key !== 'string' || !KEY_PATTERN.test(key))) {
    throw new RangeError(`submit key must be 1..${MAX_KEY_LENGTH} chars of [A-Za-z0-9_.:-]`);
  }
  if (!canSubmit(s, n)) return s;
  let next = s;
  for (let i = 0; i < n; i += 1) next = submitOne(next, key, i === 0);
  return next;
}

// ---------------------------------------------------------------- broker → worker

function nextDeliverable(s: SimState): BrokerMsg | undefined {
  let best: BrokerMsg | undefined;
  for (const m of s.queue) {
    if (m.reservedBy !== undefined || m.visibleAt > s.now) continue;
    const earlier =
      !best ||
      m.visibleAt < best.visibleAt ||
      (m.visibleAt === best.visibleAt && m.deliveryTag < best.deliveryTag);
    if (earlier) best = m;
  }
  return best;
}

function dispatch(s: SimState): SimState {
  let next = s;
  for (const id of WORKER_IDS.slice(0, s.cfg.workers)) {
    if (next.workers[id].state !== 'idle') continue;
    const msg = nextDeliverable(next);
    if (!msg) break;
    next = deliver(next, id, msg);
  }
  return next;
}

function reserveMsg(s: SimState, wid: WorkerId, msg: BrokerMsg, job: Job): SimState {
  if (!s.cfg.acksLate) {
    // acks_late off: the message is acked on receipt, so a crash loses it.
    const acked = removeMsg(s, msg.deliveryTag);
    const at = s.now + stuckAfter(s.cfg);
    return schedule(acked, { kind: 'stuck', at, jobId: job.id });
  }
  const deadline = s.now + s.cfg.visibilityTimeout;
  const queue = s.queue.map((m) =>
    m.deliveryTag === msg.deliveryTag ? { ...m, reservedBy: wid, visibleAt: deadline } : m,
  );
  return schedule(
    { ...s, queue },
    { kind: 'visibility', at: deadline, deliveryTag: msg.deliveryTag },
  );
}

function deliver(s: SimState, wid: WorkerId, msg: BrokerMsg): SimState {
  const job = s.jobs[msg.jobId];
  const attempt = job.attempt + 1;
  const [u, drawn] = draw(s);
  const [lo, hi] = s.cfg.taskMs;
  const reserved = reserveMsg(drawn, wid, msg, job);
  const started = patchWorker(
    patchJob(reserved, job.id, {
      state: 'running',
      attempt,
      workerId: wid,
      nextAttemptAt: undefined,
    }),
    wid,
    { state: 'busy', jobId: job.id, deliveryTag: msg.deliveryTag, taskMs: lo + u * (hi - lo) },
  );
  // A redelivery (attempt ahead of the retry count) says so, with the same attempt number as the
  // broker's line: Celery's try counter does not move on a redelivery, which read as a contradiction.
  const msgText =
    attempt > job.retries + 1
      ? `Task ${taskLabel(job)} received again (redelivered, attempt ${attempt})`
      : `Task ${taskLabel(job)} received (try ${job.retries + 1}/${job.maxAttempts})`;
  return enterPhase(appendLog(started, line('INFO', wid, msgText, job)), wid, 'fetch');
}

/** Floors each share so the phases never add up to more than the task (which is < visibilityTimeout). */
export function phaseDuration(taskMs: Ms, phase: Phase): Ms {
  return Math.max(1, Math.floor(taskMs * PHASE_SHARE[phase]));
}

function enterPhase(s: SimState, wid: WorkerId, phase: Phase): SimState {
  const w = s.workers[wid];
  if (w.killAtPhase === phase) return killWorker(s, wid);
  const job = s.jobs[w.jobId ?? ''];
  if (phase === 'side_effect' && s.cfg.idempotency && s.appliedKeys.includes(job.key)) {
    return enterPhase(replayCharge(s, job), wid, 'write');
  }
  const endsAt = s.now + phaseDuration(w.taskMs ?? s.cfg.taskMs[1], phase);
  const s2 = patchWorker(patchJob(s, job.id, { phase }), wid, { phaseEndsAt: endsAt });
  return schedule(s2, {
    kind: 'phase',
    at: endsAt,
    workerId: wid,
    deliveryTag: w.deliveryTag ?? -1,
  });
}

// ---------------------------------------------------------------- phase outcomes

/** The charge request as the provider sees it: the key travels with it only when idempotency is on. */
function chargeLine(s: SimState, job: Job): string {
  const key = s.cfg.idempotency ? ` Idempotency-Key=${job.key}` : '';
  return `${DOWNSTREAM} 200 job=${job.id}${key}`;
}

/** The provider has seen this Idempotency-Key: it returns the first charge instead of charging again. */
function replayCharge(s: SimState, job: Job): SimState {
  const msg = `${chargeLine(s, job)} (replayed, no new charge)`;
  return appendLog(s, line('INFO', 'downstream', msg, job, 'sim.idempotent_skip'));
}

function applySideEffect(s: SimState, wid: WorkerId, job: Job): SimState {
  const isDuplicate = s.appliedKeys.includes(job.key);
  const applied: SimState = {
    ...patchJob(s, job.id, { sideEffects: job.sideEffects + 1 }),
    appliedKeys: isDuplicate ? s.appliedKeys : [...s.appliedKeys, job.key],
  };
  const ok = appendLog(applied, line('INFO', 'downstream', chargeLine(s, job), job));
  if (!isDuplicate) return enterPhase(ok, wid, 'write');
  const dupMsg = `second charge for job=${job.id} (customer billed twice)`;
  const counted = patchMetrics(ok, { duplicateSideEffects: s.metrics.duplicateSideEffects + 1 });
  const warned = appendLog(
    counted,
    line('WARN', 'downstream', dupMsg, job, 'sim.duplicate_side_effect'),
  );
  return enterPhase(warned, wid, 'write');
}

function deadLetter(s: SimState, wid: WorkerId, job: Job): SimState {
  const tag = s.workers[wid].deliveryTag;
  const done = patchJob(removeMsg(s, tag), job.id, {
    state: 'dead_letter',
    finishedAt: s.now,
    workerId: undefined,
    phase: undefined,
  });
  const counted = patchMetrics(releaseWorker(done, wid), {
    deadLettered: s.metrics.deadLettered + 1,
  });
  const msg = `Task ${taskLabel(job)} failed after ${job.retries + 1} tries, moved to dead_letter`;
  return appendLog(counted, line('ERROR', wid, msg, job, 'sim.dead_lettered'));
}

function scheduleRetry(s: SimState, wid: WorkerId, job: Job): SimState {
  const [u, s1] = draw(s);
  const delay = backoffDelay(s.cfg.backoff, job.retries, u);
  const at = s.now + delay;
  // Celery's retry publishes a new message with a countdown and acks the original.
  const requeued = enqueue(removeMsg(s1, s.workers[wid].deliveryTag), job.id, at);
  const waiting = patchJob(requeued, job.id, {
    state: 'retry_wait',
    retries: job.retries + 1,
    nextAttemptAt: at,
    workerId: undefined,
    phase: undefined,
  });
  const counted = patchMetrics(releaseWorker(waiting, wid), { retries: s.metrics.retries + 1 });
  const msg = `Task ${taskLabel(job)} retry in ${delay}ms (try ${job.retries + 2}/${job.maxAttempts})`;
  return appendLog(counted, line('WARN', wid, msg, job, 'sim.retry_scheduled'));
}

function finishSideEffect(s: SimState, wid: WorkerId, job: Job): SimState {
  if (s.cfg.idempotency && s.appliedKeys.includes(job.key)) {
    // A concurrent job with the same key was charged first: the provider replays that charge.
    return enterPhase(replayCharge(s, job), wid, 'write');
  }
  const [u, s1] = draw(s);
  if (u >= s.cfg.flakiness) return applySideEffect(s1, wid, job);
  const failed = appendLog(
    s1,
    line('WARN', 'downstream', `${DOWNSTREAM} 503 Service Unavailable job=${job.id}`, job),
  );
  return job.retries + 1 >= job.maxAttempts
    ? deadLetter(failed, wid, job)
    : scheduleRetry(failed, wid, job);
}

function succeed(s: SimState, wid: WorkerId, job: Job): SimState {
  const done = patchJob(removeMsg(s, s.workers[wid].deliveryTag), job.id, {
    state: 'succeeded',
    finishedAt: s.now,
    workerId: undefined,
    phase: undefined,
  });
  const latencies = Object.values(done.jobs)
    .filter((j) => j.state === 'succeeded')
    .map((j) => (j.finishedAt ?? j.enqueuedAt) - j.enqueuedAt);
  const counted = patchMetrics(releaseWorker(done, wid), {
    succeeded: s.metrics.succeeded + 1,
    p50Ms: median(latencies),
  });
  const msg = `Task ${taskLabel(job)} succeeded in ${s.now - job.enqueuedAt}ms`;
  return appendLog(counted, line('INFO', wid, msg, job));
}

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  fetch: 'compute',
  compute: 'side_effect',
  write: 'ack',
};

function onPhaseEnd(s: SimState, wid: WorkerId, deliveryTag: number): SimState {
  const w = s.workers[wid];
  if (w.state !== 'busy' || w.deliveryTag !== deliveryTag) return s; // stale timer
  const job = s.jobs[w.jobId ?? ''];
  const next = job.phase ? NEXT_PHASE[job.phase] : undefined;
  if (next) return enterPhase(s, wid, next);
  return job.phase === 'side_effect' ? finishSideEffect(s, wid, job) : succeed(s, wid, job);
}

// ---------------------------------------------------------------- failures and recovery

function killWorker(s: SimState, wid: WorkerId): SimState {
  const w = s.workers[wid];
  if (w.state === 'dead') return s;
  const job = w.state === 'busy' && w.jobId ? s.jobs[w.jobId] : undefined;
  // The whole host goes down (not one pool child, which Celery reports as WorkerLostError and
  // acks or requeues at once). Nobody is left to return an unacked message, so it waits for the
  // visibility timeout; an acked one (acks_late off) is orphaned in `running`.
  const orphaned = job
    ? patchJob(s, job.id, {
        state: findMsg(s, w.deliveryTag) ? 'reserved' : 'running',
        workerId: undefined,
        phase: undefined,
      })
    : s;
  const restartAt = s.cfg.autoRestart ? s.now + RESTART_DELAY_MS : undefined;
  const dead = patchWorker(orphaned, wid, {
    state: 'dead',
    jobId: undefined,
    deliveryTag: undefined,
    phaseEndsAt: undefined,
    taskMs: undefined,
    killAtPhase: undefined,
    restartAt,
  });
  const timed =
    restartAt === undefined
      ? dead
      : schedule(dead, { kind: 'restart', at: restartAt, workerId: wid });
  const msg = `celery@${wid} lost (host down)`;
  return appendLog(timed, line('ERROR', wid, msg, job, 'sim.worker_killed'));
}

function startBoot(s: SimState, wid: WorkerId): SimState {
  const at = s.now + BOOT_MS;
  return schedule(patchWorker(s, wid, { state: 'booting', restartAt: at }), {
    kind: 'boot',
    at,
    workerId: wid,
  });
}

function onBoot(s: SimState, wid: WorkerId, at: Ms): SimState {
  const w = s.workers[wid];
  if (w.state !== 'booting' || w.restartAt !== at) return s;
  const ready = patchWorker(s, wid, { state: 'idle', restartAt: undefined });
  return appendLog(ready, line('INFO', wid, `celery@${wid} ready`, undefined, 'sim.worker_ready'));
}

function onRestart(s: SimState, wid: WorkerId, at: Ms): SimState {
  const w = s.workers[wid];
  return w.state === 'dead' && w.restartAt === at ? startBoot(s, wid) : s;
}

function onVisibility(s: SimState, deliveryTag: number): SimState {
  const msg = findMsg(s, deliveryTag);
  if (!msg) return s; // acked in time
  // Its worker is dead: validateConfig keeps visibilityTimeout above the longest task and each
  // delivery fixes its duration, so a live worker always acks first. Real Redis would redeliver
  // here even while the worker is alive (a slow task runs twice), which is why idempotency matters.
  const job = s.jobs[msg.jobId];
  const requeued = patchJob(enqueue(removeMsg(s, deliveryTag), job.id, s.now), job.id, {
    state: 'queued',
    workerId: undefined,
  });
  const text = `redelivering job ${job.id} (attempt ${job.attempt + 1})`;
  const counted = patchMetrics(requeued, { redelivered: s.metrics.redelivered + 1 });
  return appendLog(counted, line('WARN', 'redis', text, job, 'sim.redelivered'));
}

function onStuckCheck(s: SimState, jobId: string): SimState {
  const job = s.jobs[jobId];
  if (job?.state !== 'running') return s; // finished, or finished and pruned
  // A live owner is a newer delivery (after a retry) with its own check: tasks finish within
  // stuckAfter, so the delivery that scheduled this check is over.
  const isOwned = Object.values(s.workers).some((w) => w.state === 'busy' && w.jobId === jobId);
  if (isOwned) return s;
  const lost = patchMetrics(
    patchJob(s, jobId, { state: 'lost', finishedAt: s.now, phase: undefined }),
    { lost: s.metrics.lost + 1 },
  );
  const msg = `stuck-job detector: job ${jobId} running with no live worker, marked lost`;
  return appendLog(lost, line('ERROR', 'db', msg, job, 'sim.job_lost'));
}

function handleTimer(s: SimState, t: Timer): SimState {
  switch (t.kind) {
    case 'phase':
      return onPhaseEnd(s, t.workerId, t.deliveryTag);
    case 'visibility':
      return onVisibility(s, t.deliveryTag);
    case 'stuck':
      return onStuckCheck(s, t.jobId);
    case 'restart':
      return onRestart(s, t.workerId, t.at);
    case 'boot':
      return onBoot(s, t.workerId, t.at);
    case 'wake':
      return s; // a delayed message became visible; dispatch runs after every timer
  }
}

// ---------------------------------------------------------------- actions

function assertWorker(id: WorkerId): void {
  if (!WORKER_IDS.includes(id)) throw new RangeError(`unknown worker: ${String(id)}`);
}

function kill(s: SimState, wid: WorkerId, atPhase: Phase | undefined): SimState {
  assertWorker(wid);
  if (atPhase === undefined) return killWorker(s, wid);
  if (!PHASES.includes(atPhase)) throw new RangeError(`unknown phase: ${String(atPhase)}`);
  const w = s.workers[wid];
  if (w.state === 'dead') return s;
  const current = w.state === 'busy' ? s.jobs[w.jobId ?? '']?.phase : undefined;
  return current === atPhase ? killWorker(s, wid) : patchWorker(s, wid, { killAtPhase: atPhase });
}

function restart(s: SimState, wid: WorkerId): SimState {
  assertWorker(wid);
  return s.workers[wid].state === 'dead' ? startBoot(s, wid) : s;
}

function tick(s: SimState, dt: Ms): SimState {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('tick dt must be a finite number >= 0');
  const target = s.now + dt;
  let next = s;
  for (let top = heapPeek(next.timers); top && top.at <= target; top = heapPeek(next.timers)) {
    const { rest } = heapPop(next.timers);
    next = dispatch(handleTimer({ ...next, now: top.at, timers: rest }, top));
  }
  return { ...next, now: target };
}

/** Pure and deterministic: the same state and action always give the same new state. */
export function reduce(s: SimState, a: Action): SimState {
  switch (a.type) {
    case 'submit':
      return dispatch(submit(s, a.n, a.key));
    case 'kill':
      return dispatch(kill(s, a.worker, a.atPhase));
    case 'restart':
      return dispatch(restart(s, a.worker));
    case 'setConfig':
      return dispatch({ ...s, cfg: mergeConfig(s.cfg, a.patch) });
    case 'tick':
      return tick(s, a.dt);
  }
}
