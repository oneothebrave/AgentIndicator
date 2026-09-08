#pragma once

// Copy to config.local.h (ignored by Git) and edit locally if needed.
// true: reuse credentials already stored by the ESP32 Wi-Fi driver.
constexpr bool USE_SAVED_WIFI = true;
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
// Computer LAN address only: no ws:// prefix or /status suffix.
constexpr char BRIDGE_HOST[] = "192.168.1.100";
constexpr uint16_t BRIDGE_PORT = 8787;
