# Hardware proposal: pendant + sensor hub (v0)

Owner: Alendi. Status: **proposal**. The firmware in `firmware/` is a first draft that **has not been compiled yet**. Every pin and value below should be verified on the bench before soldering. Open questions are listed in §10.

## 1. Goals for the demo

The prototype must produce, for a scripted eating session:

1. **Timestamped egocentric images** (camera on the chest, facing forward).
2. **Synchronized sensor context**: temperature, humidity, relative sound level, CO and flammable-gas readings (relative), battery voltage.
3. **Explicit non-observed intervals**: privacy switch on, device off, low battery.
4. **Participant markers**: event button presses.
5. **Transfer to the Android app over Wi-Fi**, with nothing leaving the phone before review.

Out of scope for v0: audio recording, calibrated gas concentrations, calibrated dB, IMU-based wear detection, BLE.

## 2. Architecture

The parts list doesn't fit comfortably in one pendant: the Arduino Uno is 68×53 mm, the MQ heaters get hot, and the sensors shouldn't sit next to the participant's breath. We therefore split the device in two, connected by a 5-wire cable (switched 5 V, GND, TX, RX, LED):

```text
 PENDANT (chest, ~45x60 mm)              HUB (belt / arm pack)
 ┌──────────────────────────┐   cable   ┌───────────────────────────────────────┐
 │ ESP32-CAM (OV2640)       │  5V ──────│ LM2596 buck 7.4 V -> 5 V   ◄── battery │
 │  - camera + microSD      │  GND ─────│                                        │
 │  - Wi-Fi (HTTP server)   │  TX/RX ───│ Arduino Uno = sensor hub               │
 │ Recording LED (red)      │  LED ─────│  DHT11, MQ-7, MQ-2, KY-037, RTC        │
 └──────────────────────────┘           │  buzzer, event button, privacy switch  │
                                        │  battery voltage divider               │
                                        └───────────────────────────────────────┘
```

**Division of responsibilities**

| | ESP32-CAM (pendant) | Arduino Uno (hub) |
|---|---|---|
| Owns | camera, microSD, Wi-Fi, session files | sensors, RTC (master clock), buzzer, button, privacy switch, battery measurement |
| Why | the ESP32-CAM has almost no free GPIOs once camera and SD are in use | the Uno has 6 analog inputs and 5 V logic, which the MQ sensors and KY-037 need |

**Why images instead of video.** The ESP32-CAM can't encode H.264. We save **one JPEG per frame (default 2 fps, VGA)** plus a `frames.csv` index with the RTC timestamp of each frame. Benefits:

- Each frame is complete on its own, so a power loss corrupts at most one frame.
- Every frame carries an exact timestamp.
- The worker turns the frames into an MP4 with `ffmpeg` (variable frame rate, using the real timestamps) before the agent runs.
- Bandwidth and SD wear stay low.

**Why there is no audio.** The ESP32-CAM has no usable audio input, and the KY-037 only outputs an analog level. We record **relative sound level only**, which is also the privacy-preserving choice (no intelligible speech). It's worth saying in the pitch.

**Why Wi-Fi instead of BLE for v0.** BLE plus camera together strain the ESP32-CAM's memory, and the Android app would need two transports. In v0 the ESP32-CAM joins the phone's hotspot (or opens its own AP) and exposes a small HTTP API (§7) for status, time sync and file download. BLE is a stretch goal.

## 3. Bill of materials

