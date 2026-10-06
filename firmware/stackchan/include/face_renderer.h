#pragma once
#include <M5Unified.h>
#include <math.h>
#include <string.h>
#include "face_motion.h"

// Canonical design: docs/design/expression-design.md and video-motion-review-v5.html.
class FaceRenderer {
 public:
  bool begin() {
    canvas.setColorDepth(16);
    canvas.setPsram(true);
    ready = canvas.createSprite(320, 240) != nullptr;
    if (!ready) {
      canvas.setColorDepth(8);
      canvas.setPsram(false);
      ready = canvas.createSprite(320, 240) != nullptr;
    }
    Serial.printf("face design=motion-eyes-v5-silver framebuffer=%d\n", ready);
    return ready;
  }

  bool available() const {
    return ready;
  }

  void update(uint32_t now, bool connected, const char* state, bool visible,
              bool restartAnimation = false) {
    const char* next = connected ? visual(state) : "offline";
    if (strcmp(next, current) || restartAnimation) {
      current = next;
      changedAt = now;
      Serial.printf("face state=%s\n", current);
    }
    if (!ready || !visible || now - lastFrame < 33) {
      return;
    }
    const float deltaSeconds = lastFrame ? fminf((now - lastFrame) / 1000.f, .05f) : .033f;
    lastFrame = now;
    const float elapsedSeconds = (now - changedAt) / 1000.f;
    Pose targetPose = target(elapsedSeconds);
    const float smoothing = 1 - expf(-deltaSeconds * 12);
    smooth(pose.x, targetPose.x, smoothing);
    smooth(pose.y, targetPose.y, smoothing);
    smooth(pose.left, targetPose.left, smoothing);
    smooth(pose.right, targetPose.right, smoothing);
    smooth(pose.width, targetPose.width, smoothing);
    smooth(pose.gap, targetPose.gap, smoothing);
    smooth(pose.happy, targetPose.happy, smoothing);
    smooth(pose.failed, targetPose.failed, smoothing);
    smooth(pose.work, targetPose.work, smoothing);
    smooth(pose.thought, targetPose.thought, smoothing);
    smooth(pose.attention, targetPose.attention, smoothing);
    smooth(pose.amber, targetPose.amber, smoothing);
    canvas.fillScreen(rgb(BG));
    if (is("offline")) {
      offline(elapsedSeconds);
      canvas.pushSprite(0, 0);
      return;
    }
    const uint32_t eyeColor = blend(INK, FaceMotion::WAITING, pose.amber);
    float blink = 1;
    float phase = fmodf(elapsedSeconds, 5.7f);
    if (!is("done") && !is("error") && phase > 5.2f && phase < 5.38f) {
      blink = fabsf((phase - 5.29f) / .09f);
    }
    const float normal = fmaxf(0, 1 - pose.happy - pose.failed);
    if (normal > .01f) {
      for (int side = 0; side < 2; side++) {
        const float height = fmaxf(4, (side ? pose.right : pose.left) * blink);
        canvas.fillRoundRect(
            lroundf(160 + (side ? 1 : -1) * pose.gap / 2 + pose.x - pose.width / 2),
            lroundf(103 + pose.y - height / 2), lroundf(pose.width), lroundf(height),
            lroundf(fminf(height, pose.width) / 2), rgb(blend(BG, eyeColor, normal)));
      }
    }
    const float wink = is("done") ? FaceMotion::wink(elapsedSeconds) : 0;
    if (pose.happy > .01f) {
      for (int side = 0; side < 2; side++) {
        const float x = 160 + (side ? 43.7f : -43.7f);
        curve(x - 22.5f, x + 22.5f, 108 + pose.y, -45.f + 45.f * (side ? 0 : wink),
              rgb(blend(BG, INK, pose.happy)), 4);
      }
    }
    if (pose.failed > .01f) {
      for (int side = 0; side < 2; side++) {
        float x = side ? 217.f : 103.f;
        const auto color = rgb(blend(BG, FaceMotion::ERROR, pose.failed));
        stroke(x - 16.5f + pose.x, 86.5f, x + 16.5f + pose.x, 119.5f, color, 4);
        stroke(x + 16.5f + pose.x, 86.5f, x - 16.5f + pose.x, 119.5f, color, 4);
      }
    }
    if (pose.thought > .01f) {
      const auto color =
          rgb(blend(BG, INK, pose.thought * (.35f + .65f * fminf(1, fabsf(pose.x) / 12))));
      // Mirror around screen center, preserving the upward outward direction.
      canvas.fillCircle(pose.x < 0 ? 54 : 266, 37, 2, color);
      canvas.fillCircle(pose.x < 0 ? 43 : 277, 27, 3, color);
    }
    if (pose.attention > .01f) {
      canvas.fillCircle(
          160, 174, 3,
          rgb(blend(
              BG, FaceMotion::WAITING,
              pose.attention * (.35f + .65f * (1 - cosf(elapsedSeconds * 2 * PI / 3.6f)) / 2))));
    }
    if (pose.work > .01f) {
      writing(elapsedSeconds);
    }
    if (connected) {
      canvas.fillCircle(160, 220, 2, rgb(0x718080));
    }
    canvas.pushSprite(0, 0);
  }

