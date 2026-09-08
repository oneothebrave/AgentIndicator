#pragma once
#include <M5Unified.h>
#include <Preferences.h>
#include <SCSCL.h>
#include <PY32IOExpander.hpp>
#include "head_policy.h"
#include "firmware_version.h"

// Pitch only: no broadcast, yaw or factory calibration writes.
class HeadMotion {
  SCSCL bus;
  m5::PY32IOExpander_Class power;
  HeadPolicy policy;
  int zero = 620;
  bool ready = false;

  bool save(bool enabled, bool saveLevel = false) {
    Preferences prefs;
    if (!prefs.begin("indicator-head", false)) return false;
    bool ok = prefs.putBool("enabled", enabled) > 0;
    if (saveLevel) ok = prefs.putInt("level", policy.horizontal()) > 0 && ok;
    prefs.end();
    if (!ok) Serial.println("head settings-save-failed");
    return ok;
  }
  void failure(const char* reason, uint32_t now) {
    policy.failed(now);
    Serial.printf("head %s attempt=%d/%d fault=%d\n", reason, policy.failureCount(), HeadPolicy::MAX_ATTEMPTS, policy.faulted());
  }
  void move(int pos, uint32_t now) {
    if (!policy.safe(pos)) return;
    const int current = bus.ReadPos(2);
    if (!HeadPolicy::valid(current) || bus.getState() != 0) { failure("read-failed", now); return; }
    // Servo executes the 900ms motion. Failures retry at most once per second.
    if (bus.WritePos(2, pos, 900, 0) != 1 || bus.getState() != 0) { failure("write-failed", now); return; }
    if (bus.EnableTorque(2, 1) != 1 || bus.getState() != 0) { failure("torque-failed", now); return; }
    policy.succeeded(pos);
    Serial.printf("head target=%d from=%d duration=900ms\n", pos, current);
  }
 public:
  void begin() {
    Preferences factory;
    if (factory.begin("servo", true)) { zero = factory.getInt("zero_pos_2", 620); factory.end(); }
    if (!HeadPolicy::valid(zero)) { Serial.println("head invalid-factory-zero"); return; }
    if (!power.begin()) { Serial.println("head power-expander-missing"); return; }
    if (!power.setDirection(0, true) || !power.setPullMode(0, m5::IOExpander_Base::pull_up) || !power.digitalWrite(0, true)) {
      Serial.println("head power-failed"); return;
    }
    delay(200);
    if (!bus.begin(UART_NUM_1, 1000000, 6, 7)) { Serial.println("head uart-failed"); return; }
    const int pos = bus.ReadPos(2);
    if (!HeadPolicy::valid(pos)) { Serial.println("head pitch-unavailable"); return; }
    int level = -1; bool automatic = false;
    Preferences prefs;
    if (prefs.begin("indicator-head", true)) {
      level = prefs.getInt("level", -1); automatic = prefs.getBool("enabled", false); prefs.end();
    }
    policy.configure(level, zero, automatic);
    ready = true;
    Serial.printf("head ready raw=%d factory-zero=%d level=%d automatic=%d rise=20deg\n", pos, zero, policy.horizontal(), policy.enabled());
  }
  void update(bool connected, const char* state) {
    if (!ready) return;
    const uint32_t now = millis();
    while (Serial.available()) {
      const char c = Serial.read();
      if (c == 'v') Serial.printf("firmware version=%s head level=%d target=%d raw=%d automatic=%d fault=%d\n",
        INDICATOR_FIRMWARE_VERSION, policy.horizontal(), policy.targetPosition(), bus.ReadPos(2), policy.enabled(), policy.faulted());
      if (c == 'h') {
        const int pos = bus.ReadPos(2);
        if (!HeadPolicy::validCalibration(pos, zero)) { Serial.println("head calibration-out-of-range"); continue; }
        policy.configure(pos, zero, false);
        if (save(false, true)) Serial.printf("head horizontal-saved=%d\n", pos);
      }
      if (c == 'u') policy.manual(policy.horizontal()+16, now);
      if (c == 'n') policy.manual(policy.horizontal(), now);
      if (c == 'e' && policy.horizontal() >= 0) {
        policy.enable(); save(true);
        Serial.println("head automatic-enabled rise=20deg");
      }
      if (c == 'x') {
        policy.disable();
        const bool off = bus.EnableTorque(2, 0) == 1;
        save(false);
        Serial.printf("head disabled torque-off=%d\n", off);
      }
    }
    const int pos = policy.next(now, connected, state);
    if (pos >= 0) move(pos, now);
  }
};
