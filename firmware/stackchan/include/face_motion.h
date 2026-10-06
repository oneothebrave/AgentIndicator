#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

namespace FaceMotion {
constexpr float WRITE_SECONDS = 2.f / 1.2f;
constexpr float WRITE_PERIOD = WRITE_SECONDS + 3.6f;
constexpr uint32_t BG = 0x08090e;
constexpr uint32_t INK = 0xb8bdc4;
constexpr uint32_t WAITING = 0xe89820;
constexpr uint32_t ERROR = 0xb51f32;
constexpr uint32_t OFFLINE = 0x808080;

struct Pose {
  float x = 0;
  float y = 0;
  float left = 67.08f;
  float right = 67.08f;
  float width = 29.64f;
  float gap = 87.4f;
  float happy = 0;
  float failed = 0;
  float work = 0;
  float thought = 0;
  float attention = 0;
  float amber = 0;
};

struct Key {
  float elapsedSeconds;
  float value;
};

inline float ease(float progress) {
  progress = fmaxf(0, fminf(1, progress));
  return progress * progress * (3 - 2 * progress);
}

template <size_t N>
float track(float elapsedSeconds, const Key (&keys)[N]) {
  elapsedSeconds = fmodf(elapsedSeconds, keys[N - 1].elapsedSeconds);
  for (size_t index = 1; index < N; index++) {
    if (elapsedSeconds <= keys[index].elapsedSeconds) {
      float progress = ease((elapsedSeconds - keys[index - 1].elapsedSeconds) /
                            (keys[index].elapsedSeconds - keys[index - 1].elapsedSeconds));
      return keys[index - 1].value + (keys[index].value - keys[index - 1].value) * progress;
    }
  }
  return keys[0].value;
}

inline const char* visual(const char* state) {
  if (!strcmp(state, "editing") || !strcmp(state, "tool")) {
    return "running";
  }
  if (!strcmp(state, "searching") || !strcmp(state, "speaking")) {
    return "thinking";
  }
  if (!strcmp(state, "sleepy") || !strcmp(state, "sleep")) {
    return "idle";
  }
  return state;
}

inline float writingPhase(float elapsedSeconds) {
  float cycle = fmodf(elapsedSeconds, WRITE_PERIOD);
  return cycle < WRITE_SECONDS ? cycle * 1.2f : cycle + 2.f - WRITE_SECONDS;
}

inline const float (&writingPoints())[9][2] {
  static const float points[9][2] = {{130, 180}, {137, 177}, {141, 181}, {148, 176}, {154, 180},
                                     {160, 176}, {166, 179}, {174, 177}, {182, 179}};
  return points;
}

inline void writtenPoint(float cycle, float& x, float& y) {
  const auto& points = writingPoints();
  float progress = fminf(1, cycle / 2) * 8;
  int index = (int)fminf(7, floorf(progress));
  float segmentProgress = progress - index;
  x = points[index][0] + (points[index + 1][0] - points[index][0]) * segmentProgress;
  y = points[index][1] + (points[index + 1][1] - points[index][1]) * segmentProgress;
}

inline float wink(float elapsedSeconds) {
  return elapsedSeconds >= .85f && elapsedSeconds <= 1.13f
             ? sinf((elapsedSeconds - .85f) / .28f * 3.14159265358979323846f)
             : 0;
}

inline Pose target(const char* state, float elapsedSeconds) {
  Pose pose;
  if (!strcmp(state, "idle")) {
    const Key lookKeys[] = {{0, 0}, {1.8f, 0}, {2.2f, 8}, {3.4f, 8}, {3.9f, 0}, {7.2f, 0}};
    pose.x = track(elapsedSeconds, lookKeys);
    pose.y = -2;
  } else if (!strcmp(state, "thinking")) {
    const Key lookKeys[] = {{0, 0},        {.45f, 1},  {1.1f, 1},  {1.3f, .85f}, {1.5f, 1},
                            {2.4f, 1},     {2.95f, 0}, {3.5f, 0},  {3.95f, -1},  {4.6f, -1},
                            {4.8f, -.85f}, {5, -1},    {5.9f, -1}, {6.45f, 0},   {8, 0}};
    float look = track(elapsedSeconds, lookKeys);
    pose.x = 23 * look;
    pose.y = -4 - 18 * fabsf(look);
    pose.left = (40 + 10 * look) * 1.56f;
    pose.right = (40 - 10 * look) * 1.56f;
    pose.thought = 1;
  } else if (!strcmp(state, "running")) {
    const float cycle = writingPhase(elapsedSeconds);
    const float side = ((uint32_t)(elapsedSeconds / WRITE_PERIOD) % 2) ? 1 : -1;
    pose.work = 1;
    pose.gap = 80.5f;
    if (cycle < 2) {
      float x;
      float y;
      writtenPoint(cycle, x, y);
      pose.x = (x - 156) * .95f;
      pose.y = 12 + (y - 178) * .7f;
      pose.left = 52.8f;
      pose.right = 52.8f;
      pose.gap = 82;
    } else {
      const Key horizontalKeys[] = {{0, 24.7f},         {2, 24.7f}, {2.45f, 0}, {2.9f, side * 23},
                                    {3.85f, side * 23}, {4.45f, 0}, {5.6f, 0}};
      const Key verticalKeys[] = {{0, 12},      {2, 12},    {2.45f, 0}, {2.9f, -21},
                                  {3.85f, -21}, {4.45f, 0}, {5.6f, 0}};
      pose.x = track(cycle, horizontalKeys);
      pose.y = track(cycle, verticalKeys);
      pose.left = 64.8f;
      pose.right = 64.8f;
    }
  } else if (!strcmp(state, "waiting")) {
    const Key lookKeys[] = {{0, 0},     {.5f, -16}, {1.5f, -16}, {2.3f, 16},
                            {3.3f, 16}, {3.9f, 0},  {4.8f, 0}};
    pose.x = track(elapsedSeconds, lookKeys);
    pose.y = -2;
    pose.left = 76.44f;
    pose.right = 76.44f;
    pose.width = 32.76f;
    pose.attention = 1;
    pose.amber = 1;
  } else if (!strcmp(state, "done")) {
    pose.happy = 1;
    pose.y = elapsedSeconds < .6f ? -4 * sinf(elapsedSeconds / .6f * 3.14159265358979323846f) : 0;
  } else if (!strcmp(state, "error")) {
    pose.failed = 1;
    pose.x = elapsedSeconds < .55f ? 4 * sinf(elapsedSeconds / .55f * 3.14159265358979323846f * 4) *
                                         (1 - elapsedSeconds / .55f)
                                   : 0;
  }
  // This pose only seeds smoothing when reconnecting. Offline eye geometry is
  // drawn independently by FaceRenderer::offline(), not from these dimensions.
  else if (!strcmp(state, "offline")) {
    pose.left = 21.84f;
    pose.right = 21.84f;
  }
  return pose;
}
}  // namespace FaceMotion
