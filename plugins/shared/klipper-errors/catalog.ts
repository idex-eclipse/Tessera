/** Stable identifiers shared by the banner, console, and notification action. */
export type KlipperErrorHintId =
  | 'timer-too-close'
  | 'move-out-of-range'
  | 'must-home-axis-first'
  | 'extrude-below-minimum-temp'
  | 'mcu-connection'
  | 'mcu-protocol'
  | 'adc-out-of-range'
  | 'heater-not-heating'
  | 'tmc-reports-error'
  | 'tmc-communication'
  | 'endstop-trigger'
  | 'probe-trigger'
  | 'bltouch'
  | 'homing-communication-timeout'
  | 'mcu-shutdown';

/** One localized explanation shown in the compact help popover. */
export interface KlipperErrorHint {
  id: KlipperErrorHintId;
  signature: string;
  title: string;
  summary: string;
  checks: readonly string[];
}

/** Shared labels around a localized explanation. */
export interface KlipperErrorHintUi {
  open: string;
  checks: string;
}

interface LocalizedHint {
  title: string;
  summary: string;
  checks: readonly string[];
}

interface CatalogEntry {
  id: KlipperErrorHintId;
  signature: string;
  patterns: readonly RegExp[];
  en: LocalizedHint;
  ru: LocalizedHint;
}

const UI: Record<'en' | 'ru', KlipperErrorHintUi> = {
  en: {
    open: 'Explain this Klipper error',
    checks: 'What to check',
  },
  ru: {
    open: 'Пояснить эту ошибку Klipper',
    checks: 'Что проверить',
  },
};

/**
 * Curated common failures. Specific MCU causes stay before the generic shutdown fallback,
 * otherwise a useful diagnosis would be hidden by the broad final pattern.
 */
