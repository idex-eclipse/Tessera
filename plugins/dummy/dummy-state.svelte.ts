/**
 * Внутреннее состояние @core/dummy.
 *
 * Это НЕ межплагинный канал: модуль приватный для одного плагина и лишь
 * связывает его собственные вклады (banner/widget -> overlay), чтобы
 * механизм оверлеев можно было проверить до bed-mesh.
 *
 * Реальные оверлеи (TEST_Z) управляют видимостью от api.moonraker(),
 * а не от этого модуля.
 */

class DummyState {
  overlayOpen = $state(false);
}

export const dummyState = new DummyState();