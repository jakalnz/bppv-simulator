import { Quat } from '../physics/types';

/**
 * Common interface for anything that can supply the current head orientation --
 * a scripted ManeuverPlayer, live device gyroscope, or mouse-drag fallback are all
 * interchangeable at the call site.
 */
export interface OrientationSource {
  currentOrientation(): Quat | null;
}
