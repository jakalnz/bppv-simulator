/**
 * Debug-only recorder for the cupula-release detector's actual per-tick numbers
 * (see physics/cupulaRelease.ts), so RELEASE_DECEL_THRESHOLD / INTERACTIVE_RELEASE_DECEL_THRESHOLD
 * can be retuned from real sensor traces (gyro or mouse-drag) instead of guessing. Not
 * wired into the physics loop's behavior at all -- purely an observer, toggled by a
 * debug button in the About popover (see main.ts) and exported as JSON for offline
 * analysis.
 */

export interface TelemetrySample {
  /** Simulation time, seconds, since telemetry recording started. */
  t: number;
  canal: string;
  side: string;
  /** Which orientation source drove this tick. */
  mode: string;
  /** Raw canal-axis-projected angular velocity (rad/s), before smoothing/clamping. */
  projectedOmega: number;
  /** Low-pass-filtered canal-axis-projected angular velocity (rad/s) after this tick. */
  smoothedOmega: number;
  /** (smoothedOmega_this - smoothedOmega_prev) / dt -- what's compared against the threshold. */
  decel: number;
  /** Threshold active this tick (RELEASE_DECEL_THRESHOLD or INTERACTIVE_RELEASE_DECEL_THRESHOLD). */
  decelThreshold: number;
  /** Elapsed wall-clock time (seconds) actually used as the velocity denominator this tick. */
  velocityDt: number;
  /** True on the exact tick a release fired. */
  released: boolean;
}

let recording = false;
let samples: TelemetrySample[] = [];
let startedAtSeconds = 0;

export function isRecording(): boolean {
  return recording;
}

export function startRecording(nowSeconds: number): void {
  recording = true;
  samples = [];
  startedAtSeconds = nowSeconds;
}

export function stopRecording(): void {
  recording = false;
}

export function recordSample(nowSeconds: number, sample: Omit<TelemetrySample, 't'>): void {
  if (!recording) return;
  samples.push({ t: nowSeconds - startedAtSeconds, ...sample });
}

export function sampleCount(): number {
  return samples.length;
}

/** Triggers a browser download of the recorded samples as a JSON file. Does not clear the buffer. */
export function exportRecordingAsJson(filename = 'bppv-release-telemetry.json'): void {
  const blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
