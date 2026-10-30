# G-Codes

This document describes the commands that Klipper supports. These are
commands that one may enter into the OctoPrint terminal tab.

## G-Code commands

Klipper supports the following standard G-Code commands:
- Move (G0 or G1): `G1 [X<pos>] [Y<pos>] [Z<pos>] [E<pos>] [F<speed>]`
- Dwell: `G4 P<milliseconds>`
- Move to origin: `G28 [X] [Y] [Z]`
- Turn off motors: `M18` or `M84`
- Wait for current moves to finish: `M400`
- Use absolute/relative coordinates: `G90`, `G91`
- Force relative distances for extrusion: `M83`, `M82`
  - Note: `M83` forces extrusions to use relative coordinates even if
    `G90` absolute mode is selected. `M82` disables that forced mode
    (it does not force the extruder to use absolute coordinates).
- Set position: `G92 [X<pos>] [Y<pos>] [Z<pos>] [E<pos>]`
- Set speed factor override percentage: `M220 S<percent>`
- Set extrude factor override percentage: `M221 S<percent>`
- Set acceleration: `M204 S<value>` OR `M204 P<value> T<value>`
  - Note: If S is not specified and both P and T are specified, then
    the acceleration is set to the minimum of P and T. If only one of
    P or T is specified, the command has no effect.
- Get extruder temperature: `M105`
- Set extruder temperature: `M104 [T<index>] [S<temperature>]`
- Set extruder temperature and wait: `M109 [T<index>] S<temperature>`
  - Note: M109 always waits for temperature to settle at requested
    value
- Set bed temperature: `M140 [S<temperature>]`
- Set bed temperature and wait: `M190 S<temperature>`
  - Note: M190 always waits for temperature to settle at requested
    value
- Set fan speed: `M106 S<value>`
- Turn fan off: `M107`
- Emergency stop: `M112`
- Get current position: `M114`
- Get firmware version: `M115`

