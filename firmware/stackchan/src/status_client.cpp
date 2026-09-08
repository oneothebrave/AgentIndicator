#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include "event_states.h"
#include "face_renderer.h"
#include "head_motion.h"
#include "status_message.h"
#include "firmware_version.h"

#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif

namespace {
WebSocketsClient socket;
FaceRenderer face;
HeadMotion head;
bool debugPage = false;
uint32_t lastTap = 0;
bool wifiConnected = false;
bool wifiConfigured = true;
bool socketStarted = false;
bool socketConnected = false;
bool protocolReady = false;
bool dirty = true; // UI task only
uint32_t connectedAt = 0;
uint32_t lastWifiAttempt = 0;
uint32_t lastDraw = 0;
uint32_t eventCount = 0;
const EventState* currentEvent = nullptr;
const char* connectionLabel = "Wi-Fi connecting";
const char* origin = "-";


// Network state has one owner. Only immutable/static pointers cross this queue.
struct DisplayState {
  bool wifiConnected, protocolReady;
  uint32_t eventCount;
  const EventState* currentEvent;
  const char* connectionLabel;
  const char* origin;
  uint32_t ip;
};
QueueHandle_t displayQueue = nullptr;
DisplayState displayed = {false, false, 0, nullptr, "Wi-Fi connecting", "-", 0};
void publishDisplayState() {
  DisplayState state = {wifiConnected, protocolReady, eventCount, currentEvent,
    connectionLabel, origin, wifiConnected ? (uint32_t)WiFi.localIP() : 0};
  xQueueOverwrite(displayQueue, &state);
}
void networkTask(void*);

void setConnection(const char* label) {
  connectionLabel = label;
  Serial.printf("status-client connection=%s\n", label);
}

void draw() {
  const auto& connectionLabel = displayed.connectionLabel;
  const auto& protocolReady = displayed.protocolReady;
  const auto& currentEvent = displayed.currentEvent;
  const auto& origin = displayed.origin;
  const auto& eventCount = displayed.eventCount;
  const auto& wifiConnected = displayed.wifiConnected;
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(16, 14);
  M5.Display.print("Agent Indicator");
  M5.Display.setCursor(16, 46);
  M5.Display.print(connectionLabel);
  const uint32_t rgb = protocolReady && currentEvent ? currentEvent->color : 0x64748b;
  M5.Display.fillRect(16, 79, 288, 5,
    M5.Display.color565((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255));
  M5.Display.setTextSize(3);
  M5.Display.setCursor(16, 102);
  M5.Display.print(protocolReady ? (currentEvent ? currentEvent->state : "No event yet") : "Offline");
  M5.Display.setTextSize(1);
  M5.Display.setCursor(16, 153);
  // Never show a stale Agent state as current while disconnected.
  M5.Display.printf("Event: %s\n", protocolReady && currentEvent ? currentEvent->event : "-");
  M5.Display.setCursor(16, 175);
  M5.Display.printf("Source: %s    Events: %lu", protocolReady ? origin : "-", (unsigned long)eventCount);
  M5.Display.setCursor(16, 198);
  M5.Display.printf("Bridge: %s:%u", BRIDGE_HOST, BRIDGE_PORT);
  M5.Display.setCursor(16, 217);
  M5.Display.printf("IP: %s", wifiConnected ? IPAddress(displayed.ip).toString().c_str() : "-");
  M5.Display.setCursor(16, 231);
  M5.Display.printf("Firmware: %s", INDICATOR_FIRMWARE_VERSION);
}

void receiveMessage(uint8_t* payload, size_t length) {
  const auto decoded = decodeStatusMessage(payload, length, protocolReady);
  switch(decoded.kind) {
    case MessageKind::Hello:
      protocolReady = true; currentEvent = nullptr; origin = "-";
      setConnection("Connected");
      Serial.println("status-client hello version=1");
      break;
    case MessageKind::ProtocolError:
      protocolReady = false; setConnection("Protocol error"); break;
    case MessageKind::Event:
      currentEvent = decoded.event; origin = decoded.origin; ++eventCount;
      Serial.printf("status-client event=%s state=%s origin=%s count=%lu\n",
        currentEvent->event, currentEvent->state, origin, (unsigned long)eventCount);
      break;
    case MessageKind::Ignored: break;
    default: Serial.printf("status-client rejected=%d\n", (int)decoded.kind); break;
  }
}

void onSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      socketConnected = true;
      protocolReady = false;
      connectedAt = millis();
      setConnection("Awaiting hello");
      break;
    case WStype_DISCONNECTED:
      socketConnected = false;
      protocolReady = false;
      setConnection(wifiConnected ? "Bridge connecting" : "Wi-Fi connecting");
      publishDisplayState();
      break;
    case WStype_TEXT:
      receiveMessage(payload, length);
      break;
    default:
      break;
  }
}
} // namespace

