#pragma once
#include <stdint.h>
#include <string.h>

struct EventState {
  const char* event;
  const char* state;
  uint32_t color;
};

// Must match src/domain/agentStatus.ts: mapEventToState / stateMeta.
constexpr EventState EVENT_STATES[] = {
  {"turn.started", "thinking", 0xa78bfa},
  {"thread.idle", "idle", 0x64d2ff},
  {"reasoning.started", "thinking", 0xa78bfa},
  {"file.change", "editing", 0x34d399},
  {"command.started", "running", 0xfbbf24},
  {"tool.started", "tool", 0x22d3ee},
  {"search.started", "searching", 0x38bdf8},
  {"approval.requested", "waiting", 0xfb7185},
  {"message.delta", "speaking", 0xf472b6},
  {"turn.completed", "done", 0x86efac},
  {"turn.failed", "error", 0xf87171},
  {"inactivity.sleepy", "sleepy", 0xc4b5fd},
  {"inactivity.sleep", "sleep", 0x64748b},
};

inline const EventState* findEventState(const char* type) {
  if (type) {
    for (const auto& mapping : EVENT_STATES) {
      if (strcmp(mapping.event, type) == 0) return &mapping;
    }
  }
  return nullptr;
}
