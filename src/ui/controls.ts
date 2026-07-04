import { CanalType, EarSide, Pathology } from '../physics/canal';

export type PlaybackMode = 'maneuver' | 'gyro' | 'mouse';
export type ManeuverKey =
  | 'dixHallpike'
  | 'semontDiagnostic'
  | 'semontLiberatory'
  | 'epley'
  | 'rollTest'
  | 'bbqRoll'
  | 'zuma';

const MANEUVERS_BY_CANAL: Record<CanalType, { key: ManeuverKey; label: string }[]> = {
  posterior: [
    { key: 'dixHallpike', label: 'Dix-Hallpike' },
    { key: 'semontDiagnostic', label: 'Semont (diagnostic)' },
    { key: 'semontLiberatory', label: 'Semont (liberatory)' },
    { key: 'epley', label: 'Epley' },
  ],
  horizontal: [
    { key: 'rollTest', label: 'Supine roll test' },
    { key: 'bbqRoll', label: 'BBQ roll' },
    { key: 'zuma', label: 'Zuma (apogeotropic HC cupulolithiasis)' },
  ],
};

export interface ControlsCallbacks {
  onSelectCanal: (canal: CanalType) => void;
  onSelectManeuver: (key: ManeuverKey) => void;
  onSelectSide: (side: EarSide) => void;
  onSelectPathology: (pathology: Pathology) => void;
  onSelectDebrisSide: (onUtricularSide: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  /** Resets only the otoconia clot / cupula / VOR physics state, leaving playback position alone -- useful in gyro/mouse-drag modes where there's no scripted maneuver position to reset. */
  onResetClot: () => void;
  /** fraction is normalized 0..1 of the maneuver's total duration. */
  onScrub: (fraction: number) => void;
  onModeChange: (mode: PlaybackMode) => void;
  /** enable=true: request permission and start listening; enable=false: stop listening. */
  onToggleGyro: (enable: boolean) => void;
  onCalibrateGyro: () => void;
}

/** Plain-DOM control bar: canal/side/maneuver select, transport controls, mode switch, debug readout. */
export class Controls {
  private readonly maneuverSelect: HTMLSelectElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly resetClotBtn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly gyroToggleBtn: HTMLButtonElement;
  private readonly gyroCalibrateBtn: HTMLButtonElement;
  private readonly gyroStatus: HTMLSpanElement;
  private readonly debug: HTMLPreElement;
  // Play/scrub/maneuver only make sense in "maneuver" mode (there's no scripted
  // position to play/scrub through in mouse-drag/gyro mode); gyro on-off/calibrate
  // only make sense in "gyro" mode -- each group is shown/hidden as a whole based on
  // the current mode (see updateModeVisibility), rather than always showing every
  // control regardless of relevance.
  private readonly maneuverGroup: HTMLDivElement;
  private readonly scrubColumn: HTMLDivElement;
  private readonly gyroGroup: HTMLDivElement;
  private scrubbing = false;
  private gyroEnabled = false;

