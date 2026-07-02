import { OrientationSource } from './orientationSource';
import { Quat, quatFromAxisAngle, quatCompose, quatIdentity, v3, DEG2RAD } from '../physics/types';

/**
 * Desktop fallback orientation source: click-drag on an element accumulates a
 * pitch/yaw offset from the head-neutral pose. Same OrientationSource interface as
 * the live gyroscope, so the main loop doesn't care which is active.
 */
export class MouseDragSource implements OrientationSource {
  private yaw = 0; // radians, about HeadFrame +Z (superior)
  private pitch = 0; // radians, about HeadFrame +Y (left)
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private el: HTMLElement, private sensitivity = 0.008) {
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
  }

  currentOrientation(): Quat {
    if (this.yaw === 0 && this.pitch === 0) return quatIdentity();
    const qYaw = quatFromAxisAngle(v3(0, 0, 1), this.yaw);
    const qPitch = quatFromAxisAngle(v3(0, 1, 0), this.pitch);
    return quatCompose(qPitch, qYaw);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const limit = 170 * DEG2RAD;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };
}
