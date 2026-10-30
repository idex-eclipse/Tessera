/**
 * Общие типы подсказок о G-code и макросах. Модуль и его потребители (консоль,
 * редактор конфигов) говорят на этих типах.
 */

/** Как выглядит значение параметра в usage из G-Codes.md. */
export type ValueKind = 'enum' | 'number' | 'name' | 'text' | 'flag';

export interface ParamInfo {
  name: string;
  /** `NAME=значение` (расширенные команды, макросы) или буква (`X`, `S` у G/M-команд) */
  style: 'named' | 'letter';
  optional: boolean;
  required: boolean;
  valueKind: ValueKind;
  /** текст плейсхолдера: `config_name`, `value`, `speed` */
  hint?: string;
  /** допустимые значения (`0|1`, `PRIMARY|COPY|MIRROR|INACTIVE`) */
  choices?: string[];
  /** тип параметра макроса (из `| int`, `| float`) */
  type?: 'int' | 'float' | 'string';
  /** значение по умолчанию (jinja `default(...)` у макроса) */
  def?: string | null;
  description?: string;
}

/** Команда, как её описывает G-Codes.md. */
export interface CommandDoc {
  name: string;
  kind: 'standard' | 'extended';
  /** секция конфига, при которой команда доступна: `adxl345` */
  module?: string;
  /** первое предложение описания */
  description: string;
  /** описание целиком */
  details: string;
  usages: string[];
  params: ParamInfo[];
}

export interface GcodeDocs {
  /** ключ — имя команды в верхнем регистре */
  commands: Map<string, CommandDoc>;
}

export interface CommandInfo {
  name: string;
  kind: 'standard' | 'extended' | 'macro';
  description?: string;
  details?: string;
  module?: string;
  params: ParamInfo[];
}

/** Каталог команд принтера, ключ — имя в верхнем регистре (Klipper нечувствителен к регистру). */
export type Catalog = Map<string, CommandInfo>;
