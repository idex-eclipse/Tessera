import type { ExtensionPointDecl } from '../../../plugin-sdk/src/types';

/**
 * Extension points that the shared FileTable uses. FileTable is bundled into each plugin that
 * embeds it and talks to the host as THAT plugin, so a point only exists for a plugin that
 * declares it in its own manifest. A plugin that does not declare these points loses nothing:
 * the host then renders the original (see resolvePointState), so Jobs and History keep working.
 *
 * Keep this list in sync with the `<ExtensionPoint>` / `api.extensions.*` calls in
 * FileTable.svelte (a test compares them).
 */
export const FILE_TABLE_POINT_IDS = {
  /** Extra context-menu items of a file or folder (action, append). */
  actions: 'file-actions',
  /** The whole text editor dialog (element, replacement). */
  editor: 'file-editor',
  /** The whole image viewer dialog (element, replacement). */
  viewer: 'file-viewer',
} as const;

/**
 * Declarations of the FileTable points for a plugin manifest.
 *
 * @param i18nPrefix Plugin i18n root that holds `ext.fileActions`, `ext.fileEditor` and
 *   `ext.fileViewer` (the names shown in host dialogs and Settings → Plugins).
 * @returns Point declarations to spread into `manifest.extensionPoints`.
 */
export function fileTablePoints(i18nPrefix: string): ExtensionPointDecl[] {
  return [
    // Buttons/menu items are drawn by FileTable, an extension only supplies a handler.
    { id: FILE_TABLE_POINT_IDS.actions, kind: 'action', mode: 'append', version: 1, titleKey: `${i18nPrefix}.ext.fileActions` },
    // Replacement (not alternative): the viewer/editor is a whole dialog, there is nothing to choose between
    // at the moment it opens, and a context-menu chooser would clash with the file table's own menu.
    { id: FILE_TABLE_POINT_IDS.editor, kind: 'element', mode: 'replacement', version: 1, titleKey: `${i18nPrefix}.ext.fileEditor` },
    { id: FILE_TABLE_POINT_IDS.viewer, kind: 'element', mode: 'replacement', version: 1, titleKey: `${i18nPrefix}.ext.fileViewer` },
  ];
}
