export const en = {
  calibrations: {
    pageTitle: 'Calibrations',
    widgetTitle: 'Calibration status',
    empty: 'No calibration commands detected in printer config.',
    comingSoon: 'Coming soon in next phase',
    saveConfig: 'Save config',
    settings: 'Settings',
    run: 'Run',
    running: 'Running…',

    section: {
      shaper: 'Input Shaper',
      probe: 'Probe & Z Offset',
      heaters: 'Heaters',
      mesh: 'Bed Mesh',
    },

    shaper: {
      axis: 'Axis',
      test: 'Test resonances',
      calibrate: 'Calibrate',
      testAndGraph: 'Test + Graph',
      shellCmd: 'Graph cmd',
      refreshGallery: 'Refresh gallery',
      freqStart: 'FREQ_START',
      freqEnd: 'FREQ_END',
      hzPerSec: 'HZ_PER_SEC',
      shaperTypes: 'SHAPER_TYPES (opt)',
      recommended: 'Recommended',
      apply: 'Apply',
      verboseHint: 'verbose: True is not set on the graph command — nothing to parse',
      gallery: 'Graphs',
      galleryEmpty: 'No png found in config root yet',
      newBadge: 'new',
      sessionLog: 'Session log',
      notHomedHint: 'Axes not homed — shaper commands require xyz',
      table: { shaper: 'Shaper', freq: 'Freq, Hz', vib: 'Vibrations, %', smooth: 'Smoothing' },
      saveConfirmTitle: 'Save configuration?',
      saveConfirmText: 'Klipper will restart the firmware to persist calibration results. Heaters will cool down during restart.',
    },

    belts: {
      title: 'Belt tension',
      short: 'Belts',
      enableHint: 'Show the belt tension test panel (CoreXY diagnostics)',
      kinematics: 'Kinematics',  // ← ДОБАВЛЕНО
      cmd: 'Graph cmd',  // ← ДОБАВЛЕНО
      test: 'Test',
      run: 'Test',  // ← ДОБАВЛЕНО (синоним test для единообразия с кнопкой)
      testAndGraph: 'Test + graph',
      runGraph: 'Test + graph',  // ← ДОБАВЛЕНО (синоним testAndGraph)
      corexy: 'CoreXY',  // ← ДОБАВЛЕНО
      delta: 'Delta',  // ← ДОБАВЛЕНО
      auto: 'Auto (detect)',
      detected: 'detected: {k}',
      notDetected: 'CoreXY/Delta kinematics not detected in config — pick a preset manually or leave belts off.',
      forceShow: 'Show Belts panel (force)',
      helpFlow:
        'Per Klipper docs “Testing custom axes”: the preset sends TEST_RESONANCES AXIS=… OUTPUT=raw_data for each axis sequentially (CoreXY: 1,1 and 1,-1; Delta: three tower axes), then one RUN_SHELL_COMMAND whose config runs graph_accelerometer.py over /tmp/raw_data_axis*.csv and produces a SINGLE comparison png. New png appears in the Graphs panel with the “new” badge.',
      helpSnippet:
        '[gcode_shell_command generate_belt_1_graph]\ncommand: bash -c "~/klipper/scripts/calibrate_shaper.py /tmp/*belt_1*.csv -o ~/printer_data/config/shapers/belt_1.png"\ntimeout: 60.0\nverbose: True\n(the second command is the same with belt_2)',
      helpReadTitle: 'How to read',
      helpRead:
        'Compare the two runs: similar recommended frequencies and vibration levels mean evenly tensioned belts. A noticeable spread points to uneven tension — adjust mechanically and re-run. This is diagnostics only: there is no Apply action for belts.',
      helpKin:
        'CoreXY is intentionally NOT auto-detected (it can be configured as cartesian with tuned stepper math). Enable this panel with the "Belts" switch in the Input Shaper header; it still requires [resonance_tester] + accelerometer, like the shaper panel.',
    },

    graphs: {
      title: 'Graphs',
      previewTitle: 'Preview',
      helpDiscovery:
        'Graphs are discovered by diffing config-root listings (root + shapers/) taken before and after a run: new or modified png files get the “new” badge — shaper and belt runs feed the same list. The gallery is the union of all png in those listings, sorted by modification time; the axis tag is a filename heuristic.',
      helpPreview:
        'Preview is always fetched fresh (cache: no-store) and shown via an object URL revoked on selection change or unmount — fixed filenames cannot serve a stale png. Click a tile to preview.',
      sideEffect:
        'png files in the config root are also visible in the Config plugin file table (image viewer) — accepted side effect, we do not hide them.',
    },

    probe: {
      mode: 'Probe mode',
      modes: { 
        eddy: 'Eddy current', 
        probe: 'Probe', 
        bltouch: 'BLTouch', 
        endstop: 'Z endstop', 
        load_cell_probe: 'Load cell',
        none: '—' },
      chip: 'Eddy chip',
      startWizard: 'Start probe wizard',
      startEddy: 'Calibrate Eddy probe',
      startEndstop: 'Calibrate Z endstop',
      sessionActive: 'Session active, z = {z} mm',
      sessionHint: 'Controls live in the TEST_Z overlay (bed-mesh plugin)',
      zOffsetProbe: 'probe z_offset',
      zOffsetBltouch: 'bltouch z_offset',
      zOffsetEndstop: 'stepper_z position_endstop',
      accuracy: 'Probe accuracy',
      count: 'PROBE_COUNT',
      run: 'Run',
      running: 'Running…',
      table: { max: 'Max', min: 'Min', range: 'Range', avg: 'Average', median: 'Median', stddev: 'Std dev' },
      rawFallback: 'Raw output',
      log: 'Session log',
    },

    heaters: {
      title: 'Heaters',
      heater: 'Heater',
      target: 'Target °C',
      run: 'Run PID',
      tuning: 'Autotune in progress…',
      results: 'PID results',
      kp: 'Kp',
      ki: 'Ki',
      kd: 'Kd',
      apply: 'Apply',
      invalidTarget: 'Target must be between 1 and {max}°C',
      noData: 'No data yet',
      settings: 'Settings',
      threshold: 'Deviation threshold (°C)',
      thresholdHint: 'Alert if temperature deviates from target by more than N°C for 20s (40s while printing)',
      deviationAlert: 'Heater {heater}: deviation {dev}°C from target {target}°C — consider PID autotune',
      saveConfirmTitle: 'Save configuration?',
      saveConfirmText: 'Klipper will restart the firmware to persist the new Kp/Ki/Kd values. Heaters will cool down during restart.',
    },

    mesh: {
      currentProfile: 'Current profile',
      openPage: 'Open Bed Mesh',
      none: '—',
    },

    liveZ: {
      tab: 'Live Z',
      title: 'Live Z offset',
      probeOffset: 'Z offset',
      offsetDelta: 'Z adjust',
      notHomed: 'Z not homed — commands sent with MOVE=0',
      steps: 'Adjustment step',
      increase: 'Increase offset (+step)',
      decrease: 'Decrease offset (−step)',
      saveOffset: 'Save offset',
      saveOffsetHint: 'Transfer current adjustment into probe z_offset (Z_OFFSET_APPLY_PROBE)',
      saveConfirmTitle: 'Save configuration?',
      saveConfirmText: 'Klipper will restart the firmware to persist the Z offset. Heaters will cool down during restart.',
      chipSection: 'Z offset',
      help: 'Live Z offset: the left column shows the effective probe z_offset and the live adjustment delta. Chevron buttons send SET_GCODE_OFFSET Z_ADJUST=±step (MOVE=1 when Z is homed, MOVE=0 otherwise). "Save offset" transfers the live adjustment into the probe z_offset (Z_OFFSET_APPLY_PROBE); "Save config" appears afterwards and persists it (firmware restart).',
    },

    help: {
      shaper:
        'Vanilla Klipper input shaper. Graph generation is defined in your config — example:\n' +
        '[gcode_shell_command generate_x_shaper_graph]\n' +
        'command: bash -c "~/klipper/scripts/calibrate_shaper.py /tmp/*_data_x*.csv -o ~/printer_data/config/shapers/x.png"\n' +
        'timeout: 60.0\n' +
        'verbose: True\n' +
        'verbose: True is recommended (stdout is parsed for recommended values). Without it the graph still appears, but Apply will be disabled.',
      shaperLeave: 'Leaving the page does not abort a running test or graph generation on the Klipper side. Graphs are discovered by diffing config-root listings before and after the run; preview is always fetched fresh (no-store).',
      probe:
        'Starts Klipper probe wizard. Interactive Z adjustment is handled by the TEST_Z overlay from the bed-mesh plugin — it appears over any page when manual_probe.is_active.',
      heaters:
        'PID autotune for extruders, heated bed and generic heaters.\n' +
        '1. Pick a heater and a safe target temperature.\n' +
        '2. Click Run PID — Klipper will oscillate the heater and print the resulting Kp/Ki/Kd.\n' +
        '3. Click Save config to persist the values (firmware restart required).\n\n' +
        'Leaving the page does not abort the tuning on Klipper side.',
      mesh:
        'Bed mesh editing lives on the dedicated Bed Mesh page. This panel shows the active profile and provides deep-links.',
    },

    guard: {
      save_during_print: 'Cannot save config while printing',
      start_during_print: 'Cannot start calibration while printing',
      needs_homing: 'Axes must be homed before shaper calibration',
      alreadyPending: 'Identical request is already running',
    },
  },
};