const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'timer-too-close',
    signature: 'Timer too close',
    patterns: [/timer too close/i],
    en: {
      title: 'MCU timing deadline was missed',
      summary:
        'The micro-controller received work too late to execute it safely. This often points to an overloaded, stalled, overheated, or under-powered host. Also it can be worse connection host to MCU',
      checks: [
        'Check host CPU load, memory and swap usage, storage errors, and throttling or overheating.',
        'Check the host power supply and avoid other heavy tasks while printing.',
        'Check the host-to-MCU connection.',
        'Read klippy.log around the first shutdown line before restarting firmware.',
      ],
    },
    ru: {
      title: 'MCU пропустил временной дедлайн',
      summary:
        'Микроконтроллер получил команду слишком поздно для безопасного выполнения. Частые причины — перегрузка, зависание, перегрев или нестабильное питание хоста. Также причиной может быть плохое соединение хоста с MCU.',
      checks: [
        'Проверьте загрузку CPU, память и swap, ошибки накопителя, троттлинг и перегрев хоста.',
        'Проверьте питание хоста и исключите тяжёлые фоновые задачи во время печати.',
        'Проверьте соединение хоста с MCU.',
        'До перезапуска прошивки найдите первую строку shutdown в klippy.log.',
      ],
    },
  },
  {
    id: 'move-out-of-range',
    signature: 'Move out of range',
    patterns: [/move out of range/i],
    en: {
      title: 'A requested move is outside configured limits',
      summary:
        'Klipper rejected coordinates beyond an axis position_min/position_max. Probably, move calculated from an unexpected coordinate mode or offset.',
      checks: [
        'Compare the reported X/Y/Z coordinates with the configured axis limits.',
        'Check start, end, pause, and tool-change macros for G90/G91 state and calculated park positions.',
        'For Z moves near zero, verify the probe or mesh offset and position_min.',
      ],
    },
    ru: {
      title: 'Перемещение выходит за настроенные пределы',
      summary:
        'Klipper отклонил координаты за пределами position_min/position_max оси. Возможно, движение рассчитано в неожиданном режиме координат или со смещением.',
      checks: [
        'Сравните показанные X/Y/Z с настроенными пределами осей.',
        'Проверьте start/end/pause/tool-change макросы, состояние G90/G91 и расчёт парковочной позиции.',
        'Для движения Z около нуля проверьте смещение probe/mesh и position_min.',
      ],
    },
  },
  {
    id: 'must-home-axis-first',
    signature: 'Must home axis first',
    patterns: [/must home (?:axis|axes) first/i],
    en: {
      title: 'The requested axis has no trusted position',
      summary:
        'Klipper does not know the physical position after startup, motor disable, or a failed homing operation, so it blocks the move.',
      checks: [
        'Home the required axes with G28 before moving them.',
        'Check whether a macro disables steppers with M84/M18 and then attempts another move.',
        'If homing itself fails, resolve the endstop or probe error first.',
      ],
    },
    ru: {
      title: 'Положение оси ещё не определено',
      summary:
        'После запуска, отключения моторов или неудачного homing Klipper не знает физическое положение оси и блокирует движение.',
      checks: [
        'Перед перемещением выполните G28 для нужных осей.',
        'Проверьте, не отключает ли макрос моторы через M84/M18 перед следующим движением.',
        'Если не проходит сам homing, сначала устраните ошибку endstop или probe.',
      ],
    },
  },
  {
    id: 'extrude-below-minimum-temp',
    signature: 'Extrude below minimum temp',
    patterns: [/extrude below minimum temp/i],
    en: {
      title: 'Cold extrusion protection stopped the command',
      summary:
        'The active extruder is below min_extrude_temp, so Klipper refused to move filament and protect the toolhead.',
      checks: [
        'Heat the active extruder above its configured minimum before loading, unloading, or extruding.',
        'Check that the macro selects the intended extruder and waits for its target temperature.',
        'Do not lower the safety threshold merely to suppress a sensor or heater problem.',
      ],
    },
    ru: {
      title: 'Защита от холодной экструзии остановила команду',
      summary:
        'Активный экструдер холоднее min_extrude_temp, поэтому Klipper запретил подачу филамента для защиты печатающей головы.',
      checks: [
        'Перед загрузкой, выгрузкой или экструзией нагрейте активный экструдер выше настроенного минимума.',
        'Проверьте, что макрос выбирает нужный экструдер и ждёт достижения температуры.',
        'Не снижайте защитный порог только ради скрытия проблемы датчика или нагревателя.',
      ],
    },
  },
  {
    id: 'mcu-connection',
    signature: 'Lost communication / Unable to connect to MCU',
    patterns: [
      /lost communication with mcu/i,
      /mcu\b[^\n]*\bunable to (?:connect|open serial port)/i,
    ],
    en: {
      title: 'Communication with an MCU was lost',
      summary:
        'The host cannot reliably reach the controller. Common causes are worse MCU wiring, unstable power, a changed serial path, or a controller reset.',
      checks: [
        'Check controller and host power, cable seating, connectors, and MCU wiring.',
        'For a startup failure, verify the configured serial or CAN identifier still exists.',
        'Inspect klippy.log and host kernel logs for disconnects, resets, or bus errors.',
      ],
    },
    ru: {
      title: 'Потеряна связь с MCU',
      summary:
        'Хост не может надёжно связаться с контроллером. Частые причины — плохое качество подключения MCU, нестабильное питание, изменившийся serial path или перезапуск платы.',
      checks: [
        'Проверьте питание контроллера и хоста, разъёмы, кабели и проводку подключения MCU.',
        'При ошибке запуска проверьте, что настроенный serial или CAN identifier по-прежнему существует.',
        'Проверьте отключения, перезапуски или ошибки шины в klippy.log и системном журнале хоста.',
      ],
    },
  },
  {
    id: 'mcu-protocol',
    signature: 'MCU protocol error',
    patterns: [/\b(?:mcu\s+)?protocol error\b/i, /command format mismatch/i],
    en: {
      title: 'The Klipper host and MCU protocol do not agree',
      summary:
        'The host could not decode the controller command dictionary. This commonly follows a Klipper update where one or more MCUs were not rebuilt and reflashed.',
      checks: [
        'Read klippy.log to identify every MCU with a version or command mismatch.',
        'Rebuild firmware from the same Klipper checkout that runs on the host and reflash each affected MCU.',
        'Verify that the correct firmware image was flashed to the correct board.',
      ],
    },
    ru: {
      title: 'Протокол Klipper и MCU не совпадает',
      summary:
        'Хост не смог прочитать словарь команд контроллера. Обычно это бывает после обновления Klipper, если прошивку одного или нескольких MCU не пересобрали и не прошили заново.',
      checks: [
        'По klippy.log определите все MCU с несовпадением версии или команд.',
        'Соберите прошивку из той же копии Klipper, которая работает на хосте, и прошейте каждый затронутый MCU.',
        'Убедитесь, что правильный образ прошит именно в нужную плату.',
      ],
    },
  },
  {
    id: 'adc-out-of-range',
    signature: 'ADC out of range',
    patterns: [/adc out of range/i],
    en: {
      title: 'A temperature input is outside its safe range',
      summary:
        'An analog sensor reported a value outside the configured min_temp/max_temp range. An open or shorted thermistor circuit is a common cause.',
      checks: [
        'Do not heat the printer until the affected sensor has been identified.',
        'Check sensor wiring, connectors, crimps, pin configuration, and the configured sensor type.',
      ],
    },
    ru: {
      title: 'Показание ADC вышло за безопасный диапазон',
      summary:
        'Аналоговый датчик сообщил значение вне настроенных min_temp/max_temp. Частая причина — обрыв или короткое замыкание цепи термистора.',
      checks: [
        'Не включайте нагрев, пока не определён проблемный датчик.',
        'Проверьте проводку, разъёмы, обжим, настройку пина и тип датчика.',
      ],
    },
  },
  {
    id: 'heater-not-heating',
    signature: 'Heater … not heating at expected rate',
    patterns: [/heater\b[^\n]*\bnot heating at expected rate/i],
    en: {
      title: 'A heater did not warm as expected',
      summary:
        'Klipper applied heat but the measured temperature did not rise enough within the verify_heater limits.',
      checks: [
        'Check heater and sensor wiring, connectors, power delivery, and whether a cooling fan suddenly changes the heat load.',
        'Confirm the configured sensor and heater are paired with the intended physical device.',
        'Only tune verify_heater after proving the hardware is healthy.',
      ],
    },
    ru: {
      title: 'Нагреватель не прогрелся с ожидаемой скоростью',
      summary:
        'Klipper включил нагрев, но измеренная температура не выросла достаточно быстро в пределах verify_heater.',
      checks: [
        'Проверьте проводку и разъёмы нагревателя и датчика, питание и резкое изменение тепловой нагрузки от вентилятора.',
        'Убедитесь, что настроенные датчик и нагреватель относятся к одному физическому устройству.',
        'Меняйте verify_heater только после проверки исправности оборудования.',
      ],
    },
  },
  {
    id: 'tmc-reports-error',
    signature: 'TMC … reports error',
    patterns: [/tmc\b[^\n]*\breports error/i],
    en: {
      title: 'A TMC driver disabled itself',
      summary:
        'The stepper driver reported a fault or an invalid status and stopped driving the motor. The flags in the original message identify the likely cause.',
      checks: [
        'For overtemperature flags, check driver cooling and configured motor current.',
        'For short or overcurrent flags, power off and inspect motor wiring before retrying.',
        'For reset, undervoltage, all-zero, or all-one status, check power and UART/SPI wiring.',
      ],
    },
    ru: {
      title: 'Драйвер TMC отключил себя',
      summary:
        'Драйвер шагового мотора сообщил аварию или некорректный статус и перестал управлять мотором. Возможную причину показывают флаги исходного сообщения.',
      checks: [
        'При флагах перегрева проверьте охлаждение драйвера и настроенный ток мотора.',
        'При коротком замыкании или сверхтоке выключите питание и проверьте проводку мотора.',
        'При reset, undervoltage, статусе из нулей или единиц проверьте питание и UART/SPI проводку.',
      ],
    },
  },
  {
    id: 'tmc-communication',
    signature: 'Unable to read/write TMC UART/SPI register',
    patterns: [/unable to (?:read|write) tmc (?:uart|spi)/i],
    en: {
      title: 'Klipper cannot communicate with a TMC driver',
      summary:
        'Register reads or writes over UART/SPI failed. The driver may be unpowered, miswired, or configured on the wrong pins or bus.',
      checks: [
        'Make sure motor power is present; many drivers cannot communicate from USB power alone.',
        'Check UART/SPI pins, addresses, chip-select wiring, jumpers, and the board schematic.',
        'If the driver was just reflashed or reconfigured, fully remove USB and printer power before retrying.',
      ],
    },
    ru: {
      title: 'Klipper не может связаться с драйвером TMC',
      summary:
        'Чтение или запись регистров по UART/SPI не удалась. Драйвер может быть обесточен, неверно подключён или настроен на другие пины/шину.',
      checks: [
        'Убедитесь, что подано питание моторов: многим драйверам недостаточно одного USB.',
        'Проверьте UART/SPI пины, адреса, chip-select, перемычки и схему платы.',
        'После перепрошивки или перенастройки полностью отключите USB и питание принтера перед повторной проверкой.',
      ],
    },
  },
  {
    id: 'endstop-trigger',
    signature: 'Endstop … still triggered / No trigger … after full movement',
    patterns: [
      /endstop\b[^\n]*\bstill triggered after retract/i,
      /no trigger on (?!probe\b)[^\n]+ after full movement/i,
    ],
    en: {
      title: 'Homing did not see the expected endstop transition',
      summary:
        'The endstop either remained active after retracting or never triggered during the full homing move.',
      checks: [
        'Query the endstop while operating it by hand and confirm open/triggered states change correctly.',
        'Check connector, wiring, pull-up and inversion settings, and homing direction.',
        'For sensorless homing, verify DIAG wiring, sensitivity, current, and that the carriage can move freely.',
      ],
    },
    ru: {
      title: 'Homing не увидел ожидаемое изменение endstop',
      summary:
        'Концевик остался активным после отхода либо не сработал за всё движение homing.',
      checks: [
        'Запросите состояние endstop и вручную переключите его: open/triggered должны меняться корректно.',
        'Проверьте разъём, проводку, pull-up, инверсию сигнала и направление homing.',
        'Для sensorless homing проверьте DIAG, чувствительность, ток и свободное движение каретки.',
      ],
    },
  },
  {
    id: 'probe-trigger',
    signature: 'Probe triggered prior to movement / No trigger on probe',
    patterns: [/probe triggered prior to movement/i, /no trigger on probe after full movement/i],
    en: {
      title: 'The Z probe state did not match the probing move',
      summary:
        'The probe was already triggered before motion or did not trigger before the allowed travel ended.',
      checks: [
        'Use QUERY_PROBE and gently operate the probe to verify that its state changes.',
        'Check probe height, wiring, pin inversion, deployment, and safe Z clearance.',
        'Do not repeat downward moves until you can stop the printer safely if the probe fails.',
      ],
    },
    ru: {
      title: 'Состояние Z-probe не соответствует движению',
      summary:
        'Probe уже был сработавшим до начала движения либо не сработал до конца разрешённого хода.',
      checks: [
        'Выполните QUERY_PROBE и аккуратно нажмите probe: его состояние должно изменяться.',
        'Проверьте высоту, проводку, инверсию пина, выпуск probe и безопасный зазор по Z.',
        'Не повторяйте движение вниз, пока не сможете безопасно остановить принтер при отказе probe.',
      ],
    },
  },
  {
    id: 'bltouch',
    signature: 'BLTouch failed to verify / raise / deploy probe',
    patterns: [/bltouch failed to (?:verify sensor state|raise probe|deploy)/i],
    en: {
      title: 'BLTouch did not reach or report the expected state',
      summary:
        'Klipper could not confirm the probe signal or pin movement. This may be wiring, obstruction, configuration, or an incompatible clone behavior.',
      checks: [
        'Inspect the pin for obstruction or a flashing error state and verify the connector wiring.',
        'Use BLTOUCH_DEBUG pin_up/pin_down and QUERY_PROBE with the toolhead safely away from the bed.',
        'Change clone compatibility options only after completing the checks in the Klipper BLTouch guide.',
      ],
    },
    ru: {
      title: 'BLTouch не достиг или не сообщил ожидаемое состояние',
      summary:
        'Klipper не смог подтвердить сигнал датчика или движение штока. Причиной может быть проводка, механическая помеха, настройка или особенности клона.',
      checks: [
        'Проверьте, не зажат ли шток, нет ли мигающей ошибки и правильно ли подключён разъём.',
        'На безопасной высоте выполните BLTOUCH_DEBUG pin_up/pin_down и QUERY_PROBE.',
        'Меняйте параметры совместимости клонов только после проверок из руководства Klipper по BLTouch.',
      ],
    },
  },
  {
    id: 'homing-communication-timeout',
    signature: 'Communication timeout during homing',
    patterns: [/communication timeout during homing/i],
    en: {
      title: 'MCU communication was too slow during homing',
      summary:
        'Klipper could not coordinate the homing move and endstop response within the required timing, particularly across multiple MCUs.',
      checks: [
        'Check USB/CAN reliability, host load, and power to every MCU involved in the axis.',
        'Keep all steppers of one multi-stepper axis on the same MCU where required by Klipper.',
        'Inspect klippy.log for retransmits or an earlier communication fault.',
      ],
    },
    ru: {
      title: 'Связь с MCU была слишком медленной во время homing',
      summary:
        'Klipper не смог вовремя согласовать движение homing и сигнал endstop, особенно при участии нескольких MCU.',
      checks: [
        'Проверьте USB/CAN, загрузку хоста и питание всех MCU, участвующих в движении оси.',
        'Если Klipper этого требует, держите все моторы одной многомоторной оси на одном MCU.',
        'Найдите ретрансмиты или более раннюю ошибку связи в klippy.log.',
      ],
    },
  },
  {
    id: 'mcu-shutdown',
    signature: "MCU '…' shutdown: …",
    patterns: [/mcu\b[^\n]*\bshutdown\s*:/i],
    en: {
      title: 'An MCU entered its safety shutdown state',
      summary:
        'The controller stopped outputs because it detected a condition it could not safely recover from. This catalog does not recognise the specific reason.',
      checks: [
        'Preserve the exact first shutdown reason and inspect the surrounding klippy.log lines.',
        'Check power, wiring, temperature, and communication before attempting a firmware restart.',
        'Do not repeatedly restart until the underlying hardware or timing cause is understood.',
      ],
    },
    ru: {
      title: 'MCU перешёл в защитное состояние shutdown',
      summary:
        'Контроллер отключил выходы из-за условия, из которого нельзя безопасно восстановиться. Конкретная причина пока не распознана каталогом.',
      checks: [
        'Сохраните точную первую причину shutdown и изучите соседние строки klippy.log.',
        'До firmware restart проверьте питание, проводку, температуру и связь.',
        'Не повторяйте перезапуск, пока не понятна аппаратная или временная причина.',
      ],
    },
  },
];

