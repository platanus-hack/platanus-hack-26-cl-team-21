# 0001 — Prototype hardware architecture (v0)

**Status:** proposed · **Owner:** Alendi · **Date:** 2026-11-21

## Context

Available parts: ESP32-CAM, Arduino Uno, DHT11, MQ-7, MQ-2, KY-037, RTC, buzzer, button, mini switch, LM2596, 2S Li-ion battery, 64 GB microSD. The ESP32-CAM has almost no free GPIOs once camera and SD are used; the MQ heaters are hot and power-hungry. Size and power only constrain the prototype; a production version would be a custom pendant.

## Decision

1. **Single chest-worn box** containing the ESP32-CAM (camera module) and the Uno (sensor hub).
2. **The Uno is the sensor hub and owns the master clock (RTC).** It streams checksummed ASCII lines to the ESP32-CAM over UART.
3. **JPEG frames at 2 fps plus a timestamp index** on the microSD, instead of video. The worker builds the MP4 with ffmpeg.
4. **No audio recording on the device yet.** The KY-037 and the loose electret capsule need a preamp, a continuously sampling ADC and storage, which the current boards can't provide together. The device records relative sound level; the audio proof of concept is still open (`hardware/README.md` §2). The phone microphone is ruled out because it breaks standardization.
5. **HTTP API on the local network for v0** (status, time sync, capture control, file download). The device joins known networks or opens its own AP, requires a bearer token and never talks to the internet. BLE is a stretch goal.
6. **The privacy switch physically cuts the camera's power.** The hub logs the interval, which becomes a `privacy_switch` coverage gap.

## Consequences

- Android talks to the device over HTTP on the local network, not BLE.
- Timestamps are accurate to about ±1 s (RTC resolution). That's enough for eating episodes.
- The 260 mAh battery lasts ~18 min with everything on: bench work and the demo use a USB power bank on the 5 V rail.
- Gas and sound readings are relative indicators only. There is no IMU, so wear detection relies on image quality.
- Details: `hardware/README.md`.
