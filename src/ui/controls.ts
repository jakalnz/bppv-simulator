import { CanalType, EarSide } from '../physics/canal';

export type PlaybackMode = 'maneuver' | 'gyro' | 'mouse';
export type ManeuverKey = 'dixHallpike' | 'epley' | 'rollTest' | 'bbqRoll';

const MANEUVERS_BY_CANAL: Record<CanalType, { key: ManeuverKey; label: string }[]> = {
  posterior: [
    { key: 'dixHallpike', label: 'Dix-Hallpike' },
    { key: 'epley', label: 'Epley' },
  ],
  horizontal: [
    { key: 'rollTest', label: 'Supine roll test' },
    { key: 'bbqRoll', label: 'BBQ roll' },
  ],
};

export interface ControlsCallbacks {
  onSelectCanal: (canal: CanalType) => void;
  onSelectManeuver: (key: ManeuverKey) => void;
  onSelectSide: (side: EarSide) => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  /** Resets only the otoconia clot / cupula / VOR physics state, leaving playback position alone -- useful in gyro/mouse-drag modes where there's no scripted maneuver position to reset. */
  onResetClot: () => void;
  /** fraction is normalized 0..1 of the maneuver's total duration. */
  onScrub: (fraction: number) => void;
  onModeChange: (mode: PlaybackMode) => void;
  onEnableGyro: () => void;
  onCalibrateGyro: () => void;
}

/** Plain-DOM control bar: canal/side/maneuver select, transport controls, mode switch, debug readout. */
export class Controls {
  private readonly maneuverSelect: HTMLSelectElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly gyroEnableBtn: HTMLButtonElement;
  private readonly gyroCalibrateBtn: HTMLButtonElement;
  private readonly gyroStatus: HTMLSpanElement;
  private readonly debug: HTMLPreElement;
  private scrubbing = false;

  constructor(container: HTMLElement, callbacks: ControlsCallbacks, initialMode: PlaybackMode = 'maneuver') {
    const canalSelect = document.createElement('select');
    canalSelect.innerHTML = `
      <option value="posterior">Posterior canal</option>
      <option value="horizontal">Horizontal canal</option>
    `;

    this.maneuverSelect = document.createElement('select');
    const populateManeuverOptions = (canal: CanalType): void => {
      this.maneuverSelect.innerHTML = MANEUVERS_BY_CANAL[canal]
        .map((m) => `<option value="${m.key}">${m.label}</option>`)
        .join('');
    };
    populateManeuverOptions('posterior');
    this.maneuverSelect.addEventListener('change', () =>
      callbacks.onSelectManeuver(this.maneuverSelect.value as ManeuverKey)
    );

    canalSelect.addEventListener('change', () => {
      const canal = canalSelect.value as CanalType;
      populateManeuverOptions(canal);
      callbacks.onSelectCanal(canal);
      // Changing canal type resets to that canal's first (diagnostic) maneuver, since
      // the previously-selected maneuver key doesn't apply to the new canal.
      callbacks.onSelectManeuver(this.maneuverSelect.value as ManeuverKey);
    });

    const sideSelect = document.createElement('select');
    sideSelect.innerHTML = `
      <option value="right">Right ear</option>
      <option value="left">Left ear</option>
    `;
    sideSelect.addEventListener('change', () => callbacks.onSelectSide(sideSelect.value as EarSide));

    this.playBtn = document.createElement('button');
    this.playBtn.textContent = 'Play';
    this.playBtn.addEventListener('click', () => {
      if (this.playBtn.textContent === 'Play') {
        this.playBtn.textContent = 'Pause';
        callbacks.onPlay();
      } else {
        this.playBtn.textContent = 'Play';
        callbacks.onPause();
      }
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      this.playBtn.textContent = 'Play';
      callbacks.onReset();
    });

    const resetClotBtn = document.createElement('button');
    resetClotBtn.textContent = 'Reset clot';
    resetClotBtn.title = 'Reset the otoconia clot / cupula physics without changing head position';
    resetClotBtn.addEventListener('click', () => callbacks.onResetClot());

    this.scrub = document.createElement('input');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.max = '1';
    this.scrub.step = '0.01';
    this.scrub.value = '0';
    this.scrub.addEventListener('pointerdown', () => (this.scrubbing = true));
    this.scrub.addEventListener('pointerup', () => (this.scrubbing = false));
    this.scrub.addEventListener('input', () => callbacks.onScrub(parseFloat(this.scrub.value)));

    this.label = document.createElement('span');
    this.label.style.minWidth = '220px';

    const modeSelect = document.createElement('select');
    modeSelect.innerHTML = `
      <option value="maneuver">Scripted maneuver</option>
      <option value="mouse">Mouse-drag (desktop)</option>
      <option value="gyro">Gyroscope (phone)</option>
    `;
    modeSelect.value = initialMode;
    modeSelect.addEventListener('change', () => callbacks.onModeChange(modeSelect.value as PlaybackMode));

    this.gyroEnableBtn = document.createElement('button');
    this.gyroEnableBtn.textContent = 'Enable motion';
    this.gyroEnableBtn.addEventListener('click', () => callbacks.onEnableGyro());

    this.gyroCalibrateBtn = document.createElement('button');
    this.gyroCalibrateBtn.textContent = 'Zero';
    this.gyroCalibrateBtn.title = 'Hold the phone naturally, then tap to set this as head-neutral';
    this.gyroCalibrateBtn.addEventListener('click', () => callbacks.onCalibrateGyro());

    this.gyroStatus = document.createElement('span');

    this.debug = document.createElement('pre');
    this.debug.className = 'debug-readout';

    const transportGroup = document.createElement('div');
    transportGroup.className = 'control-group';
    transportGroup.append(this.playBtn, resetBtn, resetClotBtn, this.scrub, this.label);

    const modeGroup = document.createElement('div');
    modeGroup.className = 'control-group';
    modeGroup.append(modeSelect, this.gyroEnableBtn, this.gyroCalibrateBtn, this.gyroStatus);

    container.append(sideSelect, canalSelect, this.maneuverSelect, transportGroup, modeGroup, this.debug);
  }

  setProgress(fraction: number, label: string): void {
    if (!this.scrubbing) this.scrub.value = String(fraction);
    this.label.textContent = label;
  }

  setPlayingLabel(isPlaying: boolean): void {
    this.playBtn.textContent = isPlaying ? 'Pause' : 'Play';
  }

  setGyroStatus(text: string): void {
    this.gyroStatus.textContent = text;
  }

  setDebugReadout(text: string): void {
    this.debug.textContent = text;
  }
}
