import { OrientationSource } from './orientationSource';
import {
  Quat,
  quatFromAxisAngle,
  quatCompose,
  quatInvert,
  v3,
  DEG2RAD,
} from '../physics/types';

interface DeviceOrientationPermissionAPI {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * On iOS 13+, DeviceOrientationEvent access requires an explicit permission grant that
 * MUST be requested from inside a real user-gesture handler (e.g. a button tap) --
 * calling it on page load or in a useEffect-equivalent is silently ignored by iOS.
 */
export async function requestOrientationPermission(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationPermissionAPI })
    .DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    const result = await DOE.requestPermission();
    return result === 'granted';
  }
  return typeof window.DeviceOrientationEvent !== 'undefined';
}

/**
 * Wraps the browser's DeviceOrientationEvent and exposes it as an OrientationSource.
 *
 * The raw device orientation (alpha/beta/gamma, W3C intrinsic Z-X'-Y'' Tait-Bryan
 * angles) is converted to a quaternion, then expressed RELATIVE to a calibrated "zero"
 * pose captured whenever calibrateZero() is called. We deliberately do not attempt to
 * map the phone's own axes onto anatomical HeadFrame axes (right/screen-top/etc.) --
 * that would require the user to hold the phone in one precisely specified way. Instead,
 * whatever raw orientation is current when the user taps "zero" (holding the phone
 * however feels like their head's neutral upright pose) becomes identity, and subsequent
 * physical tilts of the phone are fed to the physics pipeline as the equivalent relative
 * head tilt. This is a deliberate v1 simplification, flagged here rather than hidden.
 */
export class DeviceOrientationSource implements OrientationSource {
  private latestRaw: Quat | null = null;
  private zeroInv: Quat | null = null;

  start(): void {
    window.addEventListener('deviceorientation', this.onEvent);
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.onEvent);
  }

  /** Captures the current raw orientation as the new "head neutral upright" reference. */
  calibrateZero(): void {
    if (this.latestRaw) this.zeroInv = quatInvert(this.latestRaw);
  }

  currentOrientation(): Quat | null {
    if (!this.latestRaw) return null;
    if (!this.zeroInv) return null; // require explicit calibration before driving physics
    return quatCompose(this.zeroInv, this.latestRaw);
  }

  get hasSignal(): boolean {
    return this.latestRaw !== null;
  }

  get isCalibrated(): boolean {
    return this.zeroInv !== null;
  }

  private onEvent = (e: DeviceOrientationEvent): void => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    this.latestRaw = rawQuatFromDeviceOrientation(e.alpha, e.beta, e.gamma);
  };
}

function rawQuatFromDeviceOrientation(alphaDeg: number, betaDeg: number, gammaDeg: number): Quat {
  const qAlpha = quatFromAxisAngle(v3(0, 0, 1), alphaDeg * DEG2RAD); // Z: compass heading
  const qBeta = quatFromAxisAngle(v3(1, 0, 0), betaDeg * DEG2RAD); // X': front-back tilt
  const qGamma = quatFromAxisAngle(v3(0, 1, 0), gammaDeg * DEG2RAD); // Y'': left-right tilt
  const qDevice = quatCompose(quatCompose(qAlpha, qBeta), qGamma);

  const legacyOrientation = (window as unknown as { orientation?: number }).orientation;
  const screenAngle = screen.orientation?.angle ?? legacyOrientation ?? 0;
  const qScreenCorrection = quatFromAxisAngle(v3(0, 0, 1), -screenAngle * DEG2RAD);
  return quatCompose(qDevice, qScreenCorrection);
}
