// Pendant camera (ESP32-CAM, AI-Thinker) — see hardware/README.md for wiring, protocol and HTTP API.
// Owns: camera, microSD (1-bit mode), Wi-Fi + HTTP server, session files.
// Board: "AI Thinker ESP32-CAM" (esp32:esp32:esp32cam). Needs PSRAM.

#include <WiFi.h>
#include <WiFiMulti.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <FS.h>
#include <SD_MMC.h>
#include "esp_camera.h"
#include "secrets.h"  // copy secrets.example.h -> secrets.h (git-ignored)

// ---------- Configuration ----------
#define FIRMWARE_VERSION "cam-0.1.0"
#define DEFAULT_FPS 2
#define FRAME_SIZE FRAMESIZE_VGA  // 640x480
#define JPEG_QUALITY 12           // 0-63, lower = better
#define LINK_BAUD 19200
#define PIN_LINK_RX 13            // from Uno D9 (via divider)
#define PIN_LINK_TX 12            // to Uno D8 (strapping pin: Uno side must not pull up)
#define PIN_FLASH_LED 4
#define PIN_RED_LED 33            // active LOW

// AI-Thinker camera pins
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

WebServer server(80);
WiFiMulti wifiMulti;
HardwareSerial hubLink(2);

String deviceId;
bool sdOk = false, camOk = false;

// Session state
bool capturing = false;
String sessionId, sessionDir, protocolVersion = "unknown";
uint32_t frameSeq = 0;
uint32_t fps = DEFAULT_FPS;
unsigned long lastFrameMs = 0, lastRecBeatMs = 0;
uint64_t sessionStartEpochMs = 0;

// Clock: RTC epoch from the Uno, mapped onto local millis()
bool clockOk = false;
int64_t epochOffsetMs = 0;  // epoch_ms = millis() + epochOffsetMs
int64_t nextWindowMaxMs = 0;
unsigned long clockWindowStartMs = 0;
const unsigned long CLOCK_WINDOW_MS = 10UL * 60UL * 1000UL;
const int64_t CLOCK_RESET_MS = 2000;
bool bootEventPending = false;  // CAM_BOOT is logged once the clock is known
bool resumePending = false;     // an unclosed session was found at boot; decided on the first hub line
String lastSensorLine;
long lastBattMv = -1;
uint32_t badChecksums = 0;

// Commands to the Uno are resent until acknowledged ("A,<NAME>,OK").
const uint8_t CMD_QUEUE_SIZE = 4;
const uint8_t CMD_MAX_TRIES = 10;
const unsigned long CMD_RETRY_MS = 300;
String cmdQueue[CMD_QUEUE_SIZE];
uint8_t cmdHead = 0, cmdCount = 0, cmdTries = 0;
unsigned long cmdLastSentMs = 0;
uint32_t droppedCommands = 0;
String lastAck;

const char *CURRENT_SESSION_PATH = "/current_session";

char rxBuf[128];
size_t rxLen = 0;

// ---------- Helpers ----------
void sendJson(int code, const String &body);
void stopSession();
void decideResume(unsigned long hubUptimeMs);
uint64_t nowEpochMs() { return clockOk ? (uint64_t)((int64_t)millis() + epochOffsetMs) : 0; }

uint8_t checksum(const char *s) {
  uint8_t c = 0;
  while (*s) c ^= (uint8_t)*s++;
  return c;
}

void sendCommand(const String &payload) {
  char tail[5];
  snprintf(tail, sizeof(tail), "*%02X", checksum(payload.c_str()));
  hubLink.print(payload);
  hubLink.println(tail);
}

bool enqueueCommand(const String &payload) {
  if (cmdCount == CMD_QUEUE_SIZE) return false;
  cmdQueue[(cmdHead + cmdCount) % CMD_QUEUE_SIZE] = payload;
  cmdCount++;
  return true;
}

void popCommand() {
  cmdQueue[cmdHead] = "";
  cmdHead = (cmdHead + 1) % CMD_QUEUE_SIZE;
  cmdCount--;
  cmdTries = 0;
}

