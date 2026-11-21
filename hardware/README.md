# Hardware proposal: chest-worn prototype (v0)

Owner: Alendi. Status: **proposal**. The firmware in `firmware/` compiles (Uno and ESP32-CAM) but **has not been tested on hardware yet**. Every pin and value below should be verified on the bench before soldering. Open questions are listed in §10.

## 1. Goals for the demo

The prototype must produce, for a scripted eating session:

1. **Timestamped egocentric images** (camera on the chest, facing forward).
2. **Synchronized sensor context**: temperature, humidity, relative sound level, CO and flammable-gas readings (relative), battery voltage.
3. **Explicit non-observed intervals**: privacy switch on, device off, low battery.
4. **Participant markers**: event button presses.
5. **Transfer to the Android app over Wi-Fi**, with nothing leaving the phone before review.

Out of scope for v0: audio recording on the device (see §2, *Audio*), calibrated gas concentrations, calibrated dB, IMU-based wear detection, BLE, battery charging.

**Size and power are prototype-only constraints.** v0 is a single box worn on the chest with a strap or harness. It doesn't need to look like a necklace. A production version would be a custom PCB in a comfortable pendant form factor.

## 2. Architecture

A single enclosure (~12×9×5 cm) worn on the chest, with the camera on the front face tilted slightly down. Inside are two boards with separate jobs:

```text
 ┌──────────────────────────── chest box ─────────────────────────────┐
 │  battery 7.4 V ──► LM2596 buck ──► 5 V rail ─┬──► Arduino Uno (sensor hub)│
 │                                               │     DHT11, MQ-7, MQ-2,     │
 │                          privacy switch ──────┘     KY-037, RTC, buzzer,   │
 │                                │                    event button, battery  │
 │                                ▼                    divider                │
 │                          ESP32-CAM ◄──── UART ────► (Uno D8/D9)            │
 │                           camera (front), microSD, Wi-Fi HTTP API          │
 │                           recording LED (front, driven by the Uno)         │
 └─────────────────────────────────────────────────────────────────────┘
```

Layout notes: the MQ sensors go at the bottom with vents, the DHT11 on a side wall away from them, and the camera, LED and privacy switch on the front. The switch must be easy to reach.

**Division of responsibilities**

| | ESP32-CAM (camera module) | Arduino Uno (sensor hub) |
|---|---|---|
| Owns | camera, microSD, Wi-Fi, session files | sensors, RTC (master clock), buzzer, button, privacy switch, battery measurement |
| Why | the ESP32-CAM has almost no free GPIOs once camera and SD are in use | the Uno has 6 analog inputs and 5 V logic, which the MQ sensors and KY-037 need |

**Why images instead of video.** The ESP32-CAM can't encode H.264. We save **one JPEG per frame (default 2 fps, VGA)** plus a `frames.csv` index with the RTC timestamp of each frame. Benefits:

- Each frame is complete on its own, so a power loss corrupts at most one frame.
- Every frame carries an exact timestamp.
- The worker turns the frames into an MP4 with `ffmpeg` (variable frame rate, using the real timestamps) before the agent runs.
- Bandwidth and SD wear stay low.

**Audio.** We want audio for some studies (rating social interactions, the type of therapy received). We have a loose **electret capsule** (2 pins), the same kind of element the KY-037 carries. On its own it doesn't unlock recording, because a working microphone needs three things:

1. **Bias + preamp.** The capsule needs a bias resistor (2.2–10 kΩ to VCC) and a coupling capacitor. Its output is only a few to tens of mV, so it also needs an amplifier: a transistor or op-amp stage, or the mic input of a sound card. The KY-037 board has no real preamp; its LM393 is a comparator.
2. **A continuously sampling ADC.** The ESP32-CAM's free pins (4, 12, 13) are on ADC2, which can't be used while Wi-Fi is on. The Uno can sample (~8 kHz, 10-bit), but it has 2 KB of RAM.
3. **Storage.** Only the ESP32-CAM has the microSD.

Ways to use the capsule, and the alternatives:

