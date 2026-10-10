<p align="center">
  <img src="host/public/logo.svg" width="112" alt="Tessera — изометрический тессеракт" />
</p>
<h1 align="center">Tessera</h1>
<p align="center">Модульный веб-UI для 3D-принтеров Klipper / Moonraker.<br/>
Плагины как плитки мозаики: хост-оркестратор, тонкий SDK, изолированные вклады.</p>

<p align="center">
  <img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" />
  <img alt="Svelte 5" src="https://img.shields.io/badge/svelte-5-ff3e00.svg" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-5-646cff.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6.svg" />
</p>

## Возможности
- Дашборд-грид с виджетами, баннерами и полосой quick-access чипов
- Мультипринтерность: вкладки принтеров, per-printer настройки, общий WebSocket-пул
- Плагин-архитектура: Custom Elements + dynamic import, манифесты вкладов, гард-конвейер
- Темы (light/dark + пользовательский акцент), i18n en/ru + RTL
- Калибровки: input shaper / belts / probe / heaters / bed-mesh в едином панельном языке
- Центр уведомлений с гард- и плагин-источниками (M118 MPU_NOTIFY)

## Быстрый старт (разработка)
```bash
npm install
npm run dev          # vite dev + middleware раздачи /extensions/
npm run check        # svelte-check + tsc
npm run test         # vitest
npm run icons        # regen favicon.ico из SVG-источников