  constructor(container: HTMLElement, callbacks: ControlsCallbacks, initialMode: PlaybackMode = 'maneuver') {
    // Ear/pathology/canal each only ever have two possible values right now (anterior
    // canal isn't modeled yet -- see physics/canal.ts's CanalType), so a single toggle
    // button that flips between them on each tap is a strictly smaller/faster control
    // than a 2-option <select> (no dropdown to open, current value always visible without
    // interaction) -- see makeToggleButton. If/when a third canal type is added, this
    // should go back to a <select>, since a toggle stops making sense past two options.
    const canalToggle = this.makeToggleButton<CanalType>(
      [
        { value: 'posterior', label: 'Posterior canal' },
        { value: 'horizontal', label: 'Horizontal canal' },
      ],
      'posterior',
      (canal) => {
        populateManeuverOptions(canal);
        callbacks.onSelectCanal(canal);
        // Changing canal type resets to that canal's first (diagnostic) maneuver, since
        // the previously-selected maneuver key doesn't apply to the new canal.
        callbacks.onSelectManeuver(this.maneuverSelect.value as ManeuverKey);
      }
    );

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

    // canal-variant-label lives inside the canal panel's own canvas (see index.html) --
    // showing the current ear/pathology/debris-side selection (line 1) and the current
    // playback mode (line 2) right where the model is, now that both the variant toggles
    // AND the mode picker have moved off the control bar into popups (see makePopoverButton
    // below), instead of only being visible after opening one of them.
    const variantLabel = document.getElementById('canal-variant-label') as HTMLDivElement | null;
    const variantLine = document.createElement('div');
    const modeLine = document.createElement('div');
    modeLine.className = 'canal-variant-label__mode';
    variantLabel?.append(variantLine, modeLine);

    let currentSide: EarSide = 'right';
    let currentPathology: Pathology = 'canalithiasis';
    let currentDebrisUtricular = false;
    const updateVariantLabel = (): void => {
      const sideText = currentSide === 'right' ? 'Right ear' : 'Left ear';
      const pathologyText = currentPathology === 'canalithiasis' ? 'Canalithiasis' : 'Cupulolithiasis';
      const debrisText =
        currentPathology === 'cupulolithiasis'
          ? ` · ${currentDebrisUtricular ? 'Utricular-side' : 'Canal-side'} debris`
          : '';
      variantLine.textContent = `${sideText} · ${pathologyText}${debrisText}`;
    };

    const sideToggle = this.makeToggleButton<EarSide>(
      [
        { value: 'right', label: 'Right ear' },
        { value: 'left', label: 'Left ear' },
      ],
      'right',
      (side) => {
        currentSide = side;
        updateVariantLabel();
        callbacks.onSelectSide(side);
      }
    );

    // Same two-values-only reasoning as canalToggle/sideToggle above.
    const debrisSideToggle = this.makeToggleButton<'canal' | 'utricular'>(
      [
        { value: 'canal', label: 'Debris: canal-side' },
        { value: 'utricular', label: 'Debris: utricular-side' },
      ],
      'canal',
      (value) => {
        currentDebrisUtricular = value === 'utricular';
        updateVariantLabel();
        callbacks.onSelectDebrisSide(currentDebrisUtricular);
      }
    );
    // Only meaningful for cupulolithiasis -- see CanalSelector.debrisOnUtricularSide.
    debrisSideToggle.style.display = 'none';

    const pathologyToggle = this.makeToggleButton<Pathology>(
      [
        { value: 'canalithiasis', label: 'Canalithiasis' },
        { value: 'cupulolithiasis', label: 'Cupulolithiasis' },
      ],
      'canalithiasis',
      (pathology) => {
        currentPathology = pathology;
        debrisSideToggle.style.display = pathology === 'cupulolithiasis' ? '' : 'none';
        updateVariantLabel();
        callbacks.onSelectPathology(pathology);
      }
    );
    updateVariantLabel();

    this.playBtn = document.createElement('button');
    this.playBtn.className = 'primary-btn';
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
    resetBtn.title = 'Reset the maneuver position, head orientation, and otoconia/cupula physics';
    resetBtn.addEventListener('click', () => {
      this.playBtn.textContent = 'Play';
      callbacks.onReset();
    });

    this.resetClotBtn = document.createElement('button');
    this.resetClotBtn.textContent = 'Reset debris';
    this.resetClotBtn.title = 'Reset the otoconia debris / cupula physics without changing head position';
    this.resetClotBtn.addEventListener('click', () => callbacks.onResetClot());

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

    // Mode picker's trigger button always reads "Mode" (not the current selection, unlike
    // the ear/canal/pathology toggles) -- the current mode is shown instead as the second
    // line of variantLabel (see modeLine above), matching where the variant popup's own
    // selection is now surfaced. A <select> couldn't do this (its closed state always
    // shows the selected option's own text), so this is a button + popup of one-shot
    // choice buttons instead of makeToggleButton's cycle-in-place pattern.
    const MODE_OPTIONS: { value: PlaybackMode; label: string }[] = [
      { value: 'maneuver', label: 'Scripted maneuver' },
      { value: 'mouse', label: 'Mouse-drag (desktop)' },
      { value: 'gyro', label: 'Gyroscope (phone)' },
    ];
    const MODE_LABELS = Object.fromEntries(MODE_OPTIONS.map((o) => [o.value, o.label])) as Record<
      PlaybackMode,
      string
    >;
    modeLine.textContent = MODE_LABELS[initialMode];
    const modeOptionButtons = MODE_OPTIONS.map((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        modePopover.hidden = true;
        modeLine.textContent = MODE_LABELS[opt.value];
        this.updateModeVisibility(opt.value);
        callbacks.onModeChange(opt.value);
      });
      return b;
    });
    const { button: modeButton, popover: modePopover } = this.makePopoverButton('Mode', modeOptionButtons);