void serviceCommands() {
  if (cmdCount == 0) return;
  if (cmdTries > 0 && millis() - cmdLastSentMs < CMD_RETRY_MS) return;
  if (cmdTries >= CMD_MAX_TRIES) {
    Serial.printf("command dropped after %u tries: %s\n", CMD_MAX_TRIES, cmdQueue[cmdHead].c_str());
    droppedCommands++;
    popCommand();
    return;
  }
  sendCommand(cmdQueue[cmdHead]);
  cmdTries++;
  cmdLastSentMs = millis();
}

void appendLine(const String &path, const String &line) {
  File f = SD_MMC.open(path, FILE_APPEND);
  if (!f) return;
  f.println(line);
  f.close();
}

String jsonEscape(const String &s) {
  String out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out;
}

void writeSessionJson(bool ended) {
  File f = SD_MMC.open(sessionDir + "/session.json", FILE_WRITE);
  if (!f) return;
  f.printf("{\"session_id\":\"%s\",\"device_id\":\"%s\",\"firmware_version\":\"%s\",\"protocol_version\":\"%s\","
           "\"fps\":%u,\"frame_size\":\"VGA\",\"started_at_epoch_ms\":%llu,\"ended_at_epoch_ms\":%s,\"frames\":%u}\n",
           sessionId.c_str(), deviceId.c_str(), FIRMWARE_VERSION, jsonEscape(protocolVersion).c_str(), fps,
           sessionStartEpochMs, ended ? String((unsigned long long)nowEpochMs()).c_str() : "null", frameSeq);
  f.close();
}

// ---------- Uno link ----------
String field(const String &line, int n);

// Each line's epoch is truncated to whole seconds and read before it was sent, so every
// candidate offset is a lower bound of the true one: keep the maximum over a sliding window
// (two 10-minute buckets, so slow drift is tracked). Accuracy: ~0.1–0.2 s instead of ±1 s.
// A jump of more than 2 s (first fix, RTC_SET, stale backlog) resets the estimate.
void updateClock(uint32_t epoch) {
  int64_t cand = (int64_t)epoch * 1000 - (int64_t)millis();
  if (!clockOk || llabs(cand - epochOffsetMs) > CLOCK_RESET_MS) {
    epochOffsetMs = nextWindowMaxMs = cand;
    clockWindowStartMs = millis();
    clockOk = true;
    return;
  }
  if (cand > epochOffsetMs) epochOffsetMs = cand;
  if (cand > nextWindowMaxMs) nextWindowMaxMs = cand;
  if (millis() - clockWindowStartMs > CLOCK_WINDOW_MS) {
    epochOffsetMs = nextWindowMaxMs;
    nextWindowMaxMs = cand;
    clockWindowStartMs = millis();
  }
}

// Fields are comma-separated; returns the n-th field (0-based) of a line.
String field(const String &line, int n) {
  int start = 0;
  for (int i = 0; i < n; i++) {
    start = line.indexOf(',', start);
    if (start < 0) return "";
    start++;
  }
  int end = line.indexOf(',', start);
  return end < 0 ? line.substring(start) : line.substring(start, end);
}

void handleHubLine(char *raw) {
  char *star = strrchr(raw, '*');
  if (!star) return;
  *star = '\0';
  if ((uint8_t)strtoul(star + 1, nullptr, 16) != checksum(raw)) {
    badChecksums++;
    return;
  }
  String line(raw);
  char type = line.charAt(0);
  if (type == 'A') {
    lastAck = line;
    // "A,<NAME>,OK" acknowledges the queued "C,<NAME>,..." command.
    if (cmdCount > 0 && field(cmdQueue[cmdHead], 1) == field(line, 1)) popCommand();
    return;
  }
  if (type == 'S' || type == 'E') {
    if (resumePending) decideResume(strtoul(field(line, 2).c_str(), nullptr, 10));
    uint32_t epoch = strtoul(field(line, 1).c_str(), nullptr, 10);
    if (type == 'E' && field(line, 3) == "RTC_SET") clockOk = false;  // force a clock reset after a sync
    if (epoch > 1700000000UL) updateClock(epoch);
    if (bootEventPending && clockOk && capturing) {
      char row[64];
      snprintf(row, sizeof(row), "%llu,,CAM_BOOT,resumed", (unsigned long long)(nowEpochMs() / 1000));
      appendLine(sessionDir + "/events.csv", row);
      bootEventPending = false;
    }
  }
  if (type == 'S') {
    lastSensorLine = line;
    String batt = field(line, 8);
    lastBattMv = batt.length() ? batt.toInt() : -1;  // -1 = external power
    if (capturing) appendLine(sessionDir + "/sensors.csv", line.substring(2));
  } else if (type == 'E') {
    String evType = field(line, 3);
    if (capturing) appendLine(sessionDir + "/events.csv", line.substring(2));
    else appendLine("/events-idle.csv", line.substring(2));
    if (evType == "CRIT_BATT" && capturing) {
      Serial.println("critical battery: stopping capture");
      stopSession();
    }
  }
}

