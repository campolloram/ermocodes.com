// Quality tiers: pick a starting tier from the device, then step down when the frame rate sags.
import { PERF } from './config.ts';
import { SOFTWARE_GL } from './head-script.mjs';

export interface DeviceInfo {
  cores: number;
}

export const lastTier = PERF.tiers.length - 1;

/** Weak hardware (few cores) starts one tier down; very weak hardware two. */
export function chooseTier({ cores }: DeviceInfo): number {
  if (cores <= PERF.veryFewCores) return Math.min(2, lastTier);
  if (cores <= PERF.fewCores) return Math.min(1, lastTier);
  return 0;
}

const SOFTWARE_RE = new RegExp(SOFTWARE_GL, 'i');

/**
 * Software rasterisers (no GPU): every WebGL frame costs CPU. The head script keeps them on plain
 * DOM in production; a test build (or a GPU process that fell back after the probe) starts them on
 * the last tier.
 */
export const isSoftwareRenderer = (renderer: string): boolean => SOFTWARE_RE.test(renderer);

export function dprFor(deviceDpr: number, phone: boolean, tier: number): number {
  const cap = phone ? PERF.dprCap.phone : PERF.dprCap.desktop;
  const spec = PERF.tiers[Math.min(tier, lastTier)] ?? PERF.tiers[0]!;
  return Math.max(1, Math.min(deviceDpr, cap) - spec.dprDelta);
}

/** Averages frame times over a window and says when to drop a tier. */
export class FpsMeter {
  private elapsed = 0;
  private frames = 0;
  private cooldown = 0;

  /** Feed one frame (seconds). Returns the window's average fps when a window closes, else null. */
  push(dt: number): number | null {
    if (dt <= 0) return null;
    this.elapsed += dt;
    this.frames += 1;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      this.reset();
      return null;
    }
    if (this.elapsed < PERF.fpsWindow) return null;
    const fps = this.frames / this.elapsed;
    this.reset();
    return fps;
  }

  /** Ignore the next frames: a tier change or an idle period distorts the average. */
  hold(seconds: number = PERF.tierCooldown): void {
    this.cooldown = seconds;
    this.reset();
  }

  private reset(): void {
    this.elapsed = 0;
    this.frames = 0;
  }
}

/** The next tier after a window averaging `fps`, or the same tier when it is fine (or last). */
export function nextTier(tier: number, fps: number): number {
  return fps < PERF.fpsFloor && tier < lastTier ? tier + 1 : tier;
}