 private:
  static constexpr uint32_t BG = FaceMotion::BG;
  static constexpr uint32_t INK = FaceMotion::INK;
  using Pose = FaceMotion::Pose;
  M5Canvas canvas{&M5.Display};
  Pose pose;
  bool ready = false;
  const char* current = "offline";
  uint32_t changedAt = 0;
  uint32_t lastFrame = 0;

  bool is(const char* state) const {
    return !strcmp(current, state);
  }

  static const char* visual(const char* state) {
    return FaceMotion::visual(state);
  }

  static float ease(float progress) {
    return FaceMotion::ease(progress);
  }

  static float writingPhase(float elapsedSeconds) {
    return FaceMotion::writingPhase(elapsedSeconds);
  }

  static void smooth(float& value, float targetPose, float smoothing) {
    value += (targetPose - value) * smoothing;
  }

  Pose target(float elapsedSeconds) {
    return FaceMotion::target(current, elapsedSeconds);
  }

  static uint32_t blend(uint32_t fromColor, uint32_t toColor, float progress) {
    progress = fmaxf(0, fminf(1, progress));
    uint32_t value = 0;
    for (int shift = 0; shift <= 16; shift += 8) {
      float startChannel = (fromColor >> shift) & 255;
      float endChannel = (toColor >> shift) & 255;
      value |= (uint32_t)lroundf(startChannel + (endChannel - startChannel) * progress) << shift;
    }
    return value;
  }

  uint16_t rgb(uint32_t color) {
    return canvas.color565(color >> 16, (color >> 8) & 255, color & 255);
  }

  void stroke(float startX, float startY, float endX, float endY, uint16_t color, int radius) {
    int stepCount = (int)fmaxf(fabsf(endX - startX), fabsf(endY - startY)) + 1;
    for (int index = 0; index <= stepCount; index++) {
      float progress = (float)index / stepCount;
      canvas.fillCircle(lroundf(startX + (endX - startX) * progress),
                        lroundf(startY + (endY - startY) * progress), radius, color);
    }
  }

  void curve(float left, float right, float y, float bend, uint16_t color, int radius) {
    float previousX = left;
    float previousY = y;
    for (int index = 1; index <= 24; index++) {
      float progress = index / 24.f;
      float x = left + (right - left) * progress;
      float currentY = y + 2 * bend * progress * (1 - progress);
      stroke(previousX, previousY, x, currentY, color, radius);
      previousX = x;
      previousY = currentY;
    }
  }

  static const float (&writingPoints())[9][2] {
    return FaceMotion::writingPoints();
  }

  static void writtenPoint(float cycle, float& x, float& y) {
    FaceMotion::writtenPoint(cycle, x, y);
  }

