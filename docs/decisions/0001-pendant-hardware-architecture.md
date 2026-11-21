# 0001 — Pendant hardware architecture (v0)

**Status:** proposed · **Owner:** Alendi · **Date:** 2026-11-21

## Context

Available parts: ESP32-CAM, Arduino Uno, DHT11, MQ-7, MQ-2, KY-037, RTC, buzzer, button, mini switch, LM2596, 2S Li-ion battery, 64 GB microSD. The ESP32-CAM has almost no free GPIOs once camera and SD are used; the Uno is too big for a pendant; the MQ heaters are hot and power-hungry.

## Decision

1. **Split device:** a camera pendant (ESP32-CAM) and a body-worn hub (Uno + sensors + battery), joined by a 5-wire cable.
2. **The Uno is the sensor hub and owns the master clock (RTC).** It streams checksummed ASCII lines to the ESP32-CAM over UART.
3. **JPEG frames at 2 fps plus a timestamp index** on the microSD, instead of video. The worker builds the MP4 with ffmpeg.
4. **No audio recording.** The device records relative sound level only.
5. **Wi-Fi HTTP API for v0** (status, time sync, capture control, file download). BLE is a stretch goal.
6. **The privacy switch physically cuts the pendant's power.** The hub logs the interval, which becomes a `privacy_switch` coverage gap.

## Consequences

- Android talks to the device over HTTP on the phone hotspot, not BLE.
- Timestamps are accurate to about ±1 s (RTC resolution). That's enough for eating episodes.
- Gas and sound readings are relative indicators only. There is no IMU, so wear detection relies on image quality.
- Details: `hardware/README.md`.
