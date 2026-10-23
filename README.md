# ToneBench

A personal workbench for headphone tuning.

ToneBench is a planned desktop tool for exploring headphone frequency response, shaping EQ, and keeping track of listening preferences and audio gear.

## Product direction

The main workspace will compare three curves: a headphone's measured response, a selected target curve, and the predicted response after EQ. Users should be able to start either from an available headphone measurement and generate a first EQ automatically, or import their own measurement and tune from there. Both paths lead to the same editable EQ and curve comparison view.

## Initial workflow

1. Choose a headphone with an available measurement, or import a measurement.
2. Select a target curve and generate or edit parametric EQ.
3. Compare the measured, target, and EQ-predicted curves.
4. Save a personal tuning and export its EQ settings.

Later versions may add listening A/B notes and DAC/amplifier equipment records. Measurement source and conditions should remain visible because fit, seal, and measurement rigs affect frequency-response results.

## Status

Concept stage. The repository currently captures the agreed product direction; implementation choices are still open.
