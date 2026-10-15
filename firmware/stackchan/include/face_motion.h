#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace FaceMotion {
constexpr const char* DESIGN = "willump-led-v3";
constexpr uint32_t BG = 0x060e18;
constexpr uint32_t INK = 0x49d9ff;
constexpr uint32_t ERROR_BG = 0x230913;
constexpr uint32_t ERROR = 0xff775c;
constexpr uint32_t ERROR_MOUTH = 0xffa174;
constexpr uint32_t OFFLINE = INK;
constexpr float THINK_PERIOD = 2.4f;
constexpr float FLIGHT_SECONDS = 1.4f;

// Idle and completion keep the approved preview's gaze and wink timing.
struct Pose {
  float x = 0;
  float y = 0;
  float left = 67.08f;
  float right = 67.08f;
  float happy = 0;
};

struct PongPose {
  float x;
  float y;
  float leftY;
  float rightY;
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
      const float progress = ease((elapsedSeconds - keys[index - 1].elapsedSeconds) /
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

inline float wink(float elapsedSeconds) {
  return elapsedSeconds >= .85f && elapsedSeconds <= 1.13f
             ? sinf((elapsedSeconds - .85f) / .28f * 3.14159265358979323846f)
             : 0;
}

inline float blink(float elapsedSeconds, float period = 5.7f, float center = 5.29f) {
  const float phase = fmodf(elapsedSeconds, period);
  return phase > center - .09f && phase < center + .09f ? fabsf((phase - center) / .09f) : 1;
}

inline Pose target(const char* state, float elapsedSeconds) {
  Pose pose;
  if (!strcmp(state, "idle")) {
    const Key keys[] = {{0, 0}, {1.8f, 0}, {2.2f, 8}, {3.4f, 8}, {3.9f, 0}, {7.2f, 0}};
    pose.x = track(elapsedSeconds, keys);
    pose.y = -2;
  } else if (!strcmp(state, "done")) {
    pose.happy = 1;
    pose.y = elapsedSeconds < .6f ? -4 * sinf(elapsedSeconds / .6f * 3.14159265358979323846f) : 0;
  }
  return pose;
}

inline float mouthOpening(float elapsedSeconds) {
  const Key keys[] = {{0, 1}, {.55f, 1}, {.9f, 0}, {1.5f, 0}, {1.85f, 1}, {THINK_PERIOD, 1}};
  return track(elapsedSeconds, keys);
}

inline int mouthHeight(float elapsedSeconds) {
  return 4 + lroundf(9 * mouthOpening(elapsedSeconds));
}

inline float reflected(float value, float span) {
  const float period = span * 2;
  const float phase = fmodf(fmodf(value, period) + period, period);
  return phase < span ? phase : period - phase;
}

inline float ballY(float elapsedSeconds) {
  return 52 + reflected(48 + elapsedSeconds * 58, 136);
}

inline float paddleY(float elapsedSeconds, float firstHit) {
  const float period = FLIGHT_SECONDS * 2;
  const float previousHit = firstHit + floorf((elapsedSeconds - firstHit) / period) * period;
  const float progress = ease((elapsedSeconds - previousHit) / period);
  // Both paddles reach the actual ball height at their respective impacts.
  return ballY(previousHit) + (ballY(previousHit + period) - ballY(previousHit)) * progress;
}

inline PongPose pongAt(float elapsedSeconds) {
  return {76 + reflected(elapsedSeconds / FLIGHT_SECONDS, 1) * 164, ballY(elapsedSeconds),
          paddleY(elapsedSeconds, 0), paddleY(elapsedSeconds, FLIGHT_SECONDS)};
}

inline int errorOffset(float elapsedSeconds) {
  return elapsedSeconds < .55f ? lroundf(sinf(elapsedSeconds / .55f * 3.14159265358979323846f * 4) *
                                         (1 - elapsedSeconds / .55f))
                               : 0;
}

}  // namespace FaceMotion
