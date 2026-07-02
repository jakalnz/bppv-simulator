import { Maneuver } from './types';
import { Quat, quatSlerp } from '../physics/types';

/** Plays a Maneuver's waypoints back over time, slerping between bracketing quaternions. */
export class ManeuverPlayer {
  private elapsed = 0;
  private playing = false;

  constructor(private maneuver: Maneuver) {}

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  reset(): void {
    this.elapsed = 0;
  }

  scrubTo(t: number): void {
    this.elapsed = Math.max(0, Math.min(t, this.duration));
  }

  tick(dt: number): void {
    if (!this.playing) return;
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    if (this.elapsed >= this.duration) this.playing = false;
  }

  setManeuver(m: Maneuver): void {
    this.maneuver = m;
    this.elapsed = 0;
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get duration(): number {
    return this.maneuver.waypoints[this.maneuver.waypoints.length - 1].t;
  }

  get name(): string {
    return this.maneuver.name;
  }

  get currentLabel(): string {
    const wps = this.maneuver.waypoints;
    let label = wps[0].label ?? '';
    for (const wp of wps) {
      if (wp.t <= this.elapsed) label = wp.label ?? label;
      else break;
    }
    return label;
  }

  isFinished(): boolean {
    return this.elapsed >= this.duration;
  }

  currentOrientation(): Quat {
    const wps = this.maneuver.waypoints;
    if (this.elapsed <= wps[0].t) return wps[0].quat;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i];
      const b = wps[i + 1];
      if (this.elapsed >= a.t && this.elapsed <= b.t) {
        const span = b.t - a.t;
        const t = span <= 0 ? 1 : (this.elapsed - a.t) / span;
        return quatSlerp(a.quat, b.quat, t);
      }
    }
    return wps[wps.length - 1].quat;
  }
}