void pollLink() {
  while (hubLink.available()) {
    char c = hubLink.read();
    if (c == '\n' || c == '\r') {
      if (rxLen > 0) {
        rxBuf[rxLen] = '\0';
        handleHubLine(rxBuf);
        rxLen = 0;
      }
    } else if (rxLen < sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    } else {
      rxLen = 0;
    }
  }
}

// ---------- Capture ----------

bool startSession(const String &protocol) {
  if (!sdOk || !camOk) return false;
  if (capturing) return true;
  if (resumePending) decideResume(0);  // no hub line yet: treat as a fresh boot and close the old session
  sessionStartEpochMs = nowEpochMs();
  String baseId = deviceId + "-" + String((unsigned long)(sessionStartEpochMs / 1000));
  if (!clockOk) baseId += "-noclock-" + String(millis());
  sessionId = baseId;
  for (int n = 2; SD_MMC.exists("/sessions/" + sessionId); n++) sessionId = baseId + "-" + String(n);
  sessionDir = "/sessions/" + sessionId;
  SD_MMC.mkdir("/sessions");
  SD_MMC.mkdir(sessionDir);
  SD_MMC.mkdir(sessionDir + "/frames");
  protocolVersion = protocol.length() ? protocol : "unknown";
  frameSeq = 0;
  appendLine(sessionDir + "/frames.csv", "seq,rtc_epoch_ms,uptime_ms,bytes");
  appendLine(sessionDir + "/sensors.csv", "rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv");
  appendLine(sessionDir + "/events.csv", "rtc_epoch,uptime_ms,type,value");
  writeSessionJson(false);
  // Survives resets and the privacy switch: on boot the session is resumed (see resumeSession).
  File cur = SD_MMC.open(CURRENT_SESSION_PATH, FILE_WRITE);
  if (cur) {
    cur.printf("%s\n%s\n%llu\n", sessionId.c_str(), protocolVersion.c_str(), sessionStartEpochMs);
    cur.close();
  }
  capturing = true;
  return true;
}

void stopSession() {
  if (!capturing) return;
  capturing = false;
  writeSessionJson(true);
  SD_MMC.remove(CURRENT_SESSION_PATH);
  digitalWrite(PIN_RED_LED, HIGH);
}

// After a reset or the privacy switch, continue the interrupted session: frames keep numbering,
// and the hub's privacy replay (C,HELLO) lands in this session's events.csv.
void resumeSession() {
  File cur = SD_MMC.open(CURRENT_SESSION_PATH);
  if (!cur) return;
  String id = cur.readStringUntil('\n');
  String protocol = cur.readStringUntil('\n');
  String start = cur.readStringUntil('\n');
  cur.close();
  id.trim();
  protocol.trim();
  start.trim();
  if (id.length() == 0 || !SD_MMC.exists("/sessions/" + id + "/frames.csv")) {
    SD_MMC.remove(CURRENT_SESSION_PATH);
    return;
  }
  sessionId = id;
  sessionDir = "/sessions/" + id;
  protocolVersion = protocol.length() ? protocol : "unknown";
  sessionStartEpochMs = strtoull(start.c_str(), nullptr, 10);
  frameSeq = 0;
  File frames = SD_MMC.open(sessionDir + "/frames.csv");
  if (frames) {
    while (frames.available()) if (frames.read() == '\n') frameSeq++;
    frames.close();
    if (frameSeq > 0) frameSeq--;  // header line
  }
  resumePending = true;  // capture restarts only if decideResume() confirms a camera-only restart
}