| Option | Needs | Quality / risk |
|---|---|---|
| **A. Capsule → USB sound card (mic in) → Raspberry Pi**, recording WAV with an NTP-synced clock | USB sound card + 3.5 mm plug | Good quality, low firmware risk. The sound card provides bias and preamp. A second recorder to synchronize, but the Pi has a real clock |
| **B. Capsule → transistor preamp → Uno A2 → hardware UART → ESP32-CAM → WAV on SD** | 1 transistor (BC547/2N2222) or op-amp (LM358), resistors, capacitors | Telephone-like (8 kHz, 8-bit). High firmware risk: the Uno becomes an audio streamer, the link moves to hardware serial at 115200+ and USB debug is lost |
| C. I2S MEMS microphone (INMP441) on an ESP32-S3 | new parts | The production path |

The phone microphone is **ruled out**: it would break standardization (a different device, position and gain for every participant). Audio stays undecided for v0 and will be revisited with the board design (§10). Meanwhile the device records **relative sound level only** (KY-037 → A2).

**Wi-Fi on the local network instead of BLE for v0.** BLE plus camera together strain the ESP32-CAM's memory, and the Android app would need two transports. The ESP32-CAM keeps a list of **known local networks** (lab, home, and the phone hotspot as a last resort) and joins the strongest one. If none is in range it opens its own access point. Either way:

- The traffic between device and phone **never leaves the local network**. The device doesn't talk to the internet; the phone uploads to the backend only after review.
- The device can be found at `http://olm-<device_id>.local` (mDNS).
- Every request needs a **bearer token** shared at pairing time, so other devices on the same network can't read the data.
- Remaining gap: plain HTTP on the LAN isn't encrypted. HTTPS on the ESP32 is possible but heavy; that's for after the hackathon.

BLE is a stretch goal.

## 3. Bill of materials

| Part | Qty | Role | Notes |
|---|---|---|---|
| ESP32-CAM (AI-Thinker, OV2640) + ESP32-CAM-MB programmer | 1 | camera, SD, Wi-Fi | The MB board is only for flashing/USB serial; in the box it's powered via the 5V pin |
| Arduino Uno | 1 | sensor hub | Powered at its **5V pin** from the 5 V rail (bypasses the onboard regulator) |
| microSD 64 GB | 1 | storage | **Format FAT32** (64 GB cards ship as exFAT; the ESP32 SD library needs FAT32) |
| DHT11 | 1 | temperature / humidity | ±2 °C, ±5 % RH, ≤1 Hz; keep it away from the MQ heaters and the body |
| MQ-7 module | 1 | CO (relative) | Used at constant 5 V: **relative readings only** (see §8) |
| MQ-2 module | 1 | flammable gases / smoke (relative) | ~150 mA heater, 20 s–few min warm-up |
| KY-037 | 1 | sound level (relative) | Analog output; we compute peak-to-peak over 50 ms windows |
| RTC module DS1302 ("MH-Real-Time Clock Modules-2") + CR2032 | 1 | master clock | 3-wire interface (CLK/DAT/RST), `Rtc by Makuna` library. Drifts a few seconds per day: sync it from the phone at the start of every session |
| Buzzer TMB12A05 | 1 | local notifications | **Active** 5 V buzzer (~30 mA): beeps on DC, `BUZZER_PASSIVE 0` |
| Push button | 1 | event marker | To GND, internal pull-up |
| Mini switch | 1 | **privacy switch** | Between the 5 V rail and the ESP32-CAM: the camera is physically unpowered. The Uno senses the switched side |
| USB power bank (5 V, ≥2 A) | 1 | **main power** for bench work and the demo | Wired straight to the 5 V rail (cut-open USB cable or USB breakout) |
| LM2596 buck module | 1 | battery → 5 V | Only useful with a 2S (7.4 V) pack: a buck can't make 5 V from 3.7 V. **Set to 5.0–5.1 V with a multimeter before connecting anything** |
| Li-ion/LiPo battery, 260 mAh, 0.96 Wh | 1 | untethered segment (if usable) | 0.96 Wh ÷ 0.26 Ah = **3.7 V, i.e. a single cell**, not the 7 V we assumed. **Measure it with a multimeter** (§5). Not recharged during the hackathon |
| Red LED + 330 Ω | 1 | recording indicator (front face) | Driven by the Uno, only while ESP32-CAM reports active capture |
| Resistors 100 kΩ ×2 + 100 nF | 1 set | battery divider | Halves the battery voltage at A3 (≤4.2 V for 2S, ≤2.1 V for 1S). Tapped **after** the main switch |
| Resistors 1 kΩ + 2 kΩ | 1 pair | UART level shift (Uno 5 V → ESP 3.3 V) | |
| Resistor 100 kΩ | 1 | privacy-sense pull-down on D4 | Keeps D4 LOW while the camera side is off (the big capacitor discharges slowly). **No divider**: 2.5 V would be an undefined logic level |
| Raspberry Pi | (spare) | fallback only | If the ESP32-CAM can't keep up; costs ~3× the power |

