// Sensor hub (ESP32-CAM board without camera or microSD) — see hardware/README.md for wiring.
// Reads CO2 (MH-Z19C), temperature/humidity (DHT11) and sound activity (KY-037 DO) and sends one
// checksummed "S,..." line per second over UDP to the pendant camera on the same Wi-Fi network.
// Board: "AI Thinker ESP32-CAM" (esp32:esp32:esp32cam).

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiUdp.h>
#include <DHT.h>
#include "secrets.h"  // copy secrets.example.h -> secrets.h (git-ignored)

#define FIRMWARE_VERSION "hub-esp32-0.1.0"

constexpr int Co2RxPin = 13;
constexpr int Co2TxPin = 14;
constexpr int DhtPin = 15;
constexpr int SoundDigitalPin = 4;
constexpr uint16_t HubUdpPort = 4210;
constexpr unsigned long Co2WarmupMs = 180000;
constexpr unsigned long SendPeriodMs = 1000;
constexpr unsigned long ReadReserveMs = 400;  // DHT11 (~25 ms) and MH-Z19C (300 ms timeout) after the sound window
constexpr uint8_t ReadCo2Request[] = {0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79};

DHT dht(DhtPin, DHT11);
WiFiMulti wifiMulti;
WiFiUDP udp;

bool readCo2(uint16_t &ppm) {
  while (Serial2.available()) Serial2.read();
  Serial2.write(ReadCo2Request, sizeof(ReadCo2Request));

  uint8_t response[9];
  if (Serial2.readBytes(response, sizeof(response)) != sizeof(response) ||
      response[0] != 0xFF || response[1] != 0x86) {
    return false;
  }

  uint8_t sum = 0;
  for (size_t i = 1; i < sizeof(response); i++) sum += response[i];
  if (sum != 0) return false;

  ppm = (static_cast<uint16_t>(response[2]) << 8) | response[3];
  return true;
}

unsigned soundActivePercentOver(unsigned long windowMs) {
  unsigned long start = millis();
  unsigned samples = 0;
  unsigned active = 0;
  while (millis() - start < windowMs) {
    samples++;
    if (digitalRead(SoundDigitalPin) == HIGH) active++;
    delay(1);
  }
  return samples == 0 ? 0 : active * 100 / samples;
}

String co2Field() {
  uint16_t ppm;
  if (millis() < Co2WarmupMs || !readCo2(ppm)) return "";
  return String(ppm);
}

String formatOrEmpty(float value, int decimals) {
  return isnan(value) ? String("") : String(value, decimals);
}

uint8_t checksum(const char *s) {
  uint8_t c = 0;
  while (*s) c ^= static_cast<uint8_t>(*s++);
  return c;
}

// Same shape as the Uno hub's line, without an RTC: the epoch is left empty and the camera stamps it.
// S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<co2_ppm>,<sound_active_pct>,<batt_mv>*HH
String buildSensorLine(unsigned soundPct) {
  String line = "S,," + String(millis()) + "," + formatOrEmpty(dht.readTemperature(), 1) + "," +
                formatOrEmpty(dht.readHumidity(), 0) + "," + co2Field() + "," + String(soundPct) + ",";
  char tail[4];
  snprintf(tail, sizeof(tail), "*%02X", checksum(line.c_str()));
  return line + tail;
}

// On the camera's own access point the camera is the gateway; on a shared network it is found by broadcast.
IPAddress cameraAddress() {
  return WiFi.SSID().startsWith("OLM-") ? WiFi.gatewayIP() : IPAddress(255, 255, 255, 255);
}

void sendToCamera(const String &line) {
  if (WiFi.status() != WL_CONNECTED) return;
  udp.beginPacket(cameraAddress(), HubUdpPort);
  udp.print(line);
  udp.endPacket();
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, Co2RxPin, Co2TxPin);
  Serial2.setTimeout(300);
  dht.begin();
  pinMode(SoundDigitalPin, INPUT);

  WiFi.mode(WIFI_STA);
  for (const auto &network : WIFI_NETWORKS) wifiMulti.addAP(network[0], network[1]);
  Serial.println(FIRMWARE_VERSION);
}

unsigned long nextSendMs = 0;

void connectWifiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED || wifiMulti.run() != WL_CONNECTED) return;
  Serial.printf("wifi: %s %s -> camera %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(),
                cameraAddress().toString().c_str());
  nextSendMs = millis();
}

// One line every SendPeriodMs, so the camera's arrival stamps (whole seconds) don't skip seconds.
void loop() {
  connectWifiIfNeeded();
  if (nextSendMs == 0) nextSendMs = millis();
  nextSendMs += SendPeriodMs;
  unsigned long windowMs = SendPeriodMs - ReadReserveMs;
  String line = buildSensorLine(soundActivePercentOver(windowMs));
  while ((long)(nextSendMs - millis()) > 0) delay(1);
  sendToCamera(line);
  Serial.println(line);
  if ((long)(millis() - nextSendMs) > 0) nextSendMs = millis();  // a late send moves the schedule: gaps never drop under 1 s
}