// If the hub has been up much longer than the camera, only the camera lost power (privacy switch,
// brownout): continue the session. If both just booted, the whole box was off (end of day, unplugged):
// close the session instead of silently recording into it.
void decideResume(unsigned long hubUptimeMs) {
  resumePending = false;
  if (hubUptimeMs > millis() + 5000UL) {
    capturing = true;
    bootEventPending = true;
    Serial.printf("resumed session %s at frame %u\n", sessionId.c_str(), frameSeq);
  } else {
    writeSessionJson(true);  // the worker derives the real end from frames.csv
    SD_MMC.remove(CURRENT_SESSION_PATH);
    Serial.printf("closed interrupted session %s (whole device was off)\n", sessionId.c_str());
  }
}

void captureFrame() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return;
  uint64_t ts = nowEpochMs();
  unsigned long up = millis();
  char path[96];
  snprintf(path, sizeof(path), "%s/frames/%06u.jpg", sessionDir.c_str(), frameSeq + 1);
  File f = SD_MMC.open(path, FILE_WRITE);
  if (f) {
    size_t written = f.write(fb->buf, fb->len);
    f.close();
    if (written == fb->len) {
      frameSeq++;
      char row[64];
      snprintf(row, sizeof(row), "%u,%llu,%lu,%u", frameSeq, ts, up, (unsigned)fb->len);
      appendLine(sessionDir + "/frames.csv", row);
    }
  }
  esp_camera_fb_return(fb);
}

// ---------- HTTP API ----------
void sendJson(int code, const String &body) { server.send(code, "application/json", body); }

void handleStatus() {
  if (!authorized()) return;
  String body = "{";
  body += "\"device_id\":\"" + deviceId + "\",";
  body += "\"firmware_version\":\"" FIRMWARE_VERSION "\",";
  body += "\"camera_ok\":" + String(camOk ? "true" : "false") + ",";
  body += "\"sd_ok\":" + String(sdOk ? "true" : "false") + ",";
  body += "\"sd_free_mb\":" + String(sdOk ? (unsigned long)((SD_MMC.totalBytes() - SD_MMC.usedBytes()) / 1048576ULL) : 0) + ",";
  body += "\"capturing\":" + String(capturing ? "true" : "false") + ",";
  String sid = capturing ? String("\"") + sessionId + String("\"") : String("null");
  body += "\"session_id\":" + sid + ",";
  body += "\"frames\":" + String(frameSeq) + ",";
  body += "\"clock_ok\":" + String(clockOk ? "true" : "false") + ",";
  body += "\"epoch_ms\":" + String((unsigned long long)nowEpochMs()) + ",";
  body += "\"battery_mv\":" + String(lastBattMv) + ",";
  body += "\"ip\":\"" + (WiFi.getMode() == WIFI_AP ? WiFi.softAPIP() : WiFi.localIP()).toString() + "\",";
  body += "\"pending_commands\":" + String(cmdCount) + ",";
  body += "\"dropped_commands\":" + String(droppedCommands) + ",";
  body += "\"last_ack\":\"" + jsonEscape(lastAck) + "\",";
  body += "\"last_sensor_line\":\"" + jsonEscape(lastSensorLine) + "\",";
  body += "\"link_bad_checksums\":" + String(badChecksums);
  body += "}";
  sendJson(200, body);
}

void handleTime() {
  if (!authorized()) return;
  String epoch = server.arg("epoch");
  bool digits = epoch.length() == 10;
  for (char c : epoch) digits = digits && isDigit(c);
  if (!digits) return sendJson(400, "{\"error\":\"epoch must be 10 digits (unix seconds)\"}");
  if (!enqueueCommand("C,TIME," + epoch)) return sendJson(503, "{\"error\":\"command queue full\"}");
  sendJson(202, "{\"status\":\"queued\"}");  // confirmed by last_ack / RTC_SET event
}

