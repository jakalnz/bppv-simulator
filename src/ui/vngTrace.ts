export interface VngSample {
  t: number; // seconds
  horizontalDeg: number;
  verticalDeg: number;
  torsionalDeg: number;
}

const WINDOW_SECONDS = 10;
/** Y-axis half-range in degrees. Covers the model's full single-axis deviation range
 * (up to ~20 deg before a quick-phase reset) with margin, while gridlines every 2 deg
 * keep a 1-2 deg/s slow phase (10-20 deg of drift over the 10s window) clearly resolvable. */
const DEG_RANGE = 25;
const GRIDLINE_STEP_DEG = 2;
const LABELED_GRIDLINE_STEP_DEG = 10;

// Color choice: no single color convention is universal across VNG manufacturers, so
// this uses the common cross-tool RGB<->XYZ axis convention (Red/Green/Blue for three
// orthogonal axes), applied here as Horizontal/Vertical/Torsional respectively.
export const COLOR_HORIZONTAL = '#e2534a';
export const COLOR_VERTICAL = '#4caf6b';
export const COLOR_TORSIONAL = '#4a90d9';

/** Scrolling 10-second strip-chart of horizontal/vertical/torsional eye position, VNG-trace style. */
export class VngTrace {
  private samples: VngSample[] = [];
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  reset(): void {
    this.samples = [];
  }

  pushSample(sample: VngSample): void {
    this.samples.push(sample);
    const cutoff = sample.t - WINDOW_SECONDS;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) this.samples.shift();
  }

  render(nowSeconds: number): void {
    const canvas = this.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    // Reads the current theme fresh every frame (cheap: a single dataset read) rather
    // than caching it, so a mid-session theme toggle (see ui/theme.ts) is reflected on
    // the very next frame -- these colors are drawn directly onto the canvas, not CSS,
    // so they don't otherwise pick up the toggle at all.
    const isLight = document.documentElement.dataset.theme === 'light';
    ctx.fillStyle = isLight ? '#f3f4f6' : '#12151a';
    ctx.fillRect(0, 0, width, height);
    if (width === 0 || height === 0) return;

    const gridStrong = isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.28)';
    const gridWeak = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const gridLabel = isLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)';

    const t0 = nowSeconds - WINDOW_SECONDS;
    const xForT = (t: number) => ((t - t0) / WINDOW_SECONDS) * width;
    const yForDeg = (deg: number) => height / 2 - (deg / DEG_RANGE) * (height / 2);

    // Horizontal gridlines (degree markers), finer than the labeled ones so a 1-2 deg/s
    // slow-phase slope is still visibly resolvable, not just the labeled 10-deg lines.
    ctx.font = '10px monospace';
    for (let deg = -DEG_RANGE; deg <= DEG_RANGE; deg += GRIDLINE_STEP_DEG) {
      const y = yForDeg(deg);
      const isZero = deg === 0;
      const isLabeled = deg % LABELED_GRIDLINE_STEP_DEG === 0;
      ctx.strokeStyle = isZero ? gridStrong : gridWeak;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (isLabeled && !isZero) {
        ctx.fillStyle = gridLabel;
        ctx.fillText(`${deg}°`, 4, y - 2);
      }
    }

    // Vertical gridlines every second.
    ctx.strokeStyle = gridWeak;
    for (let s = Math.ceil(t0); s <= nowSeconds; s++) {
      const x = xForT(s);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal channel is drawn NEGATED relative to the raw horizontalDeg sign: per
    // eyeScene.ts's verified screen convention, positive horizontalDeg = pupil moves
    // screen-RIGHT, and a fast phase toward the patient's right ear appears as
    // screen-LEFT (decreasing horizontalDeg) on that mirrored exam view (see
    // ewaldAsymmetry.test.ts's "quick-phase screen-direction convention" tests). But the
    // clinical VNG strip-chart convention plots a right-beating fast phase as an UPWARD
    // deflection -- so this channel alone is negated before going through yForDeg
    // (which already maps increasing value -> upward) to match that trace convention,
    // independent of the 3D eye view's own (correct, unnegated) screen-direction sign.
    this.drawTrace((s) => -s.horizontalDeg, COLOR_HORIZONTAL, xForT, yForDeg);
    this.drawTrace((s) => s.verticalDeg, COLOR_VERTICAL, xForT, yForDeg);
    this.drawTrace((s) => s.torsionalDeg, COLOR_TORSIONAL, xForT, yForDeg);
  }

  private drawTrace(
    accessor: (s: VngSample) => number,
    color: string,
    xForT: (t: number) => number,
    yForDeg: (deg: number) => number
  ): void {
    if (this.samples.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    this.samples.forEach((s, i) => {
      const x = xForT(s.t);
      const y = yForDeg(accessor(s));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