/** Normalizes transport prefixes and whitespace without discarding diagnostic parameters. */
export function normalizeKlipperError(message: string): string {
  return String(message ?? '')
    .replace(/^\s*!!\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the first, most specific catalog identifier matching a raw Klipper message. */
export function matchKlipperError(message: string): KlipperErrorHintId | null {
  const normalized = normalizeKlipperError(message);
  if (!normalized) return null;
  for (const entry of CATALOG) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) return entry.id;
  }
  return null;
}

/** Returns a localized catalog entry; unsupported locales deliberately fall back to English. */
export function getKlipperErrorHint(
  id: KlipperErrorHintId | string,
  locale: string,
): KlipperErrorHint | null {
  const entry = CATALOG.find((candidate) => candidate.id === id);
  if (!entry) return null;
  const language = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const text = entry[language];
  return {
    id: entry.id,
    signature: entry.signature,
    title: text.title,
    summary: text.summary,
    checks: text.checks,
  };
}

/** Returns localized labels used by the shared popover shell. */
export function getKlipperErrorHintUi(locale: string): KlipperErrorHintUi {
  return locale.toLowerCase().startsWith('ru') ? UI.ru : UI.en;
}

/** Exposes stable ids for exhaustive tests without exporting mutable catalog records. */
export const KLIPPER_ERROR_HINT_IDS: readonly KlipperErrorHintId[] = CATALOG.map(
  (entry) => entry.id,
);