void handleCaptureStart() {
  if (!authorized()) return;
  if (!startSession(server.arg("protocol"))) return sendJson(503, "{\"error\":\"camera or sd unavailable\"}");
  sendJson(200, "{\"session_id\":\"" + sessionId + "\"}");
}

void handleCaptureStop() {
  if (!authorized()) return;
  stopSession();
  sendJson(200, "{\"status\":\"stopped\"}");
}

void handleBuzz() {
  if (!authorized()) return;
  String p = server.hasArg("pattern") ? server.arg("pattern") : "SHORT";
  if (p != "SHORT" && p != "DOUBLE" && p != "LONG") return sendJson(400, "{\"error\":\"pattern must be SHORT, DOUBLE or LONG\"}");
  if (!enqueueCommand("C,BUZZ," + p)) return sendJson(503, "{\"error\":\"command queue full\"}");
  sendJson(202, "{\"status\":\"queued\"}");
}

void handleSessions() {
  if (!authorized()) return;
  String body = "[";
  File dir = SD_MMC.open("/sessions");
  bool first = true;
  if (dir) {
    for (File e = dir.openNextFile(); e; e = dir.openNextFile()) {
      if (!e.isDirectory()) continue;
      String name = String(e.name());
      name = name.substring(name.lastIndexOf('/') + 1);
      if (!first) body += ",";
      body += "{\"session_id\":\"" + name + "\",\"active\":" + String(capturing && name == sessionId ? "true" : "false") + "}";
      first = false;
    }
  }
  body += "]";
  sendJson(200, body);
}

bool removeRecursive(const String &path) {
  File d = SD_MMC.open(path);
  if (!d) return false;
  if (!d.isDirectory()) { d.close(); return SD_MMC.remove(path); }
  for (File e = d.openNextFile(); e; e = d.openNextFile()) {
    String child = path + "/" + String(e.name()).substring(String(e.name()).lastIndexOf('/') + 1);
    bool isDir = e.isDirectory();
    e.close();
    if (isDir) removeRecursive(child); else SD_MMC.remove(child);
  }
  d.close();
  return SD_MMC.rmdir(path);
}

// Session ids are generated by this firmware: lowercase hex, digits and dashes only.
// Rejecting anything else blocks empty ids, other directories and case tricks (FAT is case-insensitive).
bool validSessionId(const String &id) {
  if (id.length() == 0 || id.length() > 48) return false;
  for (char c : id) {
    if (!(isDigit(c) || (c >= 'a' && c <= 'z') || c == '-')) return false;
  }
  return true;
}

// /sessions/<id>/<file> and /sessions/<id>/frames/NNNNNN.jpg, plus DELETE /sessions/<id>
void handleNotFound() {
  if (!authorized()) return;
  String uri = server.uri();
  if (!uri.startsWith("/sessions/") || uri.indexOf("..") >= 0) return sendJson(404, "{\"error\":\"not found\"}");

  if (server.method() == HTTP_DELETE) {
    String id = uri.substring(10);
    if (!validSessionId(id)) return sendJson(400, "{\"error\":\"invalid session id\"}");
    if (capturing && id == sessionId) return sendJson(409, "{\"error\":\"session is active\"}");
    File d = SD_MMC.open("/sessions/" + id);
    bool isDir = d && d.isDirectory();
    if (d) d.close();
    if (!isDir) return sendJson(404, "{\"error\":\"not found\"}");
    return removeRecursive("/sessions/" + id) ? sendJson(200, "{\"status\":\"deleted\"}") : sendJson(500, "{\"error\":\"delete failed\"}");
  }

  File f = SD_MMC.open(uri);
  if (!f || f.isDirectory()) return sendJson(404, "{\"error\":\"not found\"}");
  String type = uri.endsWith(".jpg") ? "image/jpeg" : uri.endsWith(".json") ? "application/json" : "text/csv";
  server.streamFile(f, type);
  f.close();
}

// ---------- Setup ----------
bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAME_SIZE;
  c.jpeg_quality = JPEG_QUALITY;
  c.fb_count = psramFound() ? 2 : 1;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  return esp_camera_init(&c) == ESP_OK;
}

