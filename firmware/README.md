# Firmware

| Sketch | Board | FQBN |
|---|---|---|
| `sensor-hub/` | Arduino Uno | `arduino:avr:uno` |
| `pendant-cam/` | AI-Thinker ESP32-CAM (flashed through the ESP32-CAM-MB board) | `esp32:esp32:esp32cam` |

Wiring, the UART protocol, the SD layout and the HTTP API are in [`../hardware/README.md`](../hardware/README.md).

> **Status:** first draft, **not compiled yet**. Expect small fixes on the first build.

## Setup (arduino-cli)

```bash
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install arduino:avr esp32:esp32
arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor" "RTClib"
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
- Camera: the serial log prints its IP, then `curl http://<ip>/status`, `curl -X POST "http://<ip>/capture/start?protocol=eating-v1"`, then `curl http://<ip>/sessions`.
- `secrets.h` is git-ignored; never commit Wi-Fi credentials.
