# Документация Tessera

<p><a href="../en/README.md">English</a> · <strong>Русский</strong></p>

Документация описывает хост Tessera и всё, что нужно для разработки
**remote-плагинов**. Она написана по исходному коду; если поведение в коде и в
тексте разошлись, верьте коду и поправьте документ.

## С чего начать

1. [plugin-development.md](plugin-development.md) — руководство по разработке
   плагина: минимальный пример, манифест, контракт Custom Element, сборка,
   жизненный цикл, отладка, подводные камни, чек-лист.
2. [surfaces.md](surfaces.md) — что именно можно добавить в интерфейс и какие
   параметры получает каждая поверхность.
3. [plugin-api.md](plugin-api.md) — справочник `PluginApi`.

## Справочники

| Документ | Тема |
|---|---|
| [architecture.md](architecture.md) | устройство хоста, роли, запуск, модули core |
| [moonraker-proxy.md](moonraker-proxy.md) | `request`, `subscribe`, `onNotify`, `poll`, кэш, ошибки, авторизация |
| [guards.md](guards.md) | preflight-проверки запросов (`allow`/`deny`/`freeze`) |
| [hotkeys.md](hotkeys.md) | горячие клавиши плагинов и хоста, конфликты, переназначение |
| [settings.md](settings.md) | ключи `localStorage`, настройки плагина, sync, экспорт |
| [i18n-and-theming.md](i18n-and-theming.md) | переводы, RTL, CSS-переменные, панельный язык |
| [deployment.md](deployment.md) | `extensions/`, каталог, установка и обновление плагинов |

## Быстрые ответы

- **Как плагин попадает в интерфейс?** Манифест + ES-модуль, регистрирующий
  Custom Elements; хост выставляет элементу свойства `api` и `params`.
- **Как получить данные принтера?** `api.moonraker().subscribe(…)` — см.
  [moonraker-proxy.md](moonraker-proxy.md).
- **Как отправить команду?** `api.moonraker().request('printer.gcode.script', { script })`;
  она пройдёт через гарды.
- **Как сохранить настройку?** `api.settings.set/get` — см. [settings.md](settings.md).
- **Как обновить плагин?** Из реестра: `tessera-ext update --all`, затем F5.
  Плагин, положенный вручную: заменить файлы в `extensions/<имя>/`, поднять `version`,
  `node tools/extensions-sync.cjs`, Update в Settings, F5 при изменении кода.
  См. [deployment.md](deployment.md).
- **Почему не срабатывает моя горячая клавиша?** Конфликт (обе отключены),
  поле ввода, fleet-режим, другая страница — см. [hotkeys.md](hotkeys.md).
- **Почему мой вклад не появился?** Невалидный вклад отбрасывается с
  предупреждением в консоли — см. «Что смотреть в консоли» в
  [plugin-development.md](plugin-development.md#8-отладка-и-разработка).
