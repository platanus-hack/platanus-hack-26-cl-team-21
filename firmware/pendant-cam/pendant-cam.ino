// Pendant camera (ESP32-CAM, AI-Thinker) — see hardware/README.md for wiring, protocol and HTTP API.
// Owns: camera, microSD (1-bit mode), Wi-Fi + HTTP server, session files.
// Board: "AI Thinker ESP32-CAM" (esp32:esp32:esp32cam). Needs PSRAM.

#include <WiFi.h>
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
HardwareSerial link(2);

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
String lastSensorLine;
long lastBattMv = -1;
uint32_t badChecksums = 0;

char rxBuf[128];
size_t rxLen = 0;

// ---------- Helpers ----------
uint64_t nowEpochMs() { return clockOk ? (uint64_t)((int64_t)millis() + epochOffsetMs) : 0; }

uint8_t checksum(const char *s) {
  uint8_t c = 0;
  while (*s) c ^= (uint8_t)*s++;
  return c;
}

void sendCommand(const String &payload) {
  char tail[5];
  snprintf(tail, sizeof(tail), "*%02X", checksum(payload.c_str()));
  link.print(payload);
  link.println(tail);
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
  if (type == 'S' || type == 'E') {
    uint32_t epoch = strtoul(field(line, 1).c_str(), nullptr, 10);
    if (epoch > 1700000000UL) {
      // RTC has 1 s resolution: timestamps are accurate to about ±1 s.
      epochOffsetMs = (int64_t)epoch * 1000 - (int64_t)millis();
      clockOk = true;
    }
  }
  if (type == 'S') {
    lastSensorLine = line;
    lastBattMv = field(line, 8).toInt();
    if (capturing) appendLine(sessionDir + "/sensors.csv", line.substring(2));
  } else if (type == 'E') {
    String evType = field(line, 3);
    if (capturing) appendLine(sessionDir + "/events.csv", line.substring(2));
    else appendLine("/events-idle.csv", line.substring(2));
    if (evType == "CRIT_BATT" && capturing) {
      Serial.println("critical battery: stopping capture");
      capturing = false;
      writeSessionJson(true);
    }
  }
}

void pollLink() {
  while (link.available()) {
    char c = link.read();
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
  sessionStartEpochMs = nowEpochMs();
  sessionId = deviceId + "-" + String((unsigned long)(sessionStartEpochMs / 1000));
  if (!clockOk) sessionId += "-noclock-" + String(millis());
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
  capturing = true;
  return true;
}

void stopSession() {
  if (!capturing) return;
  capturing = false;
  writeSessionJson(true);
  digitalWrite(PIN_RED_LED, HIGH);
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
  body += "\"last_sensor_line\":\"" + jsonEscape(lastSensorLine) + "\",";
  body += "\"link_bad_checksums\":" + String(badChecksums);
  body += "}";
  sendJson(200, body);
}

void handleTime() {
  if (!server.hasArg("epoch")) return sendJson(400, "{\"error\":\"missing epoch\"}");
  sendCommand("C,TIME," + server.arg("epoch"));
  sendJson(202, "{\"status\":\"forwarded\"}");
}

void handleCaptureStart() {
  if (!startSession(server.arg("protocol"))) return sendJson(503, "{\"error\":\"camera or sd unavailable\"}");
  sendJson(200, "{\"session_id\":\"" + sessionId + "\"}");
}

void handleCaptureStop() {
  stopSession();
  sendJson(200, "{\"status\":\"stopped\"}");
}

void handleBuzz() {
  String p = server.hasArg("pattern") ? server.arg("pattern") : "SHORT";
  sendCommand("C,BUZZ," + p);
  sendJson(202, "{\"status\":\"forwarded\"}");
}

void handleSessions() {
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

// /sessions/<id>/<file> and /sessions/<id>/frames/<n>.jpg, plus DELETE /sessions/<id>
void handleNotFound() {
  String uri = server.uri();
  if (!uri.startsWith("/sessions/") || uri.indexOf("..") >= 0) return sendJson(404, "{\"error\":\"not found\"}");

  if (server.method() == HTTP_DELETE) {
    String id = uri.substring(10);
    if (id.indexOf('/') >= 0 || (capturing && id == sessionId)) return sendJson(409, "{\"error\":\"invalid or active session\"}");
    return removeRecursive("/sessions/" + id) ? sendJson(200, "{\"status\":\"deleted\"}") : sendJson(404, "{\"error\":\"not found\"}");
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

void initWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi STA: %s\n", WiFi.localIP().toString().c_str());
    return;
  }
  WiFi.mode(WIFI_AP);
  String ssid = "OLM-" + deviceId;
  WiFi.softAP(ssid.c_str(), AP_PASS);
  Serial.printf("Wi-Fi AP %s: %s\n", ssid.c_str(), WiFi.softAPIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  link.begin(LINK_BAUD, SERIAL_8N1, PIN_LINK_RX, PIN_LINK_TX);
  pinMode(PIN_RED_LED, OUTPUT);
  digitalWrite(PIN_RED_LED, HIGH);

  char id[13];
  snprintf(id, sizeof(id), "%012llx", ESP.getEfuseMac());
  deviceId = String(id).substring(6);

  camOk = initCamera();
  sdOk = SD_MMC.begin("/sdcard", true);  // 1-bit mode frees GPIO 4, 12, 13
  pinMode(PIN_FLASH_LED, OUTPUT);
  digitalWrite(PIN_FLASH_LED, LOW);
  Serial.printf("%s device=%s camera=%d sd=%d psram=%d\n", FIRMWARE_VERSION, deviceId.c_str(), camOk, sdOk, psramFound());

  initWifi();
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/time", HTTP_POST, handleTime);
  server.on("/capture/start", HTTP_POST, handleCaptureStart);
  server.on("/capture/stop", HTTP_POST, handleCaptureStop);
  server.on("/buzz", HTTP_POST, handleBuzz);
  server.on("/sessions", HTTP_GET, handleSessions);
  server.onNotFound(handleNotFound);
  server.begin();

  sendCommand("C,HELLO");  // the hub replays any privacy interval
}

void loop() {
  pollLink();
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
