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
 * Fixed basis conversion from the device's own physical axes (W3C spec: X = device's
 * right edge as viewed face-on, Y = device's top edge, Z = out of the screen toward the
 * viewer) to HeadFrame (+X anterior, +Y left, +Z superior).
 *
 * Assumes the natural "phone represents my head" hold: upright, portrait, screen facing
 * the user (like a mirror/selfie). Under that hold:
 *   - device +Z (out of the screen, toward the real viewer) is the modeled head's own
 *     forward/anterior direction too, since the screen and the (would-be) face point the
 *     same way -> device +Z = HeadFrame +X.
 *   - device +Y (top of screen) is "up" either way -> device +Y = HeadFrame +Z.
 *   - device +X (the phone's own labeled right edge, which is on the REAL viewer's right
 *     as they hold it facing themselves) corresponds to the MODELED head's LEFT side --
 *     the same anatomical left/right flip that happens facing another person (their
 *     right hand is near your left) -> device +X = HeadFrame +Y.
 * Verified this is a proper (non-reflected) rotation by checking it preserves the
 * right-handedness relation X*Y=Z: device_X x device_Y = device_Z maps to
 * HeadFrame_Y x HeadFrame_Z = HeadFrame_X, which holds (a cyclic permutation of
 * HeadFrame's own X*Y=Z rule) -- and independently confirmed by direct numeric
 * substitution (rotate_z(90deg) then rotate_y(90deg) sends device X/Y/Z to exactly
 * HeadFrame Y/Z/X), not assumed from the algebra alone.
 *
 * This previously was NOT applied -- the raw device quaternion's own axis labels were
 * used directly as HeadFrame axes, which only happens to be correct if the phone is
 * held flat (screen up, lying on a table). Held upright against the natural convention
 * above, that produced exactly the reported symptoms: device yaw (about device Y)
 * nodding the head instead of turning it, tilt (about device X) rolling instead of
 * pitching, and a mirrored left/right turn direction.
 */
const DEVICE_TO_HEAD_FRAME: Quat = quatCompose(
  quatFromAxisAngle(v3(0, 1, 0), 90 * DEG2RAD),
  quatFromAxisAngle(v3(0, 0, 1), 90 * DEG2RAD)
);
const HEAD_FRAME_TO_DEVICE: Quat = quatInvert(DEVICE_TO_HEAD_FRAME);

/**
 * Wraps the browser's DeviceOrientationEvent and exposes it as an OrientationSource.
 *
 * The raw device orientation (alpha/beta/gamma, W3C intrinsic Z-X'-Y'' Tait-Bryan
 * angles) is converted to a quaternion in the device's own axis labels, re-expressed in
 * HeadFrame via the fixed DEVICE_TO_HEAD_FRAME conversion above, then expressed RELATIVE
 * to a calibrated "zero" pose captured whenever calibrateZero() is called -- so even if
 * the user doesn't hold the phone in exactly the assumed reference pose, calibration
 * absorbs any residual fixed offset; the DEVICE_TO_HEAD_FRAME conversion is what makes
 * ongoing relative motions (yaw/pitch/roll) map onto the correct HeadFrame axes.
 */
export class DeviceOrientationSource implements OrientationSource {
  private latestRaw: Quat | null = null;
  private zeroInv: Quat | null = null;
  private latestRawAtMs: number | null = null;

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

  /** See OrientationSource's own doc comment for why this exists and how it's used. */
  sampleTimestampMs(): number | null {
    return this.latestRawAtMs;
  }

  private onEvent = (e: DeviceOrientationEvent): void => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const qDevice = rawQuatFromDeviceOrientation(e.alpha, e.beta, e.gamma);
    // Re-express the device's own-axis quaternion in HeadFrame axis labels: if qDevice
    // maps device-local vectors into world space, and a HeadFrame-local vector v_hf
    // corresponds to the device-local vector HEAD_FRAME_TO_DEVICE * v_hf (the inverse of
    // the device->headframe conversion), then the HeadFrame-native quaternion is
    // qDevice composed with HEAD_FRAME_TO_DEVICE.
    this.latestRaw = quatCompose(qDevice, HEAD_FRAME_TO_DEVICE);
    this.latestRawAtMs = performance.now();
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
