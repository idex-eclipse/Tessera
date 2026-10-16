import type { I18nMessages } from '../../core/host-i18n.svelte.ts';

const en: I18nMessages = {
  locale: {
    name: 'English',
  },

  app: {
    name: 'Tessera',
  },

  common: {
    add: 'Add',
    remove: 'Remove',
    refresh: 'Refresh',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    export: 'Export',
    import: 'Import',
    reset: 'Reset',
    back: 'Back',
    loading: 'Loading',
    error: 'Error',
    confirm: 'Confirm',
    rightPanel: {
      title: 'Machine Control',
      expand: 'Expand panel',
      collapse: 'Collapse panel',
      collapseMenu: 'Collapse menu',
      expandMenu: 'Expand menu',
    },
    auth: {
      title: 'Authentication required',
      hint: 'this printer requires authentication',
      username: 'Username',
      password: 'Password',
      submit: 'Sign in',
      failed: 'Invalid username or password',
    },
    klipperNotReady: 'Klippy not ready',
  },

  nav: {
    dashboard: 'Dashboard',
    settings: 'Settings',
    addPrinter: 'Add printer',
    collapse: 'Collapse menu',
  },

  printer: {
    statusConnecting: 'Connecting',
    statusOffline: 'Offline',
    statusOnline: 'Online',
    lastSuccessfulConnection: 'Last successful connection',
    retryConnection: 'Retry connection',
    noPrinters: 'No printers configured',
    addFirstPrinter: 'Add your first printer',
  },

  settings: {
    title: 'Settings',
    general: 'General',
    printers: 'Printers',
    plugins: 'Plugins',
    pages: 'Pages',
    dashboard: 'Dashboard',
    about: {
      title: 'About / Debug',
      guards: 'Guards',
      parkedChains: 'Running guards',
      noParked: 'No running guards',
    },

    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',

    language: 'Language',
    units: 'Units',

    sidebarCollapsed: 'Collapse sidebar',
    sidebarWidth: 'Sidebar width',

    addPluginByUrl: 'Add plugin by URL',
    exportSettings: 'Export settings',
    importSettings: 'Import settings',
    resetSettings: 'Reset settings',

    addPrinterTitle: 'Add printer',
    editPrinterTitle: 'Edit printer',
    printerName: 'Name',
    printerNamePlaceholder: 'My awesome printer',
    printerUrl: 'URL',
    testConnection: 'Test connection',
    printersActivate: 'Activate',

    printer: 'Printer',
    printerActive: 'Active printer',
    pagesHint: 'Show or hide plugin pages for the selected printer.',
    dashboardHint: 'Drag to reorder, pull the right/bottom edges to resize.',

    builtin: 'Built-in',
    remote: 'Remote',
    enable: 'Enable',
    disable: 'Disable',
    importError: 'Invalid settings file.',

    addPlugin: 'Add plugin',
    allPrinters: 'All printers',
    scopeHint: 'If nothing selected — plugin available on all printers.',

    catalog: 'Catalog',
    catalogEmpty: 'No plugins available in catalog',
    installedPlugins: 'Installed plugins',
    addPluginAdvanced: 'Add by URL (advanced)',
    advancedConfirm: 'Installing from external URL. Ensure you trust the source. Continue?',
    advancedWarning: 'External plugins may contain malicious code. Install only from trusted sources.',
    installed: 'Installed',
    update: 'Update',
    external: 'External',

    syncSettings: 'Sync settigns',

    bgImage: 'Background image',
    bgImageUpload: 'Upload…',
    bgImageTooLarge: 'Image is too large or exceeds storage limit (max 8 MB source)',
    bgImageUnsupported: 'Unsupported or corrupted image file',
    
    accent: 'Accent color',
    accentCustom: 'Custom color',
    accentReset: 'Reset to default',
    accentInvalid: 'Invalid color (use #RRGGBB)',
    accentPresets: {
      blue: 'Blue',
      green: 'Green',
      purple: 'Purple',
      orange: 'Orange',
      red: 'Red',
      teal: 'Teal',
    },

    legacy: {
      title: 'Settings format changed',
      description:
        'Settings format changed. Export current settings or reset?',
      export: 'Export current settings',
      reset: 'Reset settings',
    },
  },

  dashboard: {
    addWidget: 'Add widget',
    resetLayout: 'Reset layout',
    provider: 'Provider',
    noWidgets: 'No widgets yet',
    resetLayoutConfirm: 'Reset dashboard layout? This cannot be undone.',
    editLayout: 'Edit layout',
    editHint: 'Drag to move, resize from edges.',
    editToStart: 'Click "Edit layout" to add and arrange widgets',
    done: 'Done',
  },

  quickAccess: {
    empty: 'No chip providers available',
    addChip: 'Add chip',
    resetLayout: 'Reset quick chips',
    resetLayoutConfirm: 'Remove all quick access chips? This cannot be undone.',
    providerMissing: 'Provider missing',
    editHint: 'Click + to add chips, ✕ to remove. Chips act normally outside edit mode.',
    capReached: 'Limit reached: {max} chips max',
  },

  fleet: {
    title: 'Fleet Overview',
    close: 'Close',
    empty: 'No printers configured',
    activate: 'Activate',
    active: 'Active',
    noPanels: 'No panels available',
    pluginMissing: 'Plugin not loaded',
  },
};

export default en;