// Joins the strongest known local network (home, lab, or the phone hotspot as a last resort).
// Traffic stays on the local network: the device never talks to the internet.
// If none is in range, it opens its own AP "OLM-<device_id>" so the phone can connect directly.
void initWifi() {
  WiFi.mode(WIFI_STA);
  for (size_t i = 0; i < sizeof(WIFI_NETWORKS) / sizeof(WIFI_NETWORKS[0]); i++) {
    wifiMulti.addAP(WIFI_NETWORKS[i][0], WIFI_NETWORKS[i][1]);
  }
  unsigned long start = millis();
  while (wifiMulti.run() != WL_CONNECTED && millis() - start < 20000) {
    // Keep the hub link alive while connecting: acks, the privacy replay and sensor lines.
    pollLink();
    serviceCommands();
    delay(100);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi STA %s: %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
  } else {
    WiFi.mode(WIFI_AP);
    String ssid = "OLM-" + deviceId;
    WiFi.softAP(ssid.c_str(), AP_PASS);
    Serial.printf("Wi-Fi AP %s: %s\n", ssid.c_str(), WiFi.softAPIP().toString().c_str());
  }
  // Discoverable as http://olm-<device_id>.local on the local network.
  String host = "olm-" + deviceId;
  if (MDNS.begin(host.c_str())) MDNS.addService("http", "tcp", 80);
}

// Every request must carry "Authorization: Bearer <API_TOKEN>" (shared at pairing time).
// This keeps other devices on the same network out; traffic is still unencrypted HTTP on the LAN.
bool authorized() {
  if (server.header("Authorization") == String("Bearer ") + API_TOKEN) return true;
  sendJson(401, "{\"error\":\"unauthorized\"}");
  return false;
}

void setup() {
  Serial.begin(115200);
  hubLink.setRxBufferSize(4096);  // Wi-Fi scans block for seconds; don't lose hub lines meanwhile
  hubLink.begin(LINK_BAUD, SERIAL_8N1, PIN_LINK_RX, PIN_LINK_TX);
  pinMode(PIN_RED_LED, OUTPUT);
  digitalWrite(PIN_RED_LED, HIGH);

  char id[13];
  snprintf(id, sizeof(id), "%012llx", ESP.getEfuseMac());
  deviceId = String(id).substring(0, 6);  // NIC-specific MAC bytes (the last 6 hex digits are the vendor OUI)

  camOk = initCamera();
  sdOk = SD_MMC.begin("/sdcard", true);  // 1-bit mode frees GPIO 4, 12, 13
  pinMode(PIN_FLASH_LED, OUTPUT);
  digitalWrite(PIN_FLASH_LED, LOW);
  Serial.printf("%s device=%s camera=%d sd=%d psram=%d\n", FIRMWARE_VERSION, deviceId.c_str(), camOk, sdOk, psramFound());

  if (sdOk && camOk) resumeSession();
  enqueueCommand("C,HELLO");  // the hub replays any privacy interval (into the resumed session, if any)
  serviceCommands();

  initWifi();
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/time", HTTP_POST, handleTime);
  server.on("/capture/start", HTTP_POST, handleCaptureStart);
  server.on("/capture/stop", HTTP_POST, handleCaptureStop);
  server.on("/buzz", HTTP_POST, handleBuzz);
  server.on("/sessions", HTTP_GET, handleSessions);
  server.onNotFound(handleNotFound);
  const char *headers[] = {"Authorization"};
  server.collectHeaders(headers, 1);
  server.begin();
}

void loop() {
  pollLink();
  serviceCommands();
  server.handleClient();

  if (capturing) {
    unsigned long now = millis();
    if (now - lastFrameMs >= 1000 / fps) {
      lastFrameMs = now;
      captureFrame();
    }
    if (now - lastRecBeatMs >= 1000) {
      lastRecBeatMs = now;
      sendCommand("C,REC,1");  // keeps the recording LED on; it turns off 3 s after beats stop
      digitalWrite(PIN_RED_LED, LOW);
    }
  }
}
