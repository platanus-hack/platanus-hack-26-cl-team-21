// Copy to secrets.h (git-ignored) and fill in.
#pragma once

// Same networks as the pendant camera, plus the camera's own fallback AP ("OLM-<device_id>", AP_PASS).
static const char *WIFI_NETWORKS[][2] = {
  {"lab-or-home-ssid", "password"},
  {"OLM-xxxxxx", "olm-demo-1234"},
};
