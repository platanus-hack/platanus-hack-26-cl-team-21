# 0003 — Wi-Fi sensor hub on a second ESP32

## Context

ADR 0001 put the sensors on an Arduino Uno linked to the ESP32-CAM over UART. On the bench the camera board has no free pins for that link once the camera and the microSD are in use, so the Uno can't be connected. The MQ-7 and MQ-2 gas sensors and the event button are also dropped from the prototype, and a CO2 sensor (MH-Z19C) is added.

## Decision

- **The sensor hub is a second AI-Thinker ESP32-CAM without its camera or microSD** (`firmware/sensor-hub-esp32`). It reads the MH-Z19C (UART on IO13/IO14), the DHT11 (IO15) and the KY-037 digital output (IO4), and sends one checksummed line per second over **UDP port 4210** to the pendant camera: broadcast on a shared network, or to the camera directly when it joins the camera's own `OLM-<id>` access point.
- **The line keeps the hub format** `S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<co2_ppm>,<sound_active_pct>,<batt_mv>*HH`. The hub has no RTC: it leaves the epoch empty and **the camera stamps it** with its own clock, which the phone sets with `POST /time` (now applied on the camera directly).
- **`sensors.csv` becomes** `rtc_epoch,uptime_ms,temp_c,rh_pct,co2_ppm,sound_active_pct,batt_mv`. Ingestion maps `co2_ppm` → `co2_ppm` (MH-Z19C) and `sound_active_pct` → `sound_active_pct` (KY-037 digital output); migration 0004 adds both sensor types. The Uno's `co_raw`, `flammable_gas_raw` and `sound_level_raw` types stay for data already stored.
- `sound_active_pct` is the share of each second the KY-037 comparator was above its threshold. It is sound activity, not a level and not dB. The camera board can't read analog inputs on its free pins while Wi-Fi is on (ADC2), which rules out the analog level.

## Consequences

- No wires between the two boards: they only share power. The camera keeps owning the session files, so Android still talks to one device.
- The UART hub path stays in the camera firmware for the Uno, but the Uno is no longer part of the prototype. Buzzer, button, battery measurement and the privacy replay over the link are not implemented on the Wi-Fi hub yet (`batt_mv` is empty, no events).
- Any device on the same network can send lines to the camera's UDP port: acceptable on the demo network, to be authenticated before field use.
- The KY-037 digital output shares IO4 with the camera board's flash LED, which lights while there is sound above the threshold.
