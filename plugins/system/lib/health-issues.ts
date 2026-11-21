/**
 * Сборщик списка проблем здоровья для компактного fleet-индикатора.
 * Чистая логика без Svelte и i18n: возвращает структурированные issue-дескрипторы,
 * где `textKey` — готовый ключ локализации (существующий или из `fleet.health.*`),
 * а компонент только вызывает `i18n.t`. Severity-правила дублируют отображение
 * HostCard / McuCard / TmcTable, чтобы индикатор не спорил со страницей Мониторинг.
 */
import type { McuHealth, TmcDriver } from './health-model';
import {
  busStateSeverity,
  cpuTempSeverity,
  TMC_CRITICAL_FLAGS,
  type LinkReason,
  type ThrottleFlag,
  type ThrottleState,
} from './health-utils';

export type HealthIssueScope = 'host' | 'mcu' | 'tmc';

export interface HealthIssue {
  /** предупреждение или критическая проблема — «зелёного» состояния здесь нет */
  severity: 'warn' | 'crit';
  /** группа проблемы: заголовок в popover берётся из system.health.<scope> */
  scope: HealthIssueScope;
  /** MCU (короткое имя) или драйвер (stepper), к которому относится проблема; '' — весь хост */
  target: string;
  /** ключ локализации детального текста проблемы */
  textKey: string;
  /** параметры интерполяции для текста проблемы */
  params?: Record<string, string | number>;
}

export interface HealthIssuesInput {
  /** Klipper готов: иначе данные MCU/драйверов устаревшие и не оцениваются */
  klippyReady: boolean;
  throttle: ThrottleState;
  cpuTemp: number | null;
  failedComponents: string[];
  warnings: string[];
  mcus: McuHealth[];
  tmc: TmcDriver[];
}

/** Троттлинг, угрожающий качеству печати — критичен (как в HostCard и health-alerts). */
const CRITICAL_THROTTLE: ReadonlySet<ThrottleFlag> = new Set(['undervoltage', 'throttled']);

/** Состояния CAN-шины, о которых сообщаем отдельной строкой (reason busState не дублируем). */
const BUS_STATES: ReadonlySet<string> = new Set(['warning', 'passive', 'off']);

/**
 * Собирает список текущих проблем здоровья принтера. Порядок стабилен:
 * хост → MCU → драйверы, внутри группы — в порядке данных модели.
 */
export function collectHealthIssues(input: HealthIssuesInput): HealthIssue[] {
  const out: HealthIssue[] = [];

  // Хост: троттлинг и температура оцениваются всегда, даже когда Klipper не готов.
  if (input.throttle.supported) {
    for (const flag of input.throttle.now) {
      out.push({
        severity: CRITICAL_THROTTLE.has(flag) ? 'crit' : 'warn',
        scope: 'host',
        target: '',
        textKey: `system.throttle.${flag}`,
      });
    }
  }
  const tempSev = cpuTempSeverity(input.cpuTemp);
  if (tempSev === 'warn' || tempSev === 'crit') {
    out.push({
      severity: tempSev,
      scope: 'host',
      target: '',
      // value уже округлено: компонент подставляет как есть
      textKey: 'fleet.health.cpuTemp',
      params: { value: (input.cpuTemp as number).toFixed(1) },
    });
  }
  for (const c of input.failedComponents) {
    out.push({ severity: 'crit', scope: 'host', target: '', textKey: 'fleet.health.failedComponent', params: { name: c } });
  }
  for (const w of input.warnings) {
    out.push({ severity: 'warn', scope: 'host', target: '', textKey: 'fleet.health.moonrakerWarning', params: { text: w } });
  }

  if (input.klippyReady) {
    for (const mcu of input.mcus) {
      // Неизвестное состояние связи (нет статистики) — не проблема, просто ещё нет данных.
      if (mcu.link.severity !== 'warn' && mcu.link.severity !== 'crit') continue;
      for (const reason of mcu.link.reasons) {
        // busState раскрывается отдельной строкой ниже — здесь он дублировал бы её.
        if (reason === 'busState') continue;
        out.push({
          severity: mcu.link.severity,
          scope: 'mcu',
          target: mcu.short,
          textKey: `system.link.reason.${reason}`,
        });
      }
      if (mcu.bus && BUS_STATES.has(mcu.bus.state ?? '')) {
        out.push({
          severity: busStateSeverity(mcu.bus.state) === 'crit' ? 'crit' : 'warn',
          scope: 'mcu',
          target: mcu.short,
          // динамический ключ: system.link.bus.<state>; компонент показывает сырое состояние как fallback
          textKey: `system.link.bus.${mcu.bus.state}`,
        });
      }
    }

    for (const d of input.tmc) {
      // Выключенный мотор — не неисправность; severity модели это уже учитывает через idle.
      if (d.severity !== 'warn' && d.severity !== 'crit') continue;
      const target = d.stepper || d.name;
      if (d.noResponse) {
        out.push({ severity: 'crit', scope: 'tmc', target, textKey: 'system.tmc.noResponse' });
        continue;
      }
      for (const flag of [...d.decoded.errors, ...d.decoded.temp]) {
        out.push({
          severity: TMC_CRITICAL_FLAGS.has(flag) ? 'crit' : 'warn',
          scope: 'tmc',
          target,
          textKey: `system.tmc.flag.${flag}`,
        });
      }
    }
  }

  return out;
}

/** Число критических проблем — для tooltip/aria индикатора. */
export function countCritical(issues: HealthIssue[]): number {
  return issues.filter((i) => i.severity === 'crit').length;
}