| Part | Qty | Role | Notes |
|---|---|---|---|
| ESP32-CAM (AI-Thinker, OV2640) + ESP32-CAM-MB programmer | 1 | camera, SD, Wi-Fi | The MB board is only for flashing/USB serial; in the pendant it's powered via the 5V pin |
| Arduino Uno | 1 | sensor hub | Powered at its **5V pin** from the buck (bypasses the onboard regulator) |
| microSD 64 GB | 1 | storage | **Format FAT32** (64 GB cards ship as exFAT; the ESP32 SD library needs FAT32) |
| DHT11 | 1 | temperature / humidity | ±2 °C, ±5 % RH, ≤1 Hz; keep it away from the MQ heaters and the body |
| MQ-7 module | 1 | CO (relative) | Used at constant 5 V: **relative readings only** (see §8) |
| MQ-2 module | 1 | flammable gases / smoke (relative) | ~150 mA heater, 20 s–few min warm-up |
| KY-037 | 1 | sound level (relative) | Analog output; we compute peak-to-peak over 50 ms windows |
| RTC module (DS3231 assumed) | 1 | master clock | I²C; keeps time with its coin cell. If it turns out to be a DS1302, see §10 |
| Buzzer | 1 | local notifications | Active or passive: set `BUZZER_PASSIVE` in firmware |
| Push button | 1 | event marker | To GND, internal pull-up |
| Mini switch | 1 | **privacy switch** | Mounted **on the hub**, between the buck and the cable, so the Uno can sense it. Cuts the pendant's 5 V: camera physically unpowered |
| LM2596 buck module | 1 | 7.4 V → 5 V | **Set to 5.0–5.1 V with a multimeter before connecting anything** |
| 2S Li-ion/LiPo 7.4 V battery | 1 | power | Check capacity (mAh) on the label; see §5 |
| Red LED + 330 Ω | 1 | recording indicator (pendant) | Driven by the Uno, only while ESP32-CAM reports active capture |
| Resistors 10 kΩ ×2 | 1 pair | battery divider | 8.4 V max → 4.2 V at A3 |
| Resistors 1 kΩ + 2 kΩ | 1 pair | UART level shift (Uno 5 V → ESP 3.3 V) | |
| Resistor 10 kΩ ×2 | 1 pair | privacy-sense divider (5 V → 2.5 V) | Optional; 5 V into a Uno pin is fine, the divider protects if the rail misbehaves |
| Raspberry Pi | (spare) | fallback only | If the ESP32-CAM can't keep up; costs ~3× the power |

## 4. Wiring

### 4.1 Power

```text
Battery + ── main switch (optional) ── LM2596 IN+        LM2596 OUT+ (5.0 V) ──┬── Uno 5V pin
Battery − ─────────────────────────── LM2596 IN−         LM2596 OUT− ──────────┼── common GND
                                                                                ├── MQ-7, MQ-2, DHT11, KY-037, RTC VCC
                                                                                └── PRIVACY SWITCH ── pendant 5V (ESP32-CAM 5V)
Battery + ── 10 kΩ ──┬── 10 kΩ ── GND
                     └── Uno A3   (battery voltage / 2)
```

- **All grounds common.** Without a shared GND the UART and the analog readings won't work.
- Never power the Uno from USB and the buck at the same time while flashing. Unplug the battery first, or disconnect the buck's 5 V from the Uno.
- The ESP32-CAM browns out with weak supplies (it resets when Wi-Fi starts). Put a **470–1000 µF capacitor** across 5 V/GND at the pendant end of the cable.

### 4.2 Arduino Uno pinout

| Uno pin | Connects to | Notes |
|---|---|---|
| A0 | MQ-7 `AO` | |
| A1 | MQ-2 `AO` | |
| A2 | KY-037 `AO` | Adjust the module pot so that silence reads ~mid-scale |
| A3 | battery divider midpoint | `V_batt = adc * 5.0 / 1023 * 2` |
| A4 / A5 | RTC `SDA` / `SCL` | |
| D2 | DHT11 `DATA` | 10 kΩ pull-up to 5 V if the module doesn't have one |
| D3 | event button → GND | `INPUT_PULLUP` |
| D4 | privacy sense: pendant side of the switch (via 10k/10k divider) | HIGH = pendant powered = privacy **off** |
| D5 | buzzer `+` | |
| D6 | recording LED (pendant) via 330 Ω | ON only while capture heartbeats arrive |
| D8 | ESP32-CAM GPIO12 (ESP TX) | SoftwareSerial RX. **No pull-up** (see §4.4) |
| D9 | 1 kΩ → ESP32-CAM GPIO13, with 2 kΩ from GPIO13 to GND | SoftwareSerial TX, 5 V → 3.3 V divider |
| D13 | onboard LED | heartbeat |
| D0 / D1 | free (USB serial for debugging) | |

### 4.3 ESP32-CAM pinout

The SD card runs in **1-bit mode**, which frees GPIO 4, 12 and 13.

| GPIO | Use | Notes |
|---|---|---|
| camera pins | OV2640 | fixed by the AI-Thinker board |
| 2, 14, 15 | microSD (1-bit) | |
| 13 | UART RX ← Uno D9 (through the divider) | `Serial2` |
| 12 | UART TX → Uno D8 | **Strapping pin**, see §4.4 |
| 4 | onboard flash LED | forced LOW (it is blinding) |
| 33 | onboard red LED (back side, active LOW) | mirrors capture state for debugging |
| 1 / 3 | USB serial (MB programmer) | logs only; don't wire to the Uno |
| 0 | boot mode | the MB board handles it when flashing |