## 4. Wiring

### 4.1 Power

```text
Power bank 5 V (demo/bench) ───────────────────────────────┐
  or: Battery + ── main switch ──┬── LM2596 IN+ ── OUT+ ───┤ (2S pack only)
                                 └── 100k ─┬─ 100k ── GND  │
                                           ├─ 100 nF ─ GND │
                                           └─ Uno A3       │
                                                           ├── Uno 5V pin
                         common GND ───────────────────────┼── MQ-7, MQ-2, DHT11, KY-037, RTC VCC
                                                           └── PRIVACY SWITCH ──┬── ESP32-CAM 5V (+ 1000 µF)
                                                                                └── Uno D4 (100k pull-down to GND)
```

- **All grounds common.** Without a shared GND the UART and the analog readings won't work.
- The battery divider sits **after** the main switch: no constant drain while stored, and no battery voltage on A3 while the Uno is unpowered.
- Never power the Uno from USB and the 5 V rail at the same time while flashing. Disconnect the rail first.
- The ESP32-CAM browns out with weak supplies (it resets when Wi-Fi starts). Put a **470–1000 µF capacitor** across the ESP32-CAM's 5 V/GND pins.

### 4.2 Arduino Uno pinout

| Uno pin | Connects to | Notes |
|---|---|---|
| A0 | MQ-7 `AO` | |
| A1 | MQ-2 `AO` | |
| A2 | KY-037 `AO` | Adjust the module pot so that silence reads ~mid-scale |
| A3 | battery divider midpoint | `V_batt = adc * 5.0 / 1023 * 2`. Below 2.5 V the firmware assumes external power and skips battery alarms |
| A4 / A5 | free | |
| D2 | DHT11 `DATA` | 10 kΩ pull-up to 5 V if the module doesn't have one |
| D3 | event button → GND | `INPUT_PULLUP` |
| D4 | privacy sense: ESP32-CAM side of the switch, **direct**, with 100 kΩ to GND | HIGH = camera powered = privacy **off** |
| D5 | buzzer `+` | |
| D6 | recording LED (front) via 330 Ω | ON only while capture heartbeats arrive |
| D8 | ESP32-CAM GPIO12 (ESP TX) | SoftwareSerial RX. **No pull-up** (see §4.4) |
| D9 | 1 kΩ → ESP32-CAM GPIO13, with 2 kΩ from GPIO13 to GND | SoftwareSerial TX, 5 V → 3.3 V divider |
| D10 / D11 / D12 | RTC `CLK` / `DAT` / `RST` | DS1302 three-wire; VCC to 5 V |
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

**The battery label (260 mAh, 0.96 Wh) implies a single 3.7 V cell**, not the 7 V pack we assumed. Measure it before wiring anything:

- **~3.7–4.2 V (1S):** the LM2596 can't produce 5 V from it (a buck only steps down). Without a boost converter (none available), the battery **can't power the device**. The power bank is the only supply. Set `BATT_CELLS 1`.
- **~7.4–8.4 V (2S):** the buck works. With 0.96 Wh and ~3.2 W drawn (2.7 W load at ~85 % efficiency), runtime is **~18 min** with everything on, or ~40 min with the MQ sensors unplugged. Peaks of ~0.7 A are a lot for such a small pack, so expect sag. Set `BATT_CELLS 2`.

**Plan:** bench work and the demo run from a **USB power bank (5 V, ≥2 A) wired straight to the 5 V rail**. If the MQ sensors aren't needed in a session, unplug their 5 V: they're 55 % of the load.

The Uno reports battery voltage on A3 every second. Thresholds scale with `BATT_CELLS`: **< 3.5 V/cell = low** (`LOW_BATT`, buzzer), **< 3.3 V/cell = critical** (`CRIT_BATT`, the ESP32-CAM closes the session). Below 2.5 V on the divider there is no battery (power bank): `batt_mv` is left empty and no alarms fire.

## 6. Clock and synchronization

