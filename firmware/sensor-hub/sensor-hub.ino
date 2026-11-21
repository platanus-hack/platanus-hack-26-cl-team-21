// Sensor hub (Arduino Uno) — see hardware/README.md for wiring and protocol.
// Owns: sensors, RTC (master clock), buzzer, event button, privacy sense, recording LED.
// Talks to the ESP32-CAM over SoftwareSerial using checksummed ASCII lines.

#include <SoftwareSerial.h>
#include <EEPROM.h>
#include <Wire.h>
#include <DHT.h>
#include <RTClib.h>

// ---------- Configuration ----------
#define FIRMWARE_VERSION "hub-0.1.0"
#define BUZZER_PASSIVE 1          // 1 = passive buzzer (tone), 0 = active buzzer (DC)
#define SAMPLE_PERIOD_MS 1000UL
#define SOUND_WINDOW_MS 50UL
#define REC_TIMEOUT_MS 3000UL
#define LOW_BATT_MV 7000
#define CRIT_BATT_MV 6600
#define BATT_HYSTERESIS_MV 150
#define BATT_DIVIDER 2.0          // 10k/10k

// ---------- Pins ----------
const uint8_t PIN_MQ7 = A0;
const uint8_t PIN_MQ2 = A1;
const uint8_t PIN_SOUND = A2;
const uint8_t PIN_BATT = A3;
const uint8_t PIN_DHT = 2;
const uint8_t PIN_BUTTON = 3;
const uint8_t PIN_PRIVACY_SENSE = 4;  // HIGH = pendant powered = privacy OFF
const uint8_t PIN_BUZZER = 5;
const uint8_t PIN_REC_LED = 6;
const uint8_t PIN_LINK_RX = 8;        // from ESP32-CAM GPIO12 (no pull-up! strapping pin)
const uint8_t PIN_LINK_TX = 9;        // to ESP32-CAM GPIO13 via 1k/2k divider
const uint8_t PIN_HEARTBEAT = LED_BUILTIN;

const int EEPROM_PRIVACY_ADDR = 0;    // uint32_t epoch of last PRIVACY_ON (0 = none)

SoftwareSerial link(PIN_LINK_RX, PIN_LINK_TX);
DHT dht(PIN_DHT, DHT11);
RTC_DS3231 rtc;

bool rtcOk = false;
bool privacyOn = false;
bool lowBatt = false;
bool critBatt = false;
bool lastButton = HIGH;
unsigned long lastButtonChangeMs = 0;
unsigned long lastSampleMs = 0;
unsigned long lastRecHeartbeatMs = 0;
bool recSeen = false;

char rxBuf[64];
uint8_t rxLen = 0;

// ---------- Helpers ----------
uint32_t nowEpoch() { return rtcOk ? rtc.now().unixtime() : 0; }

uint8_t checksum(const char *s) {
  uint8_t c = 0;
  while (*s) c ^= (uint8_t)*s++;
  return c;
}

// Sends "<payload>*HH\n" to the ESP32-CAM (if powered) and mirrors it on USB serial.
void sendLine(const char *payload) {
  char tail[5];
  snprintf(tail, sizeof(tail), "*%02X", checksum(payload));
  if (!privacyOn) {
    link.print(payload);
    link.println(tail);
  }
  Serial.print(payload);
  Serial.println(tail);
}

void sendEvent(const char *type, const char *value = nullptr) {
  char line[64];
  if (value) snprintf(line, sizeof(line), "E,%lu,%lu,%s,%s", nowEpoch(), millis(), type, value);
  else snprintf(line, sizeof(line), "E,%lu,%lu,%s", nowEpoch(), millis(), type);
  sendLine(line);
}

void buzz(const char *pattern) {
  uint8_t beeps = 1;
  unsigned int ms = 80;
  if (strcmp(pattern, "DOUBLE") == 0) beeps = 2;
  else if (strcmp(pattern, "LONG") == 0) ms = 600;
  for (uint8_t i = 0; i < beeps; i++) {
#if BUZZER_PASSIVE
    tone(PIN_BUZZER, 2700, ms);
    delay(ms);
#else
    digitalWrite(PIN_BUZZER, HIGH);
    delay(ms);
    digitalWrite(PIN_BUZZER, LOW);
#endif
    if (i + 1 < beeps) delay(100);
  }
}

