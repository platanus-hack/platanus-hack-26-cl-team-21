// Copy to secrets.h (git-ignored) and fill in.
#pragma once

// Known local networks, tried strongest-first. Add the lab/home Wi-Fi first and the phone hotspot last.
static const char *WIFI_NETWORKS[][2] = {
  {"lab-or-home-ssid", "password"},
  {"phone-hotspot-ssid", "password"},
};

// Fallback access point (when no known network is in range). Min 8 chars.
#define AP_PASS "olm-demo-1234"

// Shared with the Android app at pairing time; required as "Authorization: Bearer <token>".
#define API_TOKEN "change-me-long-random-string"
