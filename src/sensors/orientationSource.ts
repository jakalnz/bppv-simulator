import { Quat } from '../physics/types';

/**
 * Common interface for anything that can supply the current head orientation --
 * a scripted ManeuverPlayer, live device gyroscope, or mouse-drag fallback are all
 * interchangeable at the call site.
 */
export interface OrientationSource {
  currentOrientation(): Quat | null;
  /**
   * Wall-clock time (performance.now(), ms) the current currentOrientation() sample was
   * actually captured, if this source knows one -- optional because scripted maneuver
   * playback and mouse-drag both recompute/apply their orientation every physics tick,
   * so the fixed physics timestep IS the right interval to use for their own angular
   * velocity. Device gyro events do NOT arrive every physics tick (browsers commonly
   * throttle deviceorientation well below the 120Hz physics rate), so using the fixed
   * timestep there would divide a real rotation that took several tick-widths to arrive
   * by only one tick-width, inflating computed angular velocity -- see
   * DeviceOrientationSource's own doc comment and main.ts's stepPhysicsOnce for how this
   * timestamp is used to compute the TRUE elapsed time between samples instead.
   */
  sampleTimestampMs?(): number | null;
}
