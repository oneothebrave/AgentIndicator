#include <Arduino.h>
#include <M5Unified.h>

// Minimal bring-up using the official M5Unified display API.
// No servo, camera, microphone, or network activity in this build.
void setup() {
  auto cfg = M5.config();
  cfg.fallback_board = m5::board_t::board_M5StackChan;
  cfg.internal_imu = false;
  cfg.internal_rtc = false;
  cfg.internal_mic = false;
  cfg.internal_spk = false;
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(16, 20);
  M5.Display.println("Agent Indicator");
  M5.Display.setCursor(16, 55);
  M5.Display.println("StackChan screen demo");
  M5.Display.fillRect(16, 95, 90, 35, TFT_RED);
  M5.Display.fillRect(112, 95, 90, 35, TFT_GREEN);
  M5.Display.fillRect(208, 95, 90, 35, TFT_BLUE);
}

void loop() {
  M5.update();
  static uint32_t lastTick = 0;
  if (millis() - lastTick >= 1000) {
    lastTick = millis();
    M5.Display.fillRect(16, 155, 300, 40, TFT_BLACK);
    M5.Display.setCursor(16, 155);
    M5.Display.printf("Uptime: %lu s", (unsigned long)(millis() / 1000));
    Serial.printf("screen-demo board=%d display=%dx%d uptime=%lu\n",
                  (int)M5.getBoard(), M5.Display.width(), M5.Display.height(),
                  (unsigned long)(millis() / 1000));
  }
  delay(10);
}
