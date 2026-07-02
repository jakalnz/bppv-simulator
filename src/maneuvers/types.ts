import { Quat } from '../physics/types';

export interface Waypoint {
  /** Seconds since the maneuver started. */
  t: number;
  quat: Quat;
  label?: string;
}

export interface Maneuver {
  name: string;
  waypoints: Waypoint[];
}
