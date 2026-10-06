#pragma once
#include <stdint.h>
#include <string.h>

// Pure policy: no UART, display, NVS or wall clock. Raw scale is 3.2 units/degree.
class HeadPolicy {
 public:
  static constexpr int RISE = 64;
  static constexpr uint32_t SETTLE_MS = 350;
  static constexpr uint32_t RETRY_MS = 1000;
  static constexpr int MAX_ATTEMPTS = 3;

  static bool valid(int position) {
    return position >= 0 && position <= 1000;
  }

  static bool validCalibration(int level, int zero) {
    return valid(zero) && valid(level) && level >= zero - 16 && level <= zero + 16 &&
           level + RISE <= 1000;
  }

  void configure(int horizontal, int factoryZero, bool enabled) {
    level = validCalibration(horizontal, factoryZero) ? horizontal : -1;
    automatic = enabled && level >= 0;
    target = -1;
    desired = -1;
    torque = false;
    manualPending = false;
    resetRetry();
  }

  bool safe(int position) const {
    return level >= 0 && position >= level && position <= level + RISE;
  }

  int horizontal() const {
    return level;
  }

  int targetPosition() const {
    return target;
  }

  bool enabled() const {
    return automatic;
  }

  bool faulted() const {
    return failures >= MAX_ATTEMPTS;
  }

  int failureCount() const {
    return failures;
  }

  void enable() {
    automatic = level >= 0;
    manualPending = false;
    desired = -1;
    resetRetry();
  }

  void disable() {
    automatic = false;
    manualPending = false;
    torque = false;
    resetRetry();
  }

  void manual(int pos, uint32_t now) {
    if (!safe(pos)) {
      return;
    }
    automatic = false;
    manualPending = true;
    desired = pos;
    changedAt = now - SETTLE_MS;
    resetRetry();
  }

  int next(uint32_t now, bool connected, const char* state) {
    if (level < 0 || faulted() || (!automatic && !manualPending)) {
      return -1;
    }
    if (automatic) {
      int next = target < 0 ? level : target;
      if (!connected || !strcmp(state, "idle") || !strcmp(state, "sleep") ||
          !strcmp(state, "sleepy")) {
        next = level;
      } else if (!strcmp(state, "thinking") || !strcmp(state, "running") ||
                 !strcmp(state, "editing") || !strcmp(state, "tool") ||
                 !strcmp(state, "searching") || !strcmp(state, "speaking")) {
        next = level + RISE;
      }
      if (desired != next) {
        desired = next;
        changedAt = now;
      }
    }
    if (!safe(desired) || (desired == target && torque) || now - changedAt < SETTLE_MS) {
      return -1;
    }
    if (failures && now - lastFailure < RETRY_MS) {
      return -1;
    }
    return desired;
  }

  void succeeded(int pos) {
    target = pos;
    torque = true;
    manualPending = false;
    resetRetry();
  }

  void failed(uint32_t now) {
    failures++;
    lastFailure = now;
  }

 private:
  int level = -1;
  int target = -1;
  int desired = -1;
  int failures = 0;
  bool automatic = false;
  bool torque = false;
  bool manualPending = false;
  uint32_t changedAt = 0;
  uint32_t lastFailure = 0;

  void resetRetry() {
    failures = 0;
    lastFailure = 0;
  }
};
