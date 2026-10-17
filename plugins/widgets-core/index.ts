import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

import TemperatureGraphWidget from './temperature/components/widgets/TemperatureGraphWidget.svelte';
import TemperatureHeader from './temperature/components/widgets/TemperatureHeader.svelte';
defineMpuElement('mpu-widgets-temperature-graph', TemperatureGraphWidget);
defineMpuElement('mpu-widgets-temperature-header', TemperatureHeader);
import TemperatureChip from './temperature/components/chips/TemperatureChip.svelte';
import TemperatureChipPicker from './temperature/components/chips/TemperatureChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-temperature', TemperatureChip);
defineMpuElement('mpu-core-widgets-chip-temperature-picker', TemperatureChipPicker);

import StatusWidget from './status/components/widgets/StatusWidget.svelte';
import StatusHeader from './status/components/widgets/StatusHeader.svelte';
import StatusBanner from './status/components/banners/StatusBanner.svelte';
defineMpuElement('mpu-widgets-status', StatusWidget);
defineMpuElement('mpu-widgets-status-header', StatusHeader);
defineMpuElement('mpu-widgets-status-banner', StatusBanner);
import FleetStatusPanel from './status/components/fleet/StatusPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-status', FleetStatusPanel);

import MacrosWidget from './macros/components/widgets/MacrosWidget.svelte';
import MacrosHeader from './macros/components/widgets/MacrosHeader.svelte';
defineMpuElement('mpu-widgets-macros', MacrosWidget);
defineMpuElement('mpu-widgets-macros-header', MacrosHeader);
import MacroChip from './macros/components/chips/MacroChip.svelte';
import MacroChipPicker from './macros/components/chips/MacroChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-macro', MacroChip);
defineMpuElement('mpu-core-widgets-chip-macro-picker', MacroChipPicker);

import ToolsWidget from './tools/components/widgets/ToolsWidget.svelte';
import ToolsHeader from './tools/components/widgets/ToolsHeader.svelte';
defineMpuElement('mpu-widgets-tools', ToolsWidget);
defineMpuElement('mpu-widgets-tools-header', ToolsHeader);
import TuningChip from './tools/components/chips/TuningChip.svelte';
import TuningChipPicker from './tools/components/chips/TuningChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-tuning', TuningChip);
defineMpuElement('mpu-core-widgets-chip-tuning-picker', TuningChipPicker);

import LimitsWidget from './limits/LimitsWidget.svelte';
defineMpuElement('mpu-widgets-limits', LimitsWidget);

import OutputsWidget from './outputs/components/widgets/OutputsWidget.svelte';
defineMpuElement('mpu-widgets-outputs', OutputsWidget);
import OutputChip from './outputs/components/chips/OutputChip.svelte';
import OutputChipPicker from './outputs/components/chips/OutputChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-output', OutputChip);
defineMpuElement('mpu-core-widgets-chip-output-picker', OutputChipPicker);

import CameraWidget from './camera/components/widgets/CameraWidget.svelte';
import CameraHeader from './camera/components/widgets/CameraHeader.svelte';
defineMpuElement('mpu-widgets-camera', CameraWidget);
defineMpuElement('mpu-widgets-camera-header', CameraHeader);
import FleetCameraPanel from './camera/components/fleet/CameraPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-camera', FleetCameraPanel);

import FilamentWidget from './filament-sensors/components/widgets/FilamentWidget.svelte';
defineMpuElement('mpu-widgets-filament', FilamentWidget);
import FilamentChip from './filament-sensors/components/chips/FilamentChip.svelte';
import FilamentChipPicker from './filament-sensors/components/chips/FilamentChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-filament', FilamentChip);
defineMpuElement('mpu-core-widgets-chip-filament-picker', FilamentChipPicker);

import JobQueueWidget from './job-queue/JobQueueWidget.svelte';
defineMpuElement('mpu-widgets-job-queue', JobQueueWidget);