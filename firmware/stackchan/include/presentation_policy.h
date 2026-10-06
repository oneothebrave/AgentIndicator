#pragma once
#include <stdint.h>
#include <string.h>
#include "event_states.h"

// Device presentation is independent of the last real Agent event.
class PresentationPolicy {
 public:
  static constexpr uint32_t DONE_HOLD_MS = 5000;
  static constexpr size_t MAX_EVENT_ID_BYTES = 256;
  static constexpr size_t REMEMBERED_COMPLETIONS = 32;

  void hello(double bridgeAt) {
    connected = true;
    awaitingSnapshot = true;
    helloAt = bridgeAt;
    rawEvent = nullptr;
    presentationState = "idle";
    holdingDone = false;
    settledDone = false;
  }

  void disconnect() {
    connected = false;
    awaitingSnapshot = false;
    holdingDone = false;
    settledDone = false;
    presentationState = "offline";
  }

  bool receive(const EventState* event, const char* id, double at, uint32_t now) {
    if (!connected || !event || !id || strlen(id) > MAX_EVENT_ID_BYTES) {
      return false;
    }

    const bool firstEvent = awaitingSnapshot;
    awaitingSnapshot = false;
    const bool completed = !strcmp(event->state, "done");
    const bool duplicate = completed && remembers(id);
    // hello.at and event.at share the bridge clock. The first older completion
    // is its reconnect snapshot, including one received after a device reboot.
    const bool historical = completed && firstEvent && (duplicate || at <= helloAt);
    if (duplicate && !historical) {
      return false;
    }

    rawEvent = event;
    holdingDone = false;
    settledDone = false;
    presentationState = event->state;
    if (completed) {
      if (!duplicate) {
        remember(id);
      }
      if (historical) {
        presentationState = "idle";
        settledDone = true;
      } else {
        holdingDone = true;
        doneStartedAt = now;
        ++animationGeneration;
      }
    }
    return true;
  }

  bool tick(uint32_t now) {
    if (!connected || !holdingDone || now - doneStartedAt < DONE_HOLD_MS) {
      return false;
    }
    holdingDone = false;
    settledDone = true;
    presentationState = "idle";
    return true;
  }

  const EventState* lastEvent() const {
    return rawEvent;
  }

  const char* state() const {
    return presentationState;
  }

  bool completionSettled() const {
    return settledDone;
  }

  uint32_t celebrationGeneration() const {
    return animationGeneration;
  }

 private:
  bool connected = false;
  bool awaitingSnapshot = false;
  bool holdingDone = false;
  bool settledDone = false;
  double helloAt = 0;
  uint32_t doneStartedAt = 0;
  uint32_t animationGeneration = 0;
  const EventState* rawEvent = nullptr;
  const char* presentationState = "offline";
  char completions[REMEMBERED_COMPLETIONS][MAX_EVENT_ID_BYTES + 1] = {};
  size_t nextCompletion = 0;
  size_t completionCount = 0;

  bool remembers(const char* id) const {
    for (size_t index = 0; index < completionCount; ++index) {
      if (!strcmp(completions[index], id)) {
        return true;
      }
    }
    return false;
  }

  void remember(const char* id) {
    strcpy(completions[nextCompletion], id);
    nextCompletion = (nextCompletion + 1) % REMEMBERED_COMPLETIONS;
    if (completionCount < REMEMBERED_COMPLETIONS) {
      ++completionCount;
    }
  }
};
