import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';
import DummyWidget from './DummyWidget.svelte';
import DummyBanner from './DummyBanner.svelte';
import DummyOverlay from './DummyOverlay.svelte';

defineMpuElement('mpu-dummy-widget', DummyWidget);
defineMpuElement('mpu-dummy-banner', DummyBanner);
defineMpuElement('mpu-dummy-overlay', DummyOverlay);