    // Toggle button (not a one-shot "Enable motion" action) so its own label/indicator
    // always reflects whether the gyroscope is actually listening -- tapping it again
    // turns it back off (see onToggleGyro/gyroSource.stop in main.ts).
    this.gyroToggleBtn = document.createElement('button');
    this.gyroToggleBtn.addEventListener('click', () => {
      this.setGyroEnabled(!this.gyroEnabled);
      callbacks.onToggleGyro(this.gyroEnabled);
    });
    this.updateGyroToggleLabel();

    this.gyroCalibrateBtn = document.createElement('button');
    // Label itself carries the calibration state ("Uncalibrated" -> "Recalibrate" on
    // first tap) instead of a separate instructional hint string (see gyroStatus below,
    // which no longer needs to say this) -- the button's own text already tells you
    // whether you've calibrated yet, without a second element to read.
    this.updateCalibrateLabel(false);
    // Callable repeatedly, not just once -- gyroSource.calibrateZero() re-zeroes to
    // whatever orientation the phone is CURRENTLY in on every tap (see
    // DeviceOrientationSource.calibrateZero), so a second (or later) press re-centers
    // the head back to neutral from wherever it's drifted to, same action each time.
    this.gyroCalibrateBtn.title = 'Hold the phone naturally, then tap to set this as head-neutral (tap again anytime to re-center)';
    this.gyroCalibrateBtn.addEventListener('click', () => {
      callbacks.onCalibrateGyro();
      this.updateCalibrateLabel(true);
    });

    this.gyroStatus = document.createElement('span');

    this.debug = document.createElement('pre');
    this.debug.className = 'debug-readout';

    // The scrub range input's own track is thin, leaving spare vertical space above it
    // within the row's full height (set by the taller select/Play button next to it) --
    // stacking the position label directly above the scrub bar in its own column uses
    // that already-there whitespace instead of costing a whole extra row's height the
    // way a row below the group would.
    this.scrubColumn = document.createElement('div');
    this.scrubColumn.className = 'scrub-column';
    this.scrubColumn.append(this.label, this.scrub);

    // Play/scrub/maneuver-select: only meaningful in "maneuver" mode (there's no
    // scripted position to play or scrub through otherwise) -- grouped on one line so
    // they read as a single "maneuver playback" unit, and shown/hidden as a whole (see
    // updateModeVisibility) rather than leaving irrelevant controls visible in the
    // other two modes.
    this.maneuverGroup = document.createElement('div');
    this.maneuverGroup.className = 'control-group';
    this.maneuverGroup.append(this.maneuverSelect, this.playBtn, this.scrubColumn);

    // Gyroscope on/off + calibrate: only meaningful in "gyro" mode.
    this.gyroGroup = document.createElement('div');
    this.gyroGroup.className = 'control-group';
    this.gyroGroup.append(this.gyroToggleBtn, this.gyroCalibrateBtn, this.gyroStatus);

    this.updateModeVisibility(initialMode);

    // Ear/canal/pathology/debris-side used to sit inline in their own row -- four
    // buttons' worth of height on every screen, permanently, even though they're changed
    // rarely compared to Play/scrub. Moved into a single popup opened by one "BPPV
    // Variant" trigger button instead, freeing that row's height for the 3D views (the
    // scarce resource on mobile); the current selection is still visible at a glance via
    // variantLabel, now overlaid on the canal canvas itself instead of read off these
    // buttons' own labels.
    const { button: variantButton } = this.makePopoverButton('BPPV Variant', [
      sideToggle,
      canalToggle,
      pathologyToggle,
      debrisSideToggle,
    ]);

    // Context row: variant picker, mode picker, and both reset buttons -- everything
    // that's always relevant regardless of playback mode, and (with the variant/mode
    // pickers now popup buttons rather than inline toggles or a <select>) short enough to
    // guarantee this fits on one line. Row 2 (playbackRow) is then only ever the
    // maneuver OR gyro group (mutually exclusive by mode, see updateModeVisibility), so
    // every mode is capped at two rows total.
    const contextRow = document.createElement('div');
    contextRow.className = 'control-row';
    contextRow.append(variantButton, modeButton, resetBtn, this.resetClotBtn);