void setup() {
  auto cfg = M5.config();
  cfg.fallback_board = m5::board_t::board_M5StackChan;
  cfg.internal_imu = false;
  cfg.internal_rtc = false;
  cfg.internal_mic = false;
  cfg.internal_spk = false;
  M5.begin(cfg);
  Serial.printf("firmware version=%s design=motion-eyes-v5-silver rise=20deg\n", INDICATOR_FIRMWARE_VERSION);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  if (!face.begin()) {
    debugPage = true;
    Serial.println("face framebuffer allocation failed; using text page");
  }
  head.begin();
  displayQueue = xQueueCreate(1, sizeof(DisplayState));
  if (!displayQueue || xTaskCreatePinnedToCore(networkTask, "indicator-network", 8192, nullptr, 1, nullptr, 0) != pdPASS) {
    displayed.connectionLabel = "Network task failed";
    Serial.println("status-client network-task=failed");
  }

}

void loop() {
  M5.update();
  if (M5.Touch.getDetail().wasPressed() && millis() - lastTap > 300) {
    lastTap = millis();
    debugPage = face.available() ? !debugPage : true;
    dirty = true;
    Serial.printf("face page=%s\n", debugPage ? "details" : "expression");
  }
  DisplayState latest;
  if (displayQueue && xQueueReceive(displayQueue, &latest, 0) == pdTRUE) {
    dirty = dirty || latest.wifiConnected != displayed.wifiConnected || latest.protocolReady != displayed.protocolReady
      || latest.eventCount != displayed.eventCount || latest.connectionLabel != displayed.connectionLabel || latest.ip != displayed.ip
      || latest.currentEvent != displayed.currentEvent || latest.origin != displayed.origin;
    displayed = latest;
  }
  head.update(displayed.protocolReady, displayed.currentEvent ? displayed.currentEvent->state : "idle");
  face.update(millis(), displayed.protocolReady, displayed.currentEvent ? displayed.currentEvent->state : "idle", !debugPage);
  if (debugPage && dirty && millis() - lastDraw >= 100) {
    dirty = false;
    lastDraw = millis();
    draw();
  }
  delay(5);
}

namespace {
void networkTask(void*) {
  socket.onEvent(onSocketEvent);
  socket.setReconnectInterval(3000);
  socket.enableHeartbeat(15000, 3000, 2);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (USE_SAVED_WIFI) {
    wifi_config_t saved = {};
    wifiConfigured = esp_wifi_get_config(WIFI_IF_STA, &saved) == ESP_OK && saved.sta.ssid[0] != 0;
    memset(&saved, 0, sizeof(saved));
    Serial.printf("status-client saved-wifi-present=%d\n", wifiConfigured);
    if (wifiConfigured) WiFi.begin();
  } else {
    wifiConfigured = WIFI_SSID[0] != 0;
    if (wifiConfigured) WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (!wifiConfigured) setConnection("Wi-Fi not configured");
  lastWifiAttempt = millis();
  Serial.printf("status-client boot board=%d display=%dx%d saved-wifi=%d\n",
                (int)M5.getBoard(), M5.Display.width(), M5.Display.height(), USE_SAVED_WIFI);
  for (;;) {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wifiConnected) {
    wifiConnected = connected;
    if (connected) {
      Serial.printf("status-client wifi-connected ip=%s\n", WiFi.localIP().toString().c_str());
      setConnection("Bridge connecting");
      if (!socketStarted) {
        socket.begin(BRIDGE_HOST, BRIDGE_PORT, "/status");
        socketStarted = true;
      }
    } else {
      socketConnected = false;
      protocolReady = false;
      setConnection("Wi-Fi connecting");
      publishDisplayState();
      socket.disconnect();
    }
  }
  if (connected) {
    socket.loop();
    if (socketConnected && !protocolReady && millis() - connectedAt > 5000) {
      socket.disconnect();
    }
  } else if (wifiConfigured && millis() - lastWifiAttempt >= 15000) {
    lastWifiAttempt = millis();
    Serial.printf("status-client wifi-retry status=%d saved-wifi=%d\n", (int)WiFi.status(), USE_SAVED_WIFI);
    WiFi.reconnect();
  }

    publishDisplayState();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}
} // namespace