// Peak-to-peak amplitude over a short window: relative sound level (raw ADC units).
int readSoundP2P() {
  int lo = 1023, hi = 0;
  unsigned long start = millis();
  while (millis() - start < SOUND_WINDOW_MS) {
    int v = analogRead(PIN_SOUND);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

long readBatteryMv() {
  long raw = analogRead(PIN_BATT);
  return (long)(raw * 5000.0 / 1023.0 * BATT_DIVIDER);
}

// While the pendant is unpowered, keep TX LOW so we don't back-power the ESP32 through its RX pin.
void setLinkPowered(bool powered) {
  if (powered) {
    digitalWrite(PIN_LINK_TX, HIGH);  // UART idle level
  } else {
    digitalWrite(PIN_LINK_TX, LOW);
  }
}

// ---------- Commands from ESP32-CAM ----------
void handleCommand(char *line) {
  char *star = strrchr(line, '*');
  if (!star) return;
  *star = '\0';
  if ((uint8_t)strtoul(star + 1, nullptr, 16) != checksum(line)) return;  // corrupted, drop

  if (strcmp(line, "C,REC,1") == 0) {
    lastRecHeartbeatMs = millis();
    recSeen = true;
    return;  // heartbeats are not acknowledged
  }
  if (strncmp(line, "C,TIME,", 7) == 0) {
    uint32_t epoch = strtoul(line + 7, nullptr, 10);
    char old[12];
    snprintf(old, sizeof(old), "%lu", nowEpoch());
    if (rtcOk && epoch > 1700000000UL) {
      rtc.adjust(DateTime(epoch));
      sendEvent("RTC_SET", old);
    }
    sendLine("A,TIME,OK");
    return;
  }
  if (strncmp(line, "C,BUZZ,", 7) == 0) {
    sendLine("A,BUZZ,OK");
    buzz(line + 7);
    return;
  }
  if (strcmp(line, "C,HELLO") == 0) {
    uint32_t since;
    EEPROM.get(EEPROM_PRIVACY_ADDR, since);
    if (since != 0 && since != 0xFFFFFFFFUL) {
      char v[12];
      snprintf(v, sizeof(v), "%lu", since);
      sendEvent("PRIVACY_ON", v);   // replay: privacy started at <since>
      sendEvent("PRIVACY_OFF");     // ...and ended now (pendant just booted)
      uint32_t zero = 0;
      EEPROM.put(EEPROM_PRIVACY_ADDR, zero);
    }
    sendLine("A,HELLO,OK");
    return;
  }
}

void pollLink() {
  while (link.available()) {
    char c = link.read();
    if (c == '\n' || c == '\r') {
      if (rxLen > 0) {
        rxBuf[rxLen] = '\0';
        handleCommand(rxBuf);
        rxLen = 0;
      }
    } else if (rxLen < sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    } else {
      rxLen = 0;  // overflow: drop the line
    }
  }
}

// ---------- Inputs ----------
void pollButton() {
  bool b = digitalRead(PIN_BUTTON);
  if (b != lastButton && millis() - lastButtonChangeMs > 30) {
    lastButtonChangeMs = millis();
    lastButton = b;
    if (b == LOW) {
      sendEvent("BUTTON");
      buzz("SHORT");
    }
  }
}

void pollPrivacy() {
  bool on = digitalRead(PIN_PRIVACY_SENSE) == LOW;
  if (on == privacyOn) return;
  privacyOn = on;
  if (on) {
    uint32_t epoch = nowEpoch();
    EEPROM.put(EEPROM_PRIVACY_ADDR, epoch);
    setLinkPowered(false);
    sendEvent("PRIVACY_ON");  // USB log only; the pendant is off
  } else {
    setLinkPowered(true);
    // The ESP32-CAM replays the interval via C,HELLO once it boots.
  }
}

void pollRecLed() {
  bool rec = !privacyOn && recSeen && (millis() - lastRecHeartbeatMs < REC_TIMEOUT_MS);
  digitalWrite(PIN_REC_LED, rec ? HIGH : LOW);
}

void checkBattery(long mv) {
  if (!lowBatt && mv < LOW_BATT_MV) { lowBatt = true; sendEvent("LOW_BATT"); buzz("DOUBLE"); }
  if (lowBatt && mv > LOW_BATT_MV + BATT_HYSTERESIS_MV) lowBatt = false;
  if (!critBatt && mv < CRIT_BATT_MV) { critBatt = true; sendEvent("CRIT_BATT"); buzz("LONG"); }
  if (critBatt && mv > CRIT_BATT_MV + BATT_HYSTERESIS_MV) critBatt = false;
}

void sample() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int mq7 = analogRead(PIN_MQ7);
  int mq2 = analogRead(PIN_MQ2);
  int snd = readSoundP2P();
  long mv = readBatteryMv();

  char ts[8] = "", hs[8] = "";
  if (!isnan(t) && !isnan(h)) {
    dtostrf(t, 0, 1, ts);
    dtostrf(h, 0, 0, hs);
  }
  char line[80];
  snprintf(line, sizeof(line), "S,%lu,%lu,%s,%s,%d,%d,%d,%ld", nowEpoch(), millis(), ts, hs, mq7, mq2, snd, mv);
  sendLine(line);
  checkBattery(mv);
}

// ---------- Main ----------
void setup() {
  Serial.begin(115200);
  link.begin(19200);
  pinMode(PIN_LINK_RX, INPUT);  // after begin(): remove SoftwareSerial's pull-up (GPIO12 strapping)

  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_PRIVACY_SENSE, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_REC_LED, OUTPUT);
  pinMode(PIN_HEARTBEAT, OUTPUT);

  dht.begin();
  rtcOk = rtc.begin();

  privacyOn = digitalRead(PIN_PRIVACY_SENSE) == LOW;
  setLinkPowered(!privacyOn);

  sendEvent("BOOT", FIRMWARE_VERSION);
  if (!rtcOk) sendEvent("RTC_LOST", "not_found");
  else if (rtc.lostPower()) sendEvent("RTC_LOST", "lost_power");
}

void loop() {
  pollLink();
  pollButton();
  pollPrivacy();
  pollRecLed();

  if (millis() - lastSampleMs >= SAMPLE_PERIOD_MS) {
    lastSampleMs = millis();
    digitalWrite(PIN_HEARTBEAT, !digitalRead(PIN_HEARTBEAT));
    sample();
  }
}