- The **RTC on the Uno is the master clock.** Every sensor line carries `rtc_epoch` (seconds) and `uptime_ms`.
- The ESP32-CAM maps the Uno's RTC time onto its own `millis()`. Each line's epoch is whole seconds read slightly before sending, so every sample is a lower bound of the true offset: the firmware keeps the **maximum over a sliding 10-minute window** (two buckets, so slow drift is tracked), and resets the estimate on jumps of more than 2 s (first fix, `RTC_SET`). Expected accuracy is **~0.1–0.2 s**. Each frame is stamped with `rtc_epoch_ms`.
- **Time sync:** the Android app calls `POST /time` on the ESP32-CAM, which queues `C,TIME,<epoch>` for the Uno. The Uno sets the RTC and emits an `E,RTC_SET,<old_epoch>` event, so the backend knows the drift. The DS1302 boots with an invalid date: until the first sync, epochs are empty/0 and frames only carry uptime.
- All device times are **UTC epoch**. Time zones are applied in the backend.

## 7. Interfaces

### 7.1 UART protocol (Uno ↔ ESP32-CAM, 19200 baud, ASCII lines)

Each line is `<payload>*<checksum>\n`, where the checksum is the XOR of all payload bytes as 2 uppercase hex digits (NMEA-style). Lines with a bad checksum are dropped and counted.

**Uno → ESP32-CAM**

| Line | When | Fields |
|---|---|---|
| `S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<mq7>,<mq2>,<sound_p2p>,<batt_mv>` | every 1 s | MQ and sound values are raw ADC (0–1023). `temp_c`/`rh_pct` are empty if the DHT read failed; `batt_mv` is empty on external power |
| `E,<epoch>,<uptime_ms>,<type>[,<value>]` | on event | `type` ∈ `BOOT`, `BUTTON`, `PRIVACY_ON`, `PRIVACY_OFF`, `RTC_SET`, `RTC_LOST`, `LOW_BATT`, `CRIT_BATT`, `DHT_FAIL` (on the transition to failing). For replayed `PRIVACY_ON`/`PRIVACY_OFF`, `<value>` is the **real switch time** (epoch); `<epoch>` is when the line was sent |
| `A,<cmd>,OK` | after `TIME`, `BUZZ`, `HELLO` | acknowledgement. The ESP32-CAM resends each queued command every 300 ms until its ack arrives (up to 10 tries; drops are counted in `/status`) |

**ESP32-CAM → Uno**

| Line | Meaning |
|---|---|
| `C,REC,1` | capture heartbeat, sent every second while capturing. The Uno turns the recording LED off if no heartbeat arrives for 3 s |
| `C,TIME,<epoch>` | set the RTC |
| `C,BUZZ,<pattern>` | `pattern` ∈ `SHORT`, `DOUBLE`, `LONG` |
| `C,HELLO` | sent by the ESP32-CAM on boot; the Uno replays the last privacy interval (`PRIVACY_ON`/`PRIVACY_OFF` with their real times) |

`REC` heartbeats are fire-and-forget (a lost one is covered by the 3 s timeout). `TIME` and `BUZZ` arguments are validated by the HTTP API before queueing (10-digit epoch; `SHORT`/`DOUBLE`/`LONG`), so no text can be injected into the line protocol.

**Privacy switch behavior.** While privacy is on, the Uno stops transmitting and holds its TX line LOW, so it doesn't back-power the ESP32-CAM through its RX pin. The switch cuts the ESP32-CAM's power, so the camera is physically off and nothing is recorded. The Uno stores the `PRIVACY_ON` and `PRIVACY_OFF` times in EEPROM. When the camera boots again it **resumes the interrupted session** (see §7.2) and sends `C,HELLO`; the Uno replays the interval into that session's `events.csv`. The backend turns it into a `coverage_interval` with status `privacy_switch`. Known limit: if the RTC was never synced, the stored times are 0 and the interval can only be inferred from the frame gap.

### 7.2 Files on the microSD

```text
/sessions/<session_id>/          session_id = <device_id>-<start_epoch>
  session.json                   device_id, firmware_version, protocol_version, fps, resolution, start/end
  frames/000001.jpg …
  frames.csv                     seq,rtc_epoch_ms,uptime_ms,bytes
  sensors.csv                    rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv
  events.csv                     rtc_epoch,uptime_ms,type,value
```

