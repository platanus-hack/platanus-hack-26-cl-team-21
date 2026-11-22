# Firmware

| Sketch | Board | FQBN |
|---|---|---|
| `pendant-cam/` | AI-Thinker ESP32-CAM (flashed through the ESP32-CAM-MB board) | `esp32:esp32:esp32cam` |
| `sensor-hub-esp32/` | AI-Thinker ESP32-CAM without camera or microSD (sensor hub, ADR 0003) | `esp32:esp32:esp32cam` |
| `sensor-hub/` | Arduino Uno (retired by ADR 0003, kept for reference) | `arduino:avr:uno` |

Wiring, the hub line format, the SD layout and the HTTP API are in [`../hardware/README.md`](../hardware/README.md).

> **Status:** tested on the bench: the camera and the ESP32 hub on a phone hotspot recorded a session with frames and sensor rows stamped by the camera clock.

## Setup (arduino-cli)

```bash
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install arduino:avr esp32:esp32
arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor" "Rtc by Makuna"   # Rtc only for the Uno
```

Arduino IDE works too: install the same cores and libraries from the Boards and Library managers.

## Build and flash

```bash
# ESP32 sensor hub (same networks as the camera, plus the camera's OLM-<id> access point)
cp firmware/sensor-hub-esp32/secrets.example.h firmware/sensor-hub-esp32/secrets.h   # fill in Wi-Fi
arduino-cli compile --fqbn esp32:esp32:esp32cam firmware/sensor-hub-esp32
arduino-cli upload  --fqbn esp32:esp32:esp32cam -p /dev/cu.usbserial-* firmware/sensor-hub-esp32

# Sensor hub (disconnect the buck's 5 V from the Uno while on USB)
arduino-cli compile --fqbn arduino:avr:uno firmware/sensor-hub
arduino-cli upload  --fqbn arduino:avr:uno -p /dev/cu.usbmodem* firmware/sensor-hub
arduino-cli monitor -p /dev/cu.usbmodem* -c baudrate=115200

# Pendant camera
cp firmware/pendant-cam/secrets.example.h firmware/pendant-cam/secrets.h   # fill in Wi-Fi
arduino-cli compile --fqbn esp32:esp32:esp32cam firmware/pendant-cam
arduino-cli upload  --fqbn esp32:esp32:esp32cam -p /dev/cu.usbserial-* firmware/pendant-cam
arduino-cli monitor -p /dev/cu.usbserial-* -c baudrate=115200
```

## Quick checks

- ESP32 hub on USB: one `S,,<uptime_ms>,<temp_c>,<rh_pct>,<co2_ppm>,<sound_active_pct>,*HH` line per second. `co2_ppm` stays empty for the MH-Z19C's 3 min warm-up. The camera's `/status` shows the same line in `last_sensor_line`, with the epoch filled in once `/time` was called.
- The hub board is wired through the ESP32-CAM-MB with Dupont wires (each pin to its own breadboard row, then on to the adapter), so the adapter still flashes it automatically.
- Camera: the serial log prints the network and IP. Then:
  ```bash
  T="Authorization: Bearer <API_TOKEN>"
  curl -H "$T" http://olm-<id>.local/status
  curl -H "$T" -X POST "http://olm-<id>.local/time?epoch=$(date +%s)"
  curl -H "$T" -X POST "http://olm-<id>.local/capture/start?protocol=eating-v1"
  curl -H "$T" http://olm-<id>.local/sessions
  ```
- Config flags at the top of `sensor-hub.ino`: `BUZZER_PASSIVE` (0 for the TMB12A05) and `BATT_CELLS` (2 for the two cells in series; 1 for a single cell). The RTC is a DS1302 on D10–D12.
- The DS1302 starts with an invalid date: sync it once (`/time`) before the first session, or the frames carry no epoch.
- `secrets.h` is git-ignored; never commit Wi-Fi credentials.
