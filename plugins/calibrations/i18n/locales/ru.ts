export const ru = {
  calibrations: {
    pageTitle: 'Калибровки',
    widgetTitle: 'Статус калибровок',
    empty: 'Команды калибровки не найдены в конфигурации принтера.',
    comingSoon: 'Будет реализовано в следующей фазе',
    saveConfig: 'Save config',
    settings: 'Настройки',
    run: 'Запустить',
    running: 'Идёт прогон…',

    section: {
      shaper: 'Input Shaper',
      probe: 'Зонд и Z-смещение',
      heaters: 'Нагреватели',
      mesh: 'Сетка стола',
    },

    shaper: {
      axis: 'Ось',
      test: 'Тест резонансов',
      calibrate: 'Калибровать',
      testAndGraph: 'Тест + график',
      shellCmd: 'Команда графика',
      refreshGallery: 'Обновить галерею',
      freqStart: 'FREQ_START',
      freqEnd: 'FREQ_END',
      hzPerSec: 'HZ_PER_SEC',
      shaperTypes: 'SHAPER_TYPES (опц.)',
      recommended: 'Рекомендован',
      apply: 'Применить',
      verboseHint: 'verbose: True не задан в команде графика — парсить нечего',
      gallery: 'Графики',
      galleryEmpty: 'В config-руте пока нет png',
      newBadge: 'new',
      sessionLog: 'Лог прогона',
      notHomedHint: 'Оси не припаркованы — shaper-команды требуют xyz',
      table: { 
        shaper: 'Шейпер', 
        freq: 'Частота, Гц', 
        vib: 'Вибрации, %', 
        smooth: 'Сглаживание' 
      },
      saveConfirmTitle: 'Сохранить конфигурацию?',
      saveConfirmText: 'Klipper перезапустит прошивку для записи результатов калибровки. Во время перезапуска нагреватели остынут.',
    },

    belts: {
      title: 'Натяжение ремней',
      short: 'Ремни',
      enableHint: 'Показать секцию теста натяжения ремней внутри таба Input Shaper',
      kinematics: 'Кинематика',
      corexy: 'CoreXY (2 оси)',
      delta: 'Delta (3 оси)',
      cmd: 'Команда графика',
      run: 'Прогнать тесты',
      runGraph: 'Тесты + график',
      forceShow: 'Показать панель ремней (принудительно)',
      helpFlow:
        'По документации Klipper «Testing custom axes»: пресет последовательно шлёт TEST_RESONANCES AXIS=… OUTPUT=raw_data по каждой оси (CoreXY: 1,1 и 1,-1; Delta: три оси башен), затем ОДИН RUN_SHELL_COMMAND, чей конфиг прогоняет graph_accelerometer.py по /tmp/raw_data_axis*.csv и даёт ОДИН сравнительный png. Новый png появляется в панели Graphs с бейджем «new».', helpSnippetTitle: 'Пример shell-команды (ваш конфиг)',
      helpSnippet:
        '[gcode_shell_command generate_belts_graph]\n' +
        'command: bash -c "~/klipper/scripts/graph_accelerometer.py -c /tmp/raw_data_axis*.csv -o ~/printer_data/config/shapers/belts.png && rm -f /tmp/raw_data_axis*.csv"\n' +
        'timeout: 60.0\n' +
        'verbose: True\n' +
        'Хвостовой rm -f держит следующий прогон чистым: glob сравнивает только CSV текущей сессии.',
      helpReadTitle: 'Как читать',
      helpRead:
        'Совпадающие кривые = равномерное натяжение; заметный развод пиков по частоте = один ремень перетянут. Числовых вердиктов Klipper здесь не даёт — сравнение визуальное, в отличие от калибровки шейпера.',
      helpKin:
        'Кинематика намеренно НЕ автодетектится (может быть прописана как cartesian с настроенной математикой шаговиков). Выберите пресет вручную; по-прежнему требует [resonance_tester] + акселерометр, как и shaper-панель.',
    },

    graphs: {
      title: 'Графики',
      previewTitle: 'Превью',
      helpDiscovery:
        'Графики обнаруживаются диффом листингов config-рута (корень + shapers/) до и после прогона: новые или изменённые png получают бейдж «new» — прогоны shaper и belts питают один список. Галерея — объединение всех png этих листингов, сортировка по времени изменения; тег оси — эвристика по имени файла.',
      helpPreview:
        'Превью всегда читается свежим (cache: no-store) и показывается через object URL, освобождаемый при смене выбора и unmount — фиксированные имена файлов не могут отдать stale-png. Клик по плитке — превью.',
      sideEffect:
        'png в config-руте также видны в файловой таблице плагина Config (просмотрщик картинок) — принятый побочный эффект, не прячем.',
    },

    probe: {
      mode: 'Режим зонда',
      modes: { 
        eddy: 'Eddy (вихретоковый)', 
        probe: 'Probe', 
        bltouch: 'BLTouch', 
        endstop: 'Z-эндстоп',
        load_cell_probe: 'Тензодатчик',
        none: '—' 
      },
      chip: 'Eddy-чип',
      startWizard: 'Запустить мастер зонда',
      startEddy: 'Калибровать Eddy-зонд',
      startEndstop: 'Калибровать Z-эндстоп',
      sessionActive: 'Сессия активна, z = {z} мм',
      sessionHint: 'Управление — в оверлее TEST_Z (плагин bed-mesh)',
      zOffsetProbe: 'probe z_offset',
      zOffsetBltouch: 'bltouch z_offset',
      zOffsetEndstop: 'stepper_z position_endstop',
      accuracy: 'Точность зонда',
      count: 'PROBE_COUNT',
      run: 'Запустить',
      running: 'Идёт прогон…',
      table: { 
        max: 'Макс', 
        min: 'Мин', 
        range: 'Размах', 
        avg: 'Среднее', 
        median: 'Медиана', 
        stddev: 'СКО' 
      },
      rawFallback: 'Сырой вывод',
      log: 'Лог сессии',
    },

    heaters: {
      title: 'Нагреватели',
      heater: 'Нагреватель',
      target: 'Температура, °C',
      run: 'Запустить ПИД',
      tuning: 'Идёт автоподстройка…',
      results: 'Результаты ПИД',
      kp: 'Kp',
      ki: 'Ki',
      kd: 'Kd',
      apply: 'Применить',
      invalidTarget: 'Температура должна быть от 1 до {max}°C',
      noData: 'Нет данных',
      settings: 'Настройки',
      threshold: 'Порог девиации (°C)',
      thresholdHint: 'Предупреждение, если температура отклоняется от цели более чем на N°C в течение 20с (40с при печати)',
      deviationAlert: 'Нагреватель {heater}: отклонение {dev}°C от цели {target}°C — рекомендуется ПИД-калибровка',
      saveConfirmTitle: 'Сохранить конфигурацию?',
      saveConfirmText: 'Klipper перезапустит прошивку для записи новых значений Kp/Ki/Kd. Во время перезапуска нагреватели остынут.',
    },

    mesh: {
      currentProfile: 'Текущий профиль',
      openPage: 'Открыть сетку стола',
      none: '—',
    },

    liveZ: {
      tab: 'Live Z',
      title: 'Live Z-смещение',
      probeOffset: 'probe z_offset',
      offsetDelta: 'дельта смещения',
      notHomed: 'Z не припаркована — команды уходят с MOVE=0',
      steps: 'Шаг подстройки',
      increase: 'Увеличить смещение (+step)',
      decrease: 'Уменьшить смещение (−step)',
      saveOffset: 'Сохранить оффсет',
      saveOffsetHint: 'Перенести текущую подстройку в z_offset зонда (Z_OFFSET_APPLY_PROBE)',
      saveConfirmTitle: 'Сохранить конфигурацию?',
      saveConfirmText: 'Klipper перезапустит прошивку для записи Z-смещения. Во время перезапуска нагреватели остынут.',
      chipSection: 'Z offset',
      help: 'Live Z-смещение: левая колонка показывает эффективный probe z_offset и живую дельту подстройки. Шевроны шлют SET_GCODE_OFFSET Z_ADJUST=±step (MOVE=1 при припаркованной Z, иначе MOVE=0). «Сохранить оффсет» переносит живую подстройку в z_offset зонда (Z_OFFSET_APPLY_PROBE); после этого появляется «Save config» для персиста (рестарт прошивки).',
    },

    help: {
      shaper:
        'Ванильная калибровка input shaper Klipper. Генерация графика задаётся в вашем конфиге — пример:\n' +
        '[gcode_shell_command generate_x_shaper_graph]\n' +
        'command: bash -c "~/klipper/scripts/calibrate_shaper.py /tmp/*_data_x*.csv -o ~/printer_data/config/shapers/x.png"\n' +
        'timeout: 60.0\n' +
        'verbose: True\n' +
        'verbose: True рекомендуется (stdout парсится для recommended-значений). Без него график появится, но Apply будет недоступен.\n' +
        'Тот же приём от stale-CSV: завершите команду `&& rm -f /tmp/*_data_x*.csv` (или `_y_`), чтобы каждый график отражал один прогон.',
      shaperLeave: 'Уход со страницы не отменяет идущий тест или генерацию графика на стороне Klipper. Графики обнаруживаются диффом листингов config-рута до и после прогона; превью всегда читается свежим (no-store).',
      probe:
        'Запускает мастер зонда Klipper. Интерактивная подстройка Z выполняется TEST_Z-оверлеем плагина bed-mesh — он всплывает поверх любой страницы, когда manual_probe.is_active.',
      heaters:
        'ПИД-автоподстройка экструдеров, стола и универсальных нагревателей.\n' +
        '1. Выберите нагреватель и безопасную целевую температуру.\n' +
        '2. Нажмите «Запустить ПИД» — Klipper будет осциллировать нагреватель и выведет итоговые Kp/Ki/Kd.\n' +
        '3. Нажмите «Save config» для записи значений (потребуется рестарт прошивки).\n\n' +
        'Уход со страницы не отменяет подстройку на стороне Klipper.',
      mesh:
        'Редактирование сетки стола выполняется на отдельной странице Bed Mesh. Эта панель показывает активный профиль и даёт ссылки-переходы.',
    },

    guard: {
      save_during_print: 'Нельзя сохранить конфиг во время печати',
      start_during_print: 'Нельзя начать калибровку во время печати',
      needs_homing: 'Оси должны быть в home-положении перед калибровкой шейпера',
      alreadyPending: 'Идентичный запрос уже выполняется',
    },
  },
};