Sensor lines and events are only written while a session is active; events outside a session go to `/events-idle.csv`. The active session id is persisted in `/current_session`: after any reset (privacy switch, brownout) the camera resumes that session, continues the frame numbering and logs a `CAM_BOOT,resumed` event once the clock is known. `/capture/stop` closes it. If two sessions would get the same id, a `-2`, `-3`… suffix is added. The worker should derive frame counts and end times from `frames.csv` rather than `session.json`, which is only rewritten at start and stop. These files map to the contracts in `AGENTS.md` §5 (`sensor_sample`, `device_event`, `coverage_interval`). The Android app or the worker converts them; the device keeps a flat CSV format so it stays simple and robust.

### 7.3 HTTP API (ESP32-CAM, for the Android app)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | `device_id`, firmware, IP, capturing, session_id, frames, SD free, clock, battery mV (-1 = external power), last sensor line, pending/dropped commands, last ack, bad checksums |
| POST | `/time?epoch=<s>` | sync the RTC (10-digit unix seconds). Returns 202 queued; confirmed by `last_ack` and the `RTC_SET` event |
| POST | `/capture/start?protocol=<v>` / `/capture/stop` | start or stop a session |
| GET | `/sessions` | list session ids and which one is active |
| GET | `/sessions/<id>/<file>` | download `session.json`, `frames.csv`, `sensors.csv`, `events.csv` |
| GET | `/sessions/<id>/frames/<n>.jpg` | download a frame |
| DELETE | `/sessions/<id>` | remove a session after a confirmed upload. The id must be lowercase `[0-9a-z-]`, exist, and not be active |
| POST | `/buzz?pattern=<p>` | test or trigger a notification |

All endpoints require `Authorization: Bearer <API_TOKEN>`. Wi-Fi: the device joins the strongest of the known networks in `secrets.h` (not committed), or falls back to AP mode `OLM-<device_id>`. It's reachable at `http://olm-<device_id>.local` or its IP (printed on the serial log and shown in `/status`).

## 8. Measurement caveats (repeat these in the pitch)

- **MQ-7** needs a 5 V / 1.4 V heater cycle to measure CO properly. Without a MOSFET we run it at constant 5 V, so its readings are **relative indicators**, not ppm.
- **MQ sensors** need minutes of warm-up (hours of burn-in for stable baselines). Discard the first minutes of each session.
- **KY-037** gives a relative level, not calibrated dB.
- **DHT11** near the body and the electronics reads warmer than the room. That's why it lives in the hub, away from the MQ heaters.
- There is **no IMU** (none available), so we can't tell "worn" from "on the table". Mitigation: an image-based check in the worker (dark or static frames → `low_quality`).
- The camera keeps the **stock ~66° lens** (no wide-angle available). Tilt the camera ~20–30° down and validate early that plate and hands are in frame while seated at a table.

## 9. Bring-up plan (each step independently testable)

| # | Step | Done when |
|---|---|---|
| 1 | Measure the battery voltage; wire the power bank to the 5 V rail | battery is 1S or 2S (set `BATT_CELLS`); rail reads 5.0–5.1 V |
| 2 | Uno + DHT11 + RTC on USB | serial shows `S,...` lines every second with a sane temperature and advancing epoch |
| 3 | Add MQ-7, MQ-2, KY-037, battery divider | values react to a lighter (MQ-2, without flame), clapping (sound) and the measured battery voltage ±0.1 V |
| 4 | Button, buzzer, privacy sense, LED | `E,BUTTON` on press, buzzer patterns via serial, `PRIVACY_*` events on toggle |
| 5 | ESP32-CAM alone (MB board): camera + SD | `/sessions/.../frames` filling at 2 fps, SD formatted FAT32 |
| 6 | Wi-Fi + HTTP | `/status` reachable from a laptop on the same hotspot |
| 7 | UART link | `sensors.csv` filling inside the session, `C,REC` heartbeats lighting the LED |
| 8 | Full system on battery | runs 30 min unattended; measure current and battery drop |
| 9 | Enclosure | camera orientation reproducible, strap stable, MQ section ventilated, switch reachable |
| 10 | End-to-end | Android downloads a session; worker builds MP4 from `frames.csv` |

## 10. Open questions

1. **Audio:** undecided, to be revisited with the board design (§2). No USB sound card is available, so option A is out for now.
2. **Mounting:** height on the chest and camera angle (tilted ~20–30° down to see the plate).

Resolved: a USB power bank will be available for bench work and the demo, the RTC is a DS1302, the buzzer (TMB12A05) is active, the battery is 260 mAh with no charging during the hackathon, and there's no IMU or wide-angle lens.
