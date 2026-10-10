export interface PidResult {
  kp: number;
  ki: number;
  kd: number;
}

export const heaters = $state({
  heater: '',        // ← переживает переключение вкладок
  target: 200,       // ← тоже
  tuning: false,
  result: null as PidResult | null,
});

export function resetHeatersState(): void {
  heaters.heater = '';
  heaters.target = 200;
  heaters.tuning = false;
  heaters.result = null;
}