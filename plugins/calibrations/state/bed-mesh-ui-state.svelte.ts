/**
 * Внутреннее UI-состояние bed-mesh панели. Приватный модуль одного плагина,
 * связывает ToolsPanel (страница) и ScrewsTiltOverlay (оверлей).
 * Переехал внутрь ядра use-bed-mesh (per-printer instance).
 */
export interface BedMeshUiState {
  screwsOverlayOpen: boolean;
}

export function initialBedMeshUiState(): BedMeshUiState {
  return { screwsOverlayOpen: false };
}