### 4.4 The GPIO12 caveat

GPIO12 selects the flash voltage at boot: if it is HIGH during reset, the ESP32 picks 1.8 V and won't boot. That's why:

- The Uno's D8 is configured **without pull-up** (`pinMode(8, INPUT)` after `SoftwareSerial.begin`), so the line floats and the ESP32's internal pull-down wins at boot.
- The ESP32 drives 3.3 V into the Uno, which reads it as HIGH (threshold ~3.0 V). It works, but with little margin.
- If boot problems appear, there's a permanent fix: `espefuse.py set_flash_voltage 3.3V` (an **irreversible** eFuse burn). After that, GPIO12 is a normal pin. Decide that as a team before doing it.

## 5. Power budget (estimate, to be measured)

| Load @ 5 V | Typical | Peak |
|---|---:|---:|
| ESP32-CAM capturing + Wi-Fi | 180 mA | 450 mA |
| Arduino Uno | 50 mA | 50 mA |
| MQ-7 heater | 150 mA | 150 mA |
| MQ-2 heater | 150 mA | 150 mA |
| DHT11 + KY-037 + RTC + LED + buzzer | 15 mA | 40 mA |
| **Total** | **~545 mA (2.7 W)** | **~840 mA** |

At 7.4 V with ~85 % buck efficiency, the battery draws **~0.45 A**. With a 1000 mAh pack that's **~2 h** of continuous use; scale it with the real capacity on the label. The MQ heaters are 55 % of the load, so the easiest win is a second switch to turn the gas sensors off when the protocol doesn't need them.

The Uno measures battery voltage on A3 and reports it every second. Thresholds for a 2S pack: **< 7.0 V = low** (buzzer warning, `low_battery` event), **< 6.6 V = critical** (stop capture cleanly).

## 6. Clock and synchronization

- The **RTC on the Uno is the master clock.** Every sensor line carries `rtc_epoch` (seconds) and `uptime_ms`.
- The ESP32-CAM keeps an offset between the Uno's RTC time and its own `millis()`, refreshed with every sensor line. Each frame is stamped with `rtc_epoch_ms`.
- **Time sync:** the Android app calls `POST /time` on the ESP32-CAM, which forwards `C,TIME,<epoch>` to the Uno. The Uno sets the RTC and emits an `E,RTC_SET,<old_epoch>` event, so the backend knows the drift.
- All device times are **UTC epoch**. Time zones are applied in the backend.

## 7. Interfaces

### 7.1 UART protocol (Uno ↔ ESP32-CAM, 19200 baud, ASCII lines)

Each line is `<payload>*<checksum>\n`, where the checksum is the XOR of all payload bytes as 2 uppercase hex digits (NMEA-style). Lines with a bad checksum are dropped and counted.

**Uno → ESP32-CAM**

| Line | When | Fields |
|---|---|---|
| `S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<mq7>,<mq2>,<sound_p2p>,<batt_mv>` | every 1 s | MQ and sound values are raw ADC (0–1023). `temp_c`/`rh_pct` are empty if the DHT read failed |
| `E,<epoch>,<uptime_ms>,<type>[,<value>]` | on event | `type` ∈ `BOOT`, `BUTTON`, `PRIVACY_ON`, `PRIVACY_OFF`, `RTC_SET`, `RTC_LOST`, `LOW_BATT`, `CRIT_BATT`, `DHT_FAIL` |
| `A,<cmd>,OK` | after a command | acknowledgement |

**ESP32-CAM → Uno**

| Line | Meaning |
|---|---|
| `C,REC,1` | capture heartbeat, sent every second while capturing. The Uno turns the recording LED off if no heartbeat arrives for 3 s |
| `C,TIME,<epoch>` | set the RTC |
| `C,BUZZ,<pattern>` | `pattern` ∈ `SHORT`, `DOUBLE`, `LONG` |
| `C,HELLO` | sent by the ESP32-CAM on boot; the Uno replies with its last `PRIVACY_ON` epoch so the gap can be logged |

**Privacy switch behavior.** While privacy is on, the Uno stops transmitting and holds its TX line LOW, so it doesn't back-power the ESP32-CAM through its RX pin. The switch cuts the pendant's power, so the camera is physically off and nothing is recorded during that time. The Uno timestamps `PRIVACY_ON`/`PRIVACY_OFF` and keeps the last interval in EEPROM. When the ESP32-CAM boots it sends `C,HELLO` and the Uno replays the interval, which gets written to `events.csv`. The backend turns it into a `coverage_interval` with status `privacy_switch`.