  void offline(float elapsedSeconds) {
    const auto eye = rgb(FaceMotion::OFFLINE);
    canvas.fillRoundRect(102, 78, 29, 58, 14, eye);
    canvas.fillRoundRect(189, 78, 29, 58, 14, eye);
    stroke(129, 95, 141, 95, eye, 2);
    stroke(129, 119, 141, 119, eye, 2);
    stroke(199, 97, 199, 103, rgb(BG), 2);
    stroke(208, 111, 208, 117, rgb(BG), 2);
    const float points[][2] = {{120, 177}, {140, 177}, {148, 172}, {155, 184},
                               {163, 163}, {171, 181}, {178, 177}, {200, 177}};
    float lengths[7];
    float total = 0;
    const float alpha = .4f + .6f * (1 - cosf(elapsedSeconds * 2 * PI / 3.2f)) / 2;
    const auto line = rgb(blend(BG, FaceMotion::OFFLINE, alpha));
    for (int index = 0; index < 7; index++) {
      lengths[index] =
          hypotf(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
      total += lengths[index];
      stroke(points[index][0], points[index][1], points[index + 1][0], points[index + 1][1], line,
             1);
    }
    float distance = fmodf(elapsedSeconds, 3.2f) / 3.2f * total;
    for (int index = 0; index < 7; index++) {
      if (distance <= lengths[index]) {
        float progress = distance / lengths[index];
        canvas.fillCircle(
            lroundf(points[index][0] + progress * (points[index + 1][0] - points[index][0])),
            lroundf(points[index][1] + progress * (points[index + 1][1] - points[index][1])), 3,
            rgb(blend(BG, 0xb0b0b0, alpha)));
        break;
      }
      distance -= lengths[index];
    }
  }

  void writing(float elapsedSeconds) {
    const float cycle = writingPhase(elapsedSeconds);
    const auto& points = writingPoints();
    float progress = fminf(1, cycle / 2) * 8;
    int index = (int)fminf(7, floorf(progress));
    float x;
    float y;
    writtenPoint(cycle, x, y);
    float alpha = pose.work * (1 - ease((cycle - 2.1f) / .3f));
    if (alpha > .01f && cycle > 0) {
      auto color = rgb(blend(BG, INK, alpha));
      for (int index = 0; index < index; index++) {
        stroke(points[index][0], points[index][1], points[index + 1][0], points[index + 1][1],
               color, 1);
      }
      stroke(points[index][0], points[index][1], x, y, color, 1);
    }
    float penOpacity = 1;
    if (cycle >= 2) {
      y -= 8 * ease((cycle - 2) / .3f);
      penOpacity = 1 - ease((cycle - 2.1f) / .3f);
    }
    if (cycle >= 4.8f) {
      x = 130;
      y = 180 - 8 * (1 - ease((cycle - 4.8f) / .6f));
      penOpacity = ease((cycle - 4.8f) / .6f);
    }
    alpha = pose.work * penOpacity;
    if (alpha < .01f) {
      return;
    }
    auto color = rgb(blend(BG, INK, alpha));
    canvas.fillTriangle(x + 3.45f, y - 11.5f, x + 17.25f, y - 33.35f, x + 25.3f, y - 26.45f, color);
    canvas.fillTriangle(x + 3.45f, y - 11.5f, x + 25.3f, y - 26.45f, x + 11.5f, y - 5.75f, color);
    stroke(x + 19.55f, y - 33.35f, x + 24.15f, y - 29.9f, color, 3);
    canvas.fillTriangle(x, y, x + 3.45f, y - 11.5f, x + 11.5f, y - 5.75f,
                        rgb(blend(BG, 0xf0e7dc, alpha)));
    canvas.fillTriangle(x, y, x + 2.3f, y - 5.75f, x + 5.75f, y - 2.3f,
                        rgb(blend(BG, 0x8d7dac, alpha)));
    stroke(x + 16.1f, y - 31.05f, x + 24.15f, y - 25.3f, rgb(blend(BG, 0x827494, alpha)), 1);
    stroke(x + 6.9f, y - 13.8f, x + 18.4f, y - 29.9f, rgb(blend(BG, 0xf5efff, alpha)), 1);
  }
};
