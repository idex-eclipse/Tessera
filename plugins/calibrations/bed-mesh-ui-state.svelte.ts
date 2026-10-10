/**
 * Внутреннее UI-состояние @core/bed-mesh.
 * НЕ межплагинный канал: приватный модуль одного плагина,
 * связывает ToolsPanel (страница) и ScrewsTiltOverlay (оверлей).
 */
class BedMeshUiState {
  screwsOverlayOpen = $state(false);
}

export const bedMeshUiState = new BedMeshUiState();