    const playbackRow = document.createElement('div');
    playbackRow.className = 'control-row';
    playbackRow.append(this.maneuverGroup, this.gyroGroup, this.debug);

    container.append(contextRow, playbackRow);
  }

  /**
   * A trigger button + a popup of arbitrary content, positioned ABOVE the button (not
   * below) since the control bar this is used from sits at the page's bottom edge
   * (sticky on mobile) -- opening downward would usually overflow off the viewport.
   * Closes on any outside click. Shared by the "BPPV Variant" and "Mode" pickers (see
   * their own call sites) rather than duplicating this positioning/open/close logic
   * for each.
   */
  private makePopoverButton(
    label: string,
    content: HTMLElement[]
  ): { button: HTMLButtonElement; popover: HTMLDivElement } {
    const popover = document.createElement('div');
    popover.className = 'variant-popover';
    popover.hidden = true;
    popover.append(...content);
    document.body.appendChild(popover);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = popover.hidden;
      popover.hidden = !opening;
      if (opening) {
        const rect = button.getBoundingClientRect();
        popover.style.left = `${rect.left}px`;
        popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      }
    });
    document.addEventListener('click', (e) => {
      if (!popover.hidden && e.target !== button && !popover.contains(e.target as Node)) {
        popover.hidden = true;
      }
    });
    return { button, popover };
  }

  /**
   * A button that cycles through a fixed, small set of values on each click, showing
   * the CURRENT value as its own label -- used in place of a <select> for controls that
   * only ever have two options (ear side, pathology, canal type -- see their call sites'
   * doc comments). Not generalized beyond that here (no visual "which option" indicator
   * beyond the label text); revisit if a third option is ever added to any of them.
   */
  private makeToggleButton<T extends string>(
    options: { value: T; label: string }[],
    initial: T,
    onChange: (value: T) => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    let current = initial;
    const render = (): void => {
      btn.textContent = options.find((o) => o.value === current)!.label;
    };
    render();
    btn.addEventListener('click', () => {
      const currentIndex = options.findIndex((o) => o.value === current);
      current = options[(currentIndex + 1) % options.length].value;
      render();
      onChange(current);
    });
    return btn;
  }

  private updateModeVisibility(mode: PlaybackMode): void {
    this.maneuverGroup.style.display = mode === 'maneuver' ? '' : 'none';
    this.gyroGroup.style.display = mode === 'gyro' ? '' : 'none';
    // "Reset debris" (onResetClot) exists specifically for mouse-drag/gyro modes, where
    // there's no scripted maneuver position to reset otherwise -- see its own doc
    // comment. In "maneuver" mode, "Reset" already resets the debris/cupula physics
    // alongside the maneuver position, so this button is pure redundant clutter there.
    this.resetClotBtn.style.display = mode === 'maneuver' ? 'none' : '';
  }

  private updateGyroToggleLabel(): void {
    // A small filled/hollow dot as the "indicator" (rather than just swapping text)
    // makes the on/off state legible at a glance rather than requiring the user to
    // actually read the label.
    this.gyroToggleBtn.innerHTML = `<span class="status-dot ${this.gyroEnabled ? 'on' : 'off'}"></span>Gyroscope: ${
      this.gyroEnabled ? 'On' : 'Off'
    }`;
  }

  private updateCalibrateLabel(calibrated: boolean): void {
    this.gyroCalibrateBtn.textContent = calibrated ? 'Recalibrate' : 'Uncalibrated';
  }

  /** Sets the toggle's displayed state without re-firing onToggleGyro -- used when main.ts
   * needs to reflect an outcome the user didn't directly cause (e.g. permission denied
   * reverting an optimistic "On" back to "Off"). */
  setGyroEnabled(enabled: boolean): void {
    this.gyroEnabled = enabled;
    this.updateGyroToggleLabel();
    // Every (re)start of the gyro listener is a fresh session with no zero point set yet
    // -- whether this is turning ON for the first time, being toggled back on after being
    // turned off, or being turned off itself, the calibrate button should read
    // "Uncalibrated" until the user taps it again in THIS session.
    this.updateCalibrateLabel(false);
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