### 7.2 Files on the microSD

```text
/sessions/<session_id>/          session_id = <device_id>-<start_epoch>
  session.json                   device_id, firmware_version, protocol_version, fps, resolution, start/end
  frames/000001.jpg …
  frames.csv                     seq,rtc_epoch_ms,uptime_ms,bytes
  sensors.csv                    rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv
  events.csv                     rtc_epoch,uptime_ms,type,value
```

Sensor lines and events are only written while a session is active; events outside a session go to `/events-idle.csv`. These files map to the contracts in `AGENTS.md` §5 (`sensor_sample`, `device_event`, `coverage_interval`). The Android app or the worker converts them; the device keeps a flat CSV format so it stays simple and robust.

### 7.3 HTTP API (ESP32-CAM, for the Android app)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | `device_id`, firmware, capturing, session_id, frames, SD free, last sensor line, battery mV, RTC epoch |
| POST | `/time?epoch=<s>` | sync the RTC |
| POST | `/capture/start?protocol=<v>` / `/capture/stop` | start or stop a session |
| GET | `/sessions` | list sessions with sizes |
| GET | `/sessions/<id>/<file>` | download `session.json`, `frames.csv`, `sensors.csv`, `events.csv` |
| GET | `/sessions/<id>/frames/<n>.jpg` | download a frame |
| DELETE | `/sessions/<id>` | remove a session after a confirmed upload |
| POST | `/buzz?pattern=<p>` | test or trigger a notification |

Wi-Fi: STA mode against the phone hotspot (credentials in `secrets.h`, not committed). If that connection fails, the device falls back to AP mode `OLM-<device_id>`.

## 8. Measurement caveats (repeat these in the pitch)

- **MQ-7** needs a 5 V / 1.4 V heater cycle to measure CO properly. Without a MOSFET we run it at constant 5 V, so its readings are **relative indicators**, not ppm.
- **MQ sensors** need minutes of warm-up (hours of burn-in for stable baselines). Discard the first minutes of each session.
- **KY-037** gives a relative level, not calibrated dB.
- **DHT11** near the body and the electronics reads warmer than the room. That's why it lives in the hub, away from the MQ heaters.
- There is **no IMU**, so we can't tell "worn" from "on the table". Mitigations: an image-based check in the worker (dark or static frames → `low_quality`), plus adding an MPU-6050 if we can get one.

## 9. Bring-up plan (each step independently testable)

| # | Step | Done when |
|---|---|---|
| 1 | Set LM2596 to 5.0 V with no load | multimeter reads 5.0–5.1 V |
| 2 | Uno + DHT11 + RTC on USB | serial shows `S,...` lines every second with a sane temperature and advancing epoch |
| 3 | Add MQ-7, MQ-2, KY-037, battery divider | values react to a lighter (MQ-2, without flame), clapping (sound) and the measured battery voltage ±0.1 V |
| 4 | Button, buzzer, privacy sense, LED | `E,BUTTON` on press, buzzer patterns via serial, `PRIVACY_*` events on toggle |
| 5 | ESP32-CAM alone (MB board): camera + SD | `/sessions/.../frames` filling at 2 fps, SD formatted FAT32 |
| 6 | Wi-Fi + HTTP | `/status` reachable from a laptop on the same hotspot |
| 7 | UART link | `sensors.csv` filling inside the session, `C,REC` heartbeats lighting the LED |
| 8 | Full system on battery | runs 30 min unattended; measure current and battery drop |
| 9 | Enclosure | pendant orientation reproducible, cable strain relief, hub ventilated |
| 10 | End-to-end | Android downloads a session; worker builds MP4 from `frames.csv` |

## 10. Open questions

1. **RTC model**: DS3231/DS1307 (I²C, 4 pins) or DS1302 (3-wire: CLK/DAT/RST)? If it's a DS1302, use D10–D12 and the `Ds1302` library.
2. **Buzzer**: active (beeps on DC) or passive (needs `tone()`)?
3. **Battery**: exact capacity, and whether it has a protection board (BMS). How do we charge it, with a 2S balance charger?
4. **Can we get an MPU-6050** (IMU), a small MOSFET (MQ-7 heater cycle / gas sensors off) and a TP4056-like charger?
5. **Camera lens**: the stock OV2640 has a ~66° FOV. A wide-angle (120–160°) module would show the hands and table while eating much better. Can we get one?
6. **Pendant mounting**: height on the chest and angle (tilted ~20–30° down to see the plate).