For further details on the above commands see the
[RepRap G-Code documentation](http://reprap.org/wiki/G-code).

Klipper's goal is to support the G-Code commands produced by common
3rd party software (eg, OctoPrint, Printrun, Slic3r, Cura, etc.) in
their standard configurations. It is not a goal to support every
possible G-Code command. Instead, Klipper prefers human readable
["extended G-Code commands"](#additional-commands). Similarly, the
G-Code terminal output is only intended to be human readable - see the
[API Server document](API_Server.md) if controlling Klipper from
external software.

If one requires a less common G-Code command then it may be possible
to implement it with a custom
[gcode_macro config section](Config_Reference.md#gcode_macro). For
example, one might use this to implement: `G12`, `G29`, `G30`, `G31`,
`M42`, `M80`, `M81`, `T1`, etc.

## Additional Commands

Klipper uses "extended" G-Code commands for general configuration and
status. These extended commands all follow a similar format - they
start with a command name and may be followed by one or more
parameters. For example: `SET_SERVO SERVO=myservo ANGLE=5.3`. In this
document, the commands and parameters are shown in uppercase, however
they are not case sensitive. (So, "SET_SERVO" and "set_servo" both run
the same command.)

This section is organized by Klipper module name, which generally
follows the section names specified in the
[printer configuration file](Config_Reference.md). Note that some
modules are automatically loaded.

### [adxl345]

The following commands are available when an
[adxl345 config section](Config_Reference.md#adxl345) is enabled.

#### ACCELEROMETER_MEASURE
`ACCELEROMETER_MEASURE [CHIP=<config_name>] [NAME=<value>]`: Starts
accelerometer measurements at the requested number of samples per
second. If CHIP is not specified it defaults to "adxl345". The command
works in a start-stop mode: when executed for the first time, it
starts the measurements, next execution stops them. The results of
measurements are written to a file named
`/tmp/adxl345-<chip>-<name>.csv` where `<chip>` is the name of the
accelerometer chip (`my_chip_name` from `[adxl345 my_chip_name]`) and
`<name>` is the optional NAME parameter. If NAME is not specified it
defaults to the current time in "YYYYMMDD_HHMMSS" format. If the
accelerometer does not have a name in its config section (simply
`[adxl345]`) then `<chip>` part of the name is not generated.

#### ACCELEROMETER_QUERY
`ACCELEROMETER_QUERY [CHIP=<config_name>] [RATE=<value>]`: queries
accelerometer for the current value. If CHIP is not specified it
defaults to "adxl345". If RATE is not specified, the default value is
used. This command is useful to test the connection to the ADXL345
accelerometer: one of the returned values should be a free-fall
acceleration (+/- some noise of the chip).

#### ACCELEROMETER_DEBUG_READ
`ACCELEROMETER_DEBUG_READ [CHIP=<config_name>] REG=<register>`:
queries ADXL345 register "register" (e.g. 44 or 0x2C). Can be useful
for debugging purposes.

#### ACCELEROMETER_DEBUG_WRITE
`ACCELEROMETER_DEBUG_WRITE [CHIP=<config_name>] REG=<register>
VAL=<value>`: Writes raw "value" into a register "register". Both
"value" and "register" can be a decimal or a hexadecimal integer. Use
with care, and refer to ADXL345 data sheet for the reference.

### [bed_mesh]

The following commands are available when the
[bed_mesh config section](Config_Reference.md#bed_mesh) is enabled
(also see the [bed mesh guide](Bed_Mesh.md)).

#### BED_MESH_CALIBRATE
`BED_MESH_CALIBRATE [PROFILE=<name>] [METHOD=manual] [HORIZONTAL_MOVE_Z=<value>]
[<probe_parameter>=<value>] [<mesh_parameter>=<value>] [ADAPTIVE=1]
[ADAPTIVE_MARGIN=<value>]`: This command probes the bed using generated points
specified by the parameters in the config. After probing, a mesh is generated
and z-movement is adjusted according to the mesh.
The mesh is immediately active after successful completion of `BED_MESH_CALIBRATE`.
The mesh will be saved into a profile specified by the `PROFILE` parameter,
or `default` if unspecified. If ADAPTIVE=1 is specified then the profile
name will begin with `adaptive-` and should not be saved for reuse.
See the PROBE command for details on the optional probe parameters. If
METHOD=manual is specified then the manual probing tool is activated - see the
MANUAL_PROBE command above for details on the additional commands available
while this tool is active. The optional `HORIZONTAL_MOVE_Z` value overrides the
`horizontal_move_z` option specified in the config file. If ADAPTIVE=1 is
specified then the objects defined by the Gcode file being printed will be used
to define the probed area. The optional `ADAPTIVE_MARGIN` value overrides the
`adaptive_margin` option specified in the config file.

#### BED_MESH_OUTPUT
`BED_MESH_OUTPUT PGP=[<0:1>]`: This command outputs the current probed
z values and current mesh values to the terminal.  If PGP=1 is
specified the X, Y coordinates generated by bed_mesh, along with their
associated indices, will be output to the terminal.

#### BED_MESH_MAP
`BED_MESH_MAP`: Like to BED_MESH_OUTPUT, this command prints the
current state of the mesh to the terminal.  Instead of printing the
values in a human readable format, the state is serialized in json
format. This allows octoprint plugins to easily capture the data and
generate height maps approximating the bed's surface.

#### BED_MESH_CLEAR
`BED_MESH_CLEAR`: This command clears the mesh and removes all z
adjustment.  It is recommended to put this in your end-gcode.

#### BED_MESH_PROFILE
`BED_MESH_PROFILE LOAD=<name> SAVE=<name> REMOVE=<name>`: This command
provides profile management for mesh state. LOAD will restore the mesh
state from the profile matching the supplied name. SAVE will save the
current mesh state to a profile matching the supplied name. Remove
will delete the profile matching the supplied name from persistent
memory. Note that after SAVE or REMOVE operations have been run the
SAVE_CONFIG gcode must be run to make the changes to persistent memory
permanent.

#### BED_MESH_OFFSET
`BED_MESH_OFFSET [X=<value>] [Y=<value>] [ZFADE=<value]`: Applies X, Y,
and/or ZFADE offsets to the mesh lookup. This is useful for printers with
independent extruders, as an offset is necessary to produce correct Z
adjustment after a tool change.  Note that a ZFADE offset does not apply
additional z-adjustment directly, it is used to correct the `fade`
calculation when a `gcode offset` has been applied to the Z axis.

### [dual_carriage]

The following command is available when the
[dual_carriage config section](Config_Reference.md#dual_carriage) is
enabled.

#### SET_DUAL_CARRIAGE
`SET_DUAL_CARRIAGE CARRIAGE=<carriage> [MODE=[PRIMARY|COPY|MIRROR|INACTIVE]]`:
This command will change the mode of the specified carriage.
If no `MODE` is provided it defaults to `PRIMARY`. `<carriage>` must
reference a defined primary or dual carriage for `generic_cartesian`
kinematics or be 0 (for primary carriage) or 1 (for dual carriage)
for all other kinematics supporting IDEX. Setting the mode to `PRIMARY`
deactivates all other carriages on the same axis and makes the specified
carriage execute subsequent G-Code movement commands as-is. Before activating
`COPY` or `MIRROR` mode for a carriage, a different one must be activated as
`PRIMARY` on the same axis. When set to either of these two modes, the carriage
will track the subsequent G-Code moves and either copy relative movements
(in `COPY` mode) or execute them in the opposite (mirror) direction (in
`MIRROR` mode). Setting the mode to `INACTIVE` deactivates the carriage and
makes it ignore further G-Code moves. Note that deactivating the primary
carriage on the axis does not disable other carriages working in `COPY` or
`MIRROR` mode, which can be used to disable printing a failed part by any of
the tools and park that tool to prevent collisions with an unfinished part, see
this [sample configuration](../config/sample-corexyuv.cfg) for macros examples.


#### SAVE_DUAL_CARRIAGE_STATE
`SAVE_DUAL_CARRIAGE_STATE [NAME=<state_name>]`: Save the current positions
of the dual carriages and their modes. Saving and restoring DUAL_CARRIAGE
state can be useful in scripts and macros, as well as in homing routine
overrides. If NAME is provided it allows one to name the saved state
to the given string. If NAME is not provided it defaults to "default".

#### RESTORE_DUAL_CARRIAGE_STATE
`RESTORE_DUAL_CARRIAGE_STATE [NAME=<state_name>] [MOVE=[0|1] [MOVE_SPEED=<speed>]]`:
Restore the previously saved states of all dual and their primary carriages.
This command restores the modes of the carriages and moves them to their
previously saved positions, unless "MOVE=0" is specified. If positions are being
restored and "MOVE_SPEED" is specified, then the carriages will move with at
most the provided speed (in mm/s); otherwise the homing speeds of the
corresponding carriages will be used as a reference. Note that the carriages
restore their positions only over their own axes, which may be necessary to
correctly restore COPY and MIRROR mode of the dual carriage. In addition, this
command updates the Klipper toolhead position for each axis that has some dual
carriages: it is set to match the actual position of the activated primary
carriage of an axis or, if an axis does not have a saved primary carriage,
to the axis position when `SAVE_DUAL_CARRIAGE_STATE` command was called.

### [exclude_object]

The following commands are available when an
[exclude_object config section](Config_Reference.md#exclude_object) is
enabled (also see the [exclude object guide](Exclude_Object.md)):

#### `EXCLUDE_OBJECT`
`EXCLUDE_OBJECT [NAME=object_name] [CURRENT=1] [RESET=1]`:
With no parameters, this will return a list of all currently excluded objects.

When the `NAME` parameter is given, the named object will be excluded from
printing.

When the `CURRENT` parameter is given, the current object will be excluded from
printing.

When the `RESET` parameter is given, the list of excluded objects will be
cleared. Additionally including `NAME` will only reset the named object. This
**can** cause print failures, if layers were already skipped.

#### `EXCLUDE_OBJECT_DEFINE`
`EXCLUDE_OBJECT_DEFINE [NAME=object_name [CENTER=X,Y] [POLYGON=[[x,y],...]]
[RESET=1] [JSON=1]`:
Provides a summary of an object in the file.

With no parameters provided, this will list the defined objects known to
Klipper. Returns a list of strings, unless the `JSON` parameter is given,
when it will return object details in json format.

When the `NAME` parameter is included, this defines an object to be excluded.

  - `NAME`: This parameter is required.  It is the identifier used by other
    commands in this module.
  - `CENTER`: An X,Y coordinate for the object.
  - `POLYGON`: An array of X,Y coordinates that provide an outline for the
    object.

When the `RESET` parameter is provided, all defined objects will be cleared, and
the `[exclude_object]` module will be reset.

#### `EXCLUDE_OBJECT_START`
`EXCLUDE_OBJECT_START NAME=object_name`:
This command takes a `NAME` parameter and denotes the start of the gcode for an
object on the current layer.

#### `EXCLUDE_OBJECT_END`
`EXCLUDE_OBJECT_END [NAME=object_name]`:
Denotes the end of the object's gcode for the layer. It is paired with
`EXCLUDE_OBJECT_START`. A `NAME` parameter is optional, and will only warn when
the provided name does not match the current object.

### [extruder]

The following commands are available if an
[extruder config section](Config_Reference.md#extruder) is enabled:

#### ACTIVATE_EXTRUDER
`ACTIVATE_EXTRUDER EXTRUDER=<config_name>`: In a printer with multiple
[extruder](Config_Reference.md#extruder) config sections, this command
changes the active hotend.

#### SET_PRESSURE_ADVANCE
`SET_PRESSURE_ADVANCE [EXTRUDER=<config_name>]
[ADVANCE=<pressure_advance>]
[SMOOTH_TIME=<pressure_advance_smooth_time>]`: Set pressure advance
parameters of an extruder stepper (as defined in an
[extruder](Config_Reference.md#extruder) or
[extruder_stepper](Config_Reference.md#extruder_stepper) config section).
If EXTRUDER is not specified, it defaults to the stepper defined in
the active hotend.

#### SET_EXTRUDER_ROTATION_DISTANCE
`SET_EXTRUDER_ROTATION_DISTANCE EXTRUDER=<config_name>
[DISTANCE=<distance>]`: Set a new value for the provided extruder
stepper's "rotation distance" (as defined in an
[extruder](Config_Reference.md#extruder) or
[extruder_stepper](Config_Reference.md#extruder_stepper) config section).
If the rotation distance is a negative number then the stepper motion
will be inverted (relative to the stepper direction specified in the
config file). Changed settings are not retained on Klipper reset. Use
with caution as small changes can result in excessive pressure between
extruder and hotend. Do proper calibration with filament before use.
If 'DISTANCE' value is not provided then this command will return the
current rotation distance.

#### SYNC_EXTRUDER_MOTION
`SYNC_EXTRUDER_MOTION EXTRUDER=<name> MOTION_QUEUE=<name>`: This
command will cause the stepper specified by EXTRUDER (as defined in an
[extruder](Config_Reference.md#extruder) or
[extruder_stepper](Config_Reference.md#extruder_stepper) config section)
to become synchronized to the movement of an extruder specified by
MOTION_QUEUE (as defined in an [extruder](Config_Reference.md#extruder)
config section). If MOTION_QUEUE is an empty string then the stepper
will be desynchronized from all extruder movement.

### [fan_generic]

The following command is available when a
[fan_generic config section](Config_Reference.md#fan_generic) is
enabled.

#### SET_FAN_SPEED
`SET_FAN_SPEED FAN=config_name SPEED=<speed>` This command sets the
speed of a fan. "speed" must be between 0.0 and 1.0.

`SET_FAN_SPEED FAN=config_name TEMPLATE=<template_name>
[<param_x>=<literal>]`: If `TEMPLATE` is specified then it assigns a
[display_template](Config_Reference.md#display_template) to the given
fan. For example, if one defined a `[display_template
my_fan_template]` config section then one could assign
`TEMPLATE=my_fan_template` here. The display_template should produce a
string containing a floating point number with the desired value. The
template will be continuously evaluated and the fan will be
automatically set to the resulting speed. One may set display_template
parameters to use during template evaluation (parameters will be
parsed as Python literals). If TEMPLATE is an empty string then this
command will clear any previous template assigned to the pin (one can
then use `SET_FAN_SPEED` commands to manage the values directly).

### [filament_switch_sensor]

The following command is available when a
[filament_switch_sensor](Config_Reference.md#filament_switch_sensor)
or
[filament_motion_sensor](Config_Reference.md#filament_motion_sensor)
config section is enabled.

#### QUERY_FILAMENT_SENSOR
`QUERY_FILAMENT_SENSOR SENSOR=<sensor_name>`: Queries the current
status of the filament sensor. The data displayed on the terminal will
depend on the sensor type defined in the configuration.

#### SET_FILAMENT_SENSOR
`SET_FILAMENT_SENSOR SENSOR=<sensor_name> ENABLE=[0|1]`: Sets the
filament sensor on/off. If ENABLE is set to 0, the filament sensor
will be disabled, if set to 1 it is enabled.

### [gcode_move]

The gcode_move module is automatically loaded.

#### GET_POSITION
`GET_POSITION`: Return information on the current location of the
toolhead. See the developer documentation of
[GET_POSITION output](Code_Overview.md#coordinate-systems) for more
information.

#### SET_GCODE_OFFSET
`SET_GCODE_OFFSET [X=<pos>|X_ADJUST=<adjust>]
[Y=<pos>|Y_ADJUST=<adjust>] [Z=<pos>|Z_ADJUST=<adjust>] [MOVE=1
[MOVE_SPEED=<speed>]]`: Set a positional offset to apply to future
G-Code commands. This is commonly used to virtually change the Z bed
offset or to set nozzle XY offsets when switching extruders. For
example, if "SET_GCODE_OFFSET Z=0.2" is sent, then future G-Code moves
will have 0.2mm added to their Z height. If the X_ADJUST style
parameters are used, then the adjustment will be added to any existing
offset (eg, "SET_GCODE_OFFSET Z=-0.2" followed by "SET_GCODE_OFFSET
Z_ADJUST=0.3" would result in a total Z offset of 0.1). If "MOVE=1" is
specified then a toolhead move will be issued to apply the given
offset (otherwise the offset will take effect on the next absolute
G-Code move that specifies the given axis). If "MOVE_SPEED" is
specified then the toolhead move will be performed with the given
speed (in mm/s); otherwise the toolhead move will use the last
specified G-Code speed.

#### SAVE_GCODE_STATE
`SAVE_GCODE_STATE [NAME=<state_name>]`: Save the current g-code
coordinate parsing state. Saving and restoring the g-code state is
useful in scripts and macros. This command saves the current g-code
absolute coordinate mode (G90/G91), force relative extrude mode
(M83/M82), origin (G92), offset (SET_GCODE_OFFSET), speed override
(M220), extruder override (M221), move speed, current XYZ position,
and relative extruder "E" position. If NAME is provided it allows one
to name the saved state to the given string. If NAME is not provided
it defaults to "default".

#### RESTORE_GCODE_STATE
`RESTORE_GCODE_STATE [NAME=<state_name>] [MOVE=1
[MOVE_SPEED=<speed>]]`: Restore a state previously saved via
SAVE_GCODE_STATE. If "MOVE=1" is specified then a toolhead move will
be issued to move back to the previous XYZ position. If "MOVE_SPEED"
is specified then the toolhead move will be performed with the given
speed (in mm/s); otherwise the toolhead move will use the restored

### [manual_stepper]

The following command is available when a
[manual_stepper config section](Config_Reference.md#manual_stepper) is
enabled.

#### MANUAL_STEPPER
`MANUAL_STEPPER STEPPER=config_name [ENABLE=[0|1]]
[SET_POSITION=<pos>] [SPEED=<speed>] [ACCEL=<accel>] [MOVE=<pos>]
[SYNC=0]]`: This command will alter the state of the stepper. Use the
ENABLE parameter to enable/disable the stepper. Use the SET_POSITION
parameter to force the stepper to think it is at the given
position. Use the MOVE parameter to request a movement to the given
position. If SPEED and/or ACCEL is specified then the given values
will be used instead of the defaults specified in the config file. If
an ACCEL of zero is specified then no acceleration will be
performed. Normally future G-Code commands will be scheduled to run
after the stepper move completes, however if a manual stepper move
uses SYNC=0 then future G-Code movement commands may run in parallel
with the stepper movement.

`MANUAL_STEPPER STEPPER=config_name [SPEED=<speed>] [ACCEL=<accel>]
MOVE=<pos> STOP_ON_ENDSTOP=<check_type>`: If STOP_ON_ENDSTOP is
specified then the move will end early if an endstop event occurs. The
`STOP_ON_ENDSTOP` parameter may be set to one of the following values:

* `probe`: The movement will stop when the endstop reports triggered.
* `home`: The movement will stop when the endstop reports triggered
  and the final position of the manual_stepper will be set such that

### [output_pin]

The following command is available when an
[output_pin config section](Config_Reference.md#output_pin) or
[pwm_tool config section](Config_Reference.md#pwm_tool) is
enabled.

#### SET_PIN
`SET_PIN PIN=config_name VALUE=<value>`: Set the pin to the given
output `VALUE`. VALUE should be 0 or 1 for "digital" output pins. For
PWM pins, set to a value between 0.0 and 1.0, or between 0.0 and
`scale` if a scale is configured in the output_pin config section.

`SET_PIN PIN=config_name TEMPLATE=<template_name> [<param_x>=<literal>]`:
If `TEMPLATE` is specified then it assigns a
[display_template](Config_Reference.md#display_template) to the given
pin. For example, if one defined a `[display_template
my_pin_template]` config section then one could assign
`TEMPLATE=my_pin_template` here. The display_template should produce a
string containing a floating point number with the desired value. The
template will be continuously evaluated and the pin will be
automatically set to the resulting value. One may set display_template
parameters to use during template evaluation (parameters will be
parsed as Python literals). If TEMPLATE is an empty string then this
command will clear any previous template assigned to the pin (one can
then use `SET_PIN` commands to manage the values directly).

### [palette2]

### [probe]

The following commands are available when a
[probe config section](Config_Reference.md#probe) or
[bltouch config section](Config_Reference.md#bltouch) is enabled (also
see the [probe calibrate guide](Probe_Calibrate.md)).

#### PROBE
`PROBE [PROBE_SPEED=<mm/s>] [LIFT_SPEED=<mm/s>] [SAMPLES=<count>]
[SAMPLE_RETRACT_DIST=<mm>] [SAMPLES_TOLERANCE=<mm>]
[SAMPLES_TOLERANCE_RETRIES=<count>] [SAMPLES_RESULT=median|average]`:
Move the nozzle downwards until the probe triggers. If any of the
optional parameters are provided they override their equivalent
setting in the [probe config section](Config_Reference.md#probe).

#### QUERY_PROBE
`QUERY_PROBE`: Report the current status of the probe ("triggered" or
"open").

#### PROBE_ACCURACY
`PROBE_ACCURACY [PROBE_SPEED=<mm/s>] [SAMPLES=<count>]
[SAMPLE_RETRACT_DIST=<mm>]`: Calculate the maximum, minimum, average,
median, and standard deviation of multiple probe samples. By default,
10 SAMPLES are taken. Otherwise the optional parameters default to
their equivalent setting in the probe config section.

#### PROBE_CALIBRATE
`PROBE_CALIBRATE [SPEED=<speed>] [<probe_parameter>=<value>]`: Run a
helper script useful for calibrating the probe's z_offset. See the
PROBE command for details on the optional probe parameters. See the
MANUAL_PROBE command for details on the SPEED parameter and the

### [pwm_cycle_time]

The following command is available when a
[pwm_cycle_time config section](Config_Reference.md#pwm_cycle_time)
is enabled.

#### SET_PIN
`SET_PIN PIN=config_name VALUE=<value> [CYCLE_TIME=<cycle_time>]`:
This command works similarly to [output_pin](#output_pin) SET_PIN
commands. The command here supports setting an explicit cycle time
using the CYCLE_TIME parameter (specified in seconds). Note that the
CYCLE_TIME parameter is not stored between SET_PIN commands (any

### [respond]

The following standard G-Code commands are available when the
[respond config section](Config_Reference.md#respond) is enabled:
- `M118 <message>`: echo the message prepended with the configured
  default prefix (or `echo: ` if no prefix is configured).

The following additional commands are also available.

#### RESPOND
- `RESPOND MSG="<message>"`: echo the message prepended with the
  configured default prefix (or `echo: ` if no prefix is configured).
- `RESPOND TYPE=echo MSG="<message>"`: echo the message prepended with
  `echo: `.
- `RESPOND TYPE=echo_no_space MSG="<message>"`: echo the message prepended with
  `echo:` without a space between prefix and message, helpful for compatibility with some octoprint plugins that expect very specific formatting.
- `RESPOND TYPE=command MSG="<message>"`: echo the message prepended
  with `// `.  OctoPrint can be configured to respond to these messages
  (e.g.  `RESPOND TYPE=command MSG=action:pause`).
- `RESPOND TYPE=error MSG="<message>"`: echo the message prepended
  with `!! `.
- `RESPOND PREFIX=<prefix> MSG="<message>"`: echo the message
  prepended with `<prefix>`. (The `PREFIX` parameter will take
  priority over the `TYPE` parameter)

### [save_variables]

The following command is enabled if a
[save_variables config section](Config_Reference.md#save_variables)
has been enabled.

### [temperature_probe]

The following commands are available when a
[temperature_probe config section](Config_Reference.md#temperature_probe)
is enabled.

#### TEMPERATURE_PROBE_CALIBRATE
`TEMPERATURE_PROBE_CALIBRATE [PROBE=<probe name>] [TARGET=<value>] [STEP=<value>]
[MANUAL_METHOD=<method>]`:
Initiates probe drift calibration for eddy current based probes.  The `TARGET`
is a target temperature for the last sample.  When the temperature recorded
during a sample exceeds the `TARGET` calibration will complete.  The `STEP`
parameter sets temperature delta (in C) between samples. After a sample has
been taken, this delta is used to schedule a call to `TEMPERATURE_PROBE_NEXT`.
The default `STEP` is 2. The `METHOD` only supports `tap` as an option,
if specified, probing will be automated.

#### TEMPERATURE_PROBE_NEXT
`TEMPERATURE_PROBE_NEXT`: After calibration has started this command is run to
take the next sample.  It is automatically scheduled to run when the delta
specified by `STEP` has been reached, however its also possible to manually run
this command to force a new sample.  This command is only available during
calibration.

#### TEMPERATURE_PROBE_COMPLETE:
`TEMPERATURE_PROBE_COMPLETE`:  Can be used to end calibration and save the
current result before the `TARGET` temperature is reached.  This command
is only available during calibration.

#### ABORT
`ABORT`:  Aborts the calibration process, discarding the current results.
This command is only available during drift calibration.

### TEMPERATURE_PROBE_ENABLE
`TEMPERATURE_PROBE_ENABLE ENABLE=[0|1]`: Sets temperature drift
compensation on or off. If ENABLE is set to 0, drift compensation
will be disabled, if set to 1 it is enabled.

### [tmcXXXX]

The following commands are available when any of the
