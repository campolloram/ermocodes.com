/**
 * Data model for the job-orchestrator simulation (site-plan §4.7).
 * Pure TypeScript, no DOM: the demo island, the home panel and later slices share it.
 * Illustrative re-creation of Celery + Redis semantics, not client code.
 */

export type Ms = number;
export type WorkerId = 'w1' | 'w2' | 'w3';
export const WORKER_IDS: readonly WorkerId[] = ['w1', 'w2', 'w3'];

/** `reserved`: the message is reserved but its worker died; it waits for the visibility timeout. */
export type JobState =
  'queued' | 'reserved' | 'running' | 'retry_wait' | 'succeeded' | 'dead_letter' | 'lost';
export type TerminalJobState = Extract<JobState, 'succeeded' | 'dead_letter' | 'lost'>;

export type Phase = 'fetch' | 'compute' | 'side_effect' | 'write' | 'ack';
export const PHASES: readonly Phase[] = ['fetch', 'compute', 'side_effect', 'write', 'ack'];

/** i18n narration keys. Log `msg` text stays English; the UI translates these. */
export const NARR_KEYS = [
  'sim.jobs_submitted',
  'sim.api_existing_job',
  'sim.api_duplicate_job',
  'sim.worker_killed',
  'sim.worker_ready',
  'sim.redelivered',
  'sim.idempotent_skip',
  'sim.duplicate_side_effect',
  'sim.retry_scheduled',
  'sim.dead_lettered',
  'sim.job_lost',
  'sim.prompt.kill_w2',
  'sim.intro.happy',
  'sim.intro.kill_worker',
  'sim.intro.flaky_downstream',
  'sim.intro.double_submit',
  'sim.lesson.happy',
  'sim.lesson.kill_worker',
  'sim.lesson.flaky_downstream',
  'sim.lesson.double_submit',
] as const;
export type NarrKey = (typeof NARR_KEYS)[number];

export interface Job {
  id: string;
  key: string;
  state: JobState;
  /** Deliveries so far: 1 on the first run, +1 per retry or redelivery. */
  attempt: number;
  /** Celery's `request.retries`: only downstream-error retries count, never redeliveries. */
  retries: number;
  /** Tries (retries + 1) before dead_letter. */
  maxAttempts: number;
  workerId?: WorkerId;
  phase?: Phase;
  enqueuedAt: Ms;
  nextAttemptAt?: Ms;
  finishedAt?: Ms;
  /** Side effects this job applied (more than 1 means a double charge). */
  sideEffects: number;
  traceId: string;
}

export type WorkerState = 'idle' | 'busy' | 'dead' | 'booting';

export interface Worker {
  id: WorkerId;
  state: WorkerState;
  jobId?: string;
  /** Delivery the worker is executing; stale timers are matched against it. */
  deliveryTag?: number;
  phaseEndsAt?: Ms;
  /** Task duration drawn at delivery; phases split it, so later config changes never stretch it. */
  taskMs?: Ms;
  /** When a dead worker restarts, or a booting worker becomes ready. */
  restartAt?: Ms;
  /** Armed kill: the worker dies as soon as it enters this phase. */
  killAtPhase?: Phase;
}

/** An unacked broker message. Acked messages leave the queue. */
export interface BrokerMsg {
  jobId: string;
  deliveryTag: number;
  /** Deliverable from this time; for a reserved message, its visibility deadline. */
  visibleAt: Ms;
  reservedBy?: WorkerId;
}

export interface BackoffConfig {
  baseMs: Ms;
  factor: number;
  maxMs: Ms;
  jitter: 'none' | 'full';
}

export interface Config {
  workers: 1 | 2 | 3;
  acksLate: boolean;
  idempotency: boolean;
  apiIdempotency: boolean;
  visibilityTimeout: Ms;
  maxAttempts: number;
  /** Probability (0..1) that a downstream call fails. */
  flakiness: number;
  taskMs: [Ms, Ms];
  backoff: BackoffConfig;
  autoRestart: boolean;
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogSrc = 'api' | 'redis' | WorkerId | 'db' | 'downstream';

export interface LogLine {
  t: Ms;
  /** Monotonic line number: a stable key after the log trims its head. */
  seq: number;
  level: LogLevel;
  src: LogSrc;
  /** English, like a real log line. */
  msg: string;
  jobId?: string;
  traceId?: string;
  narr?: NarrKey;
}

export interface Metrics {
  submitted: number;
  succeeded: number;
  retries: number;
  /** Broker redeliveries after a lost worker (not Celery retries, which `retries` counts). */
  redelivered: number;
  deadLettered: number;
  lost: number;
  duplicateSideEffects: number;
  /** Median enqueue-to-success latency of succeeded jobs. */
  p50Ms: number;
}

interface TimerBase {
  at: Ms;
  /** Insertion order; breaks ties so equal-time timers fire deterministically. */
  seq: number;
}

export type Timer = TimerBase &
  (
    | { kind: 'phase'; workerId: WorkerId; deliveryTag: number }
    | { kind: 'visibility'; deliveryTag: number }
    | { kind: 'stuck'; jobId: string }
    | { kind: 'wake' }
    | { kind: 'restart'; workerId: WorkerId }
    | { kind: 'boot'; workerId: WorkerId }
  );

/** A timer before it gets its insertion sequence number. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TimerInput = DistributiveOmit<Timer, 'seq'>;

export interface Counters {
  job: number;
  deliveryTag: number;
  timer: number;
  log: number;
}

export interface SimState {
  now: Ms;
  seed: number;
  rngState: number;
  cfg: Config;
  jobs: Record<string, Job>;
  queue: BrokerMsg[];
  workers: Record<WorkerId, Worker>;
  /** Idempotency keys the payment provider has charged (it replays any repeat). */
  appliedKeys: string[];
  /** Binary min-heap ordered by (at, seq); see heap.ts. */
  timers: Timer[];
  log: LogLine[];
  metrics: Metrics;
  counters: Counters;
}

export type Action =
  | { type: 'submit'; n: number; key?: string }
  /** `atPhase` arms the kill: the worker dies when it next enters that phase. */
  | { type: 'kill'; worker: WorkerId; atPhase?: Phase }
  | { type: 'restart'; worker: WorkerId }
  | { type: 'setConfig'; patch: Partial<Config> }
  | { type: 'tick'; dt: Ms };

export type ScenarioId = 'happy' | 'kill-worker' | 'flaky-downstream' | 'double-submit';

export interface ScriptStep {
  at: Ms;
  action: Action;
  narr?: NarrKey;
}

export interface Scenario {
  id: ScenarioId;
  seed: number;
  cfg: Partial<Config>;
  intro: NarrKey;
  script: ScriptStep[];
  done: (s: SimState) => boolean;
  lesson: NarrKey;
}
