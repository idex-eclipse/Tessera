import { defineMpuElement } from '../../plugin-sdk/src/element/define-element';

/** TEMPERATURE */
// Widget
import TemperatureGraphWidget from './temperature/components/widgets/TemperatureGraphWidget.svelte';
import TemperatureHeader from './temperature/components/widgets/TemperatureHeader.svelte';
defineMpuElement('mpu-widgets-temperature-graph', TemperatureGraphWidget);
defineMpuElement('mpu-widgets-temperature-header', TemperatureHeader);

// Fleet
import FleetTempsPanel from './temperature/components/fleet/TempPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-temps', FleetTempsPanel);

// Quick access chip
import TemperatureChip from './temperature/components/chips/TemperatureChip.svelte';
import TemperatureChipPicker from './temperature/components/chips/TemperatureChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-temperature', TemperatureChip);
defineMpuElement('mpu-core-widgets-chip-temperature-picker', TemperatureChipPicker);


/** PRINTING STATUS */
// Widget
import StatusWidget from './status/components/widgets/StatusWidget.svelte';
import StatusHeader from './status/components/widgets/StatusHeader.svelte';
defineMpuElement('mpu-widgets-status', StatusWidget);
defineMpuElement('mpu-widgets-status-header', StatusHeader);

// Banner
import StatusBanner from './status/components/banners/StatusBanner.svelte';
defineMpuElement('mpu-widgets-status-banner', StatusBanner);

// Fleet
import FleetStatusPanel from './status/components/fleet/StatusPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-status', FleetStatusPanel);


/** MACRO */
//Widget
import MacrosWidget from './macros/components/widgets/MacrosWidget.svelte';
import MacrosHeader from './macros/components/widgets/MacrosHeader.svelte';
defineMpuElement('mpu-widgets-macros', MacrosWidget);
defineMpuElement('mpu-widgets-macros-header', MacrosHeader);

// Quick access chip
import MacroChip from './macros/components/chips/MacroChip.svelte';
import MacroChipPicker from './macros/components/chips/MacroChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-macro', MacroChip);
defineMpuElement('mpu-core-widgets-chip-macro-picker', MacroChipPicker);


/** TOOLS */
//Widget
import ToolsWidget from './tools/components/widgets/ToolsWidget.svelte';
import ToolsHeader from './tools/components/widgets/ToolsHeader.svelte';
defineMpuElement('mpu-widgets-tools', ToolsWidget);
defineMpuElement('mpu-widgets-tools-header', ToolsHeader);

// Quick access chip
import TuningChip from './tools/components/chips/TuningChip.svelte';
import TuningChipPicker from './tools/components/chips/TuningChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-tuning', TuningChip);
defineMpuElement('mpu-core-widgets-chip-tuning-picker', TuningChipPicker);

// Fleet
import FleetPositionPanel from './tools/components/fleet/PositionPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-position', FleetPositionPanel);


/** LIMITS */
//Widget
import LimitsWidget from './limits/LimitsWidget.svelte';
defineMpuElement('mpu-widgets-limits', LimitsWidget);


/** OUTPUTS */
//Widget
import OutputsWidget from './outputs/components/widgets/OutputsWidget.svelte';
defineMpuElement('mpu-widgets-outputs', OutputsWidget);

// Quick access chip
import OutputChip from './outputs/components/chips/OutputChip.svelte';
import OutputChipPicker from './outputs/components/chips/OutputChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-output', OutputChip);
defineMpuElement('mpu-core-widgets-chip-output-picker', OutputChipPicker);


/** CAMERA */
//Widget
import CameraWidget from './camera/components/widgets/CameraWidget.svelte';
import CameraHeader from './camera/components/widgets/CameraHeader.svelte';
defineMpuElement('mpu-widgets-camera', CameraWidget);
defineMpuElement('mpu-widgets-camera-header', CameraHeader);
import FleetCameraPanel from './camera/components/fleet/CameraPanel.svelte';
defineMpuElement('mpu-core-widgets-fleet-camera', FleetCameraPanel);


/** FILAMENT SENSORS */
//Widget
import FilamentWidget from './filament-sensors/components/widgets/FilamentWidget.svelte';
defineMpuElement('mpu-widgets-filament', FilamentWidget);

// Quick access chip
import FilamentChip from './filament-sensors/components/chips/FilamentChip.svelte';
import FilamentChipPicker from './filament-sensors/components/chips/FilamentChipPicker.svelte';
defineMpuElement('mpu-core-widgets-chip-filament', FilamentChip);
defineMpuElement('mpu-core-widgets-chip-filament-picker', FilamentChipPicker);


/** JOBS QUEUE */
//Widget
import JobQueueWidget from './job-queue/JobQueueWidget.svelte';
defineMpuElement('mpu-widgets-job-queue', JobQueueWidget);