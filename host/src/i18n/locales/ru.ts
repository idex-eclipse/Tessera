import type { I18nMessages } from '../../core/host-i18n.svelte.ts';

const ru: I18nMessages = {
  locale: {
    name: 'Русский',
  },

  app: {
    name: 'Tessera',
  },

  common: {
    add: 'Добавить',
    remove: 'Удалить',
    refresh: 'Обновить',
    edit: 'Изменить',
    save: 'Сохранить',
    cancel: 'Отмена',
    close: 'Закрыть',
    retry: 'Повторить',
    export: 'Экспорт',
    import: 'Импорт',
    reset: 'Сброс',
    back: 'Назад',
    loading: 'Загрузка',
    error: 'Ошибка',
    confirm: 'Подтвердить',
    rightPanel: {
      title: 'Панель управления',
      expand: 'Развернуть панель',
      collapse: 'Свернуть панель',
      open: 'Открыть панель управления',
    },
    auth: {
      title: 'Требуется авторизация',
      hint: 'этот принтер требует авторизации',
      username: 'Логин',
      password: 'Пароль',
      submit: 'Войти',
      failed: 'Неверный логин или пароль',
    },
  },

  nav: {
    dashboard: 'Панель управления',
    settings: 'Настройки',
    addPrinter: 'Добавить принтер',
    collapse: 'Свернуть меню',
    menu: 'Меню',
    openMenu: 'Открыть меню',
  },

  banners: {
    summary: 'Уведомления: {count}',
    show: 'Показать уведомления',
    hide: 'Скрыть уведомления',
  },

  printer: {
    statusConnecting: 'Подключение',
    statusOffline: 'Не в сети',
    statusOnline: 'В сети',
    lastSuccessfulConnection: 'Последняя успешная связь',
    retryConnection: 'Повторить подключение',
    noPrinters: 'Принтеры не настроены',
    addFirstPrinter: 'Добавьте первый принтер',
  },

  settings: {
    title: 'Настройки',
    general: 'Общие',
    printers: 'Принтеры',
    plugins: 'Плагины',
    pages: 'Страницы',
    dashboard: 'Панель управления',
    hotkeys: {
      title: 'Горячие клавиши',
      hint: 'Нажмите «Изменить» и введите новую комбинацию (Esc — отмена). Если две клавиши окажутся на одной комбинации, обе отключатся.',
      hostGroup: 'Навигация (хост)',
      change: 'Изменить',
      pressKeys: 'Нажмите клавиши…',
      default: 'по умолчанию',
      userDisabled: 'выключена',
      conflict: 'конфликт: {with}',
      resetAll: 'Сбросить все',
      resetAllConfirm: 'Вернуть горячие клавиши по умолчанию?',
    },
    about: {
      title: 'О программе',
      guards: 'Охраняемые маршруты',
      parkedChains: 'Выполняемые проверки',
      noParked: 'Нет выполняемых проверок',
      hotkeys: 'Горячие клавиши',
      noHotkeys: 'Горячие клавиши не зарегистрированы',
      hostHotkeys: {
        toggleFleet: 'Режим флита (вкл/выкл)',
        printerN: 'Переключиться на принтер по номеру',
        printerNext: 'Следующий принтер',
        printerPrev: 'Предыдущий принтер',
        dashboard: 'Открыть панель управления активного принтера',
        toggleRightPanel: 'Показать / скрыть правую панель',
        toggleSidebar: 'Показать / скрыть левое меню',
        pageNext: 'Следующая страница (в порядке сайдбара)',
        pagePrev: 'Предыдущая страница (в порядке сайдбара)',
      },
      hotkeyDisabled: 'Отключена: конфликт',
      hotkeyScope: { global: 'Везде', dashboard: 'Панель управления', plugin: 'Страница плагина' },
    },

    theme: 'Тема',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',

    language: 'Язык',
    units: 'Единицы измерения',

    sidebarCollapsed: 'Свернуть боковую панель',
    sidebarWidth: 'Ширина боковой панели',

    addPluginByUrl: 'Добавить плагин по URL',
    exportSettings: 'Экспорт настроек',
    importSettings: 'Импорт настроек',
    resetSettings: 'Сброс настроек',

    addPrinterTitle: 'Добавить принтер',
    editPrinterTitle: 'Изменить принтер',
    printerName: 'Имя',
    printerNamePlaceholder: 'Мой замечательный принтер',
    printerUrl: 'URL',
    testConnection: 'Тест соединения',
    printersActivate: 'Активировать',

    printer: 'Принтер',
    printerActive: 'Активный принтер',
    pagesHint: 'Показ или скрытие страниц плагинов для выбранного принтера.',
    dashboardHint: 'Перетаскивайте для порядка, тяните за правый/нижний край для размера.',

    builtin: 'Встроенный',
    remote: 'Remote',
    enable: 'Включить',
    disable: 'Выключить',
    importError: 'Некорректный файл настроек.',

    addPlugin: 'Добавить плагин', 
    allPrinters: 'Все принтеры', 
    scopeHint: 'Если ничего не выбрано — плагин доступен на всех принтерах.',

    catalog: 'Каталог',
    catalogEmpty: 'В каталоге нет доступных плагинов',
    installedPlugins: 'Установленные плагины',
    addPluginAdvanced: 'Добавить по URL (продвинутый режим)',
    advancedConfirm: 'Установка из внешнего источника. Убедитесь, что доверяете источнику. Продолжить?',
    advancedWarning: 'Внешние плагины могут содержать вредоносный код. Устанавливайте только из доверенных источников.',
    installed: 'Установлен',
    update: 'Обновить',
    external: 'Внешний',

    syncSettings: 'Синхронизировать настройки',

    bgImage: 'Фоновая картинка',
    bgImageUpload: 'Загрузить…',
    bgImageTooLarge: 'Картинка слишком большая или не помещается в хранилище (исходник макс. 8 МБ)',
    bgImageUnsupported: 'Неподдерживаемый или повреждённый файл изображения',

    accent: 'Акцентный цвет',
    accentCustom: 'Свой цвет',
    accentReset: 'Сбросить к дефолту',
    accentInvalid: 'Некорректный цвет (формат #RRGGBB)',
    accentPresets: {
      blue: 'Синий',
      green: 'Зелёный',
      purple: 'Фиолетовый',
      orange: 'Оранжевый',
      red: 'Красный',
      teal: 'Бирюзовый',
    },

    legacy: {
      title: 'Формат настроек изменился',
      description:
        'Формат настроек изменился. Экспортируйте текущие настройки или выполните сброс.',
      export: 'Экспортировать текущие настройки',
      reset: 'Сбросить настройки',
    },
  },

  dashboard: {
    addWidget: 'Добавить виджет',
    resetLayout: 'Сбросить раскладку',
    provider: 'Провайдер',
    noWidgets: 'Виджетов пока нет',
    resetLayoutConfirm: 'Сбросить раскладку дашборда? Это действие нельзя отменить.',
    editLayout: 'Редактировать раскладку',
    editHint: 'Перетаскивайте для перемещения, тяните за края для изменения размера.',
    editToStart: 'Нажмите "Редактировать раскладку" чтобы добавить и расположить виджеты',
    done: 'Готово',
  },

  quickAccess: {
    title: 'Быстрый доступ',
    moveBefore: 'Сдвинуть раньше',
    moveAfter: 'Сдвинуть позже',
    empty: 'Нет доступных провайдеров чипов',
    addChip: 'Добавить чип',
    resetLayout: 'Сбросить чипы',
    resetLayoutConfirm: 'Удалить все чипы быстрого доступа? Это действие нельзя отменить.',
    providerMissing: 'Провайдер недоступен',
    editHint: '«+» добавляет чипы, ✕ удаляет. Вне режима редактирования чипы работают как обычно.',
    capReached: 'Достигнут предел: не более {max} чипов',
  },
  
  fleet: {
    title: 'Обзор парка',
    close: 'Закрыть',
    empty: 'Нет настроенных принтеров',
    activate: 'Активировать',
    active: 'Активный',
    noPanels: 'Нет доступных панелей',
    pluginMissing: 'Плагин не загружен',
    editPanels: 'Редактировать карточки',
    editPanelsTitle: 'Панели карточек Fleet',
    editPanelsHint: 'Перетащите для сортировки, снимите галочку чтобы скрыть',
    editPanelsEmpty: 'Нет доступных панелей',
    panelPluginUnloaded: 'Не загружен',
    panelHidden: 'Скрыт',
  },
};

export default ru;