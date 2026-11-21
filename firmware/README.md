# Firmware

| Sketch | Board | FQBN |
|---|---|---|
| `sensor-hub/` | Arduino Uno | `arduino:avr:uno` |
| `pendant-cam/` | AI-Thinker ESP32-CAM (flashed through the ESP32-CAM-MB board) | `esp32:esp32:esp32cam` |

Wiring, the UART protocol, the SD layout and the HTTP API are in [`../hardware/README.md`](../hardware/README.md).

> **Status:** both sketches compile (arduino-cli 1.6, esp32 core 4.0.0, arduino:avr). **Not tested on hardware yet.**

## Setup (arduino-cli)

```bash
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install arduino:avr esp32:esp32
arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor" "Rtc by Makuna"
```

Arduino IDE works too: install the same cores and libraries from the Boards and Library managers.

## Build and flash

```bash
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

- Hub on USB: one `S,...*HH` line per second; pressing the button prints `E,...,BUTTON`.
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
