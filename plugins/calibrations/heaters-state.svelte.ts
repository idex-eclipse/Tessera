export interface PidResult {
  kp: number;
  ki: number;
  kd: number;
}

export interface HeatersState {
  heater: string;
  target: number;
  tuning: boolean;
  result: PidResult | null;
}

export function initialHeatersState(): HeatersState {
  return { heater: '', target: 200, tuning: false, result: null };
}