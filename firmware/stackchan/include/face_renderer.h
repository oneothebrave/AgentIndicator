#pragma once
#include <M5Unified.h>
#include <math.h>
#include <string.h>
#include "face_motion.h"

// Canonical design: docs/design/willump-face-preview.html (study 03).
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
    Serial.printf("face design=%s framebuffer=%d\n", FaceMotion::DESIGN, ready);
    return ready;
  }

  bool available() const {
    return ready;
  }

  void update(uint32_t now, bool connected, const char* state, bool visible,
              bool restartAnimation = false) {
    const char* next = connected ? FaceMotion::visual(state) : "offline";
    if (strcmp(next, current) || restartAnimation) {
      current = next;
      changedAt = now;
      pose = FaceMotion::target(current, 0);
      Serial.printf("face state=%s\n", current);
    }
    if (!ready || !visible || now - lastFrame < 33) {
      return;
    }
    const float dt = lastFrame ? fminf((now - lastFrame) / 1000.f, .05f) : .033f;
    lastFrame = now;
    const float elapsedSeconds = (now - changedAt) / 1000.f;
    const auto target = FaceMotion::target(current, elapsedSeconds);
    const float smoothing = 1 - expf(-dt * 12);
    smooth(pose.x, target.x, smoothing);
    smooth(pose.y, target.y, smoothing);
    background = is("error") ? FaceMotion::ERROR_BG : FaceMotion::BG;
    canvas.fillScreen(rgb(background));
    if (is("idle") || is("done")) {
      smileFace(elapsedSeconds);
    } else if (is("thinking")) {
      thinking(elapsedSeconds);
    } else if (is("running")) {
      running(elapsedSeconds);
    } else if (is("waiting")) {
      waiting(elapsedSeconds);
    } else if (is("error")) {
      error(elapsedSeconds);
    } else {
      offline();
    }
    canvas.fillCircle(160, 220, 2, rgb(connected ? 0x397080 : 0x303944));
    canvas.pushSprite(0, 0);
  }

 private:
  static constexpr uint32_t INK = FaceMotion::INK;
  M5Canvas canvas{&M5.Display};
  FaceMotion::Pose pose;
  bool ready = false;
  const char* current = "offline";
  uint32_t changedAt = 0;
  uint32_t lastFrame = 0;
  uint32_t background = FaceMotion::BG;

  bool is(const char* state) const {
    return !strcmp(current, state);
  }

  static void smooth(float& value, float target, float smoothing) {
    value += (target - value) * smoothing;
  }

  static uint32_t blend(uint32_t from, uint32_t to, float progress) {
    progress = fmaxf(0, fminf(1, progress));
    uint32_t result = 0;
    for (int shift = 0; shift <= 16; shift += 8) {
      const float start = (from >> shift) & 255;
      result |= (uint32_t)lroundf(start + (((to >> shift) & 255) - start) * progress) << shift;
    }
    return result;
  }

  uint16_t rgb(uint32_t color) {
    return canvas.color565(color >> 16, (color >> 8) & 255, color & 255);
  }

  // 4px LED pitch, 3px cores and a dim surround; no texture or blur buffer.
  void pixel(int x, int y, uint32_t color) {
    canvas.fillRect(x * 4 - 1, y * 4 - 1, 5, 5, rgb(blend(background, color, .18f)));
    canvas.fillRect(x * 4, y * 4, 3, 3, rgb(color));
  }

  void rect(int x, int y, int width, int height, uint32_t color) {
    for (int row = 0; row < height; row++) {
      for (int column = 0; column < width; column++) {
        pixel(x + column, y + row, color);
      }
    }
  }

  void line(int x0, int y0, int x1, int y1, uint32_t color) {
    const int dx = abs(x1 - x0);
    const int sx = x0 < x1 ? 1 : -1;
    const int dy = -abs(y1 - y0);
    const int sy = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    for (;;) {
      pixel(x0, y0, color);
      if (x0 == x1 && y0 == y1) {
        break;
      }
      const int twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }

  void thickLine(int x0, int y0, int x1, int y1, uint32_t color) {
    const int steps = (int)fmaxf(abs(x1 - x0), abs(y1 - y0));
    for (int index = 0; index <= steps; index++) {
      const float progress = steps ? (float)index / steps : 0;
      rect(lroundf(x0 + (x1 - x0) * progress), lroundf(y0 + (y1 - y0) * progress), 2, 2, color);
    }
  }

  void eye(int x, int y, float lift) {
    const int peak = lroundf(lift);
    for (int row = 0; row < 2; row++) {
      line(x - 6, y + row, x - 2, y - peak + row, INK);
      line(x - 2, y - peak + row, x + 2, y - peak + row, INK);
      line(x + 2, y - peak + row, x + 6, y + row, INK);
    }
  }

  void smile(int dx, int dy) {
    for (int row = 0; row < 3; row++) {
      line(24 + dx, 36 + dy + row, 27 + dx, 41 + dy + row, INK);
      line(27 + dx, 41 + dy + row, 53 + dx, 41 + dy + row, INK);
      line(53 + dx, 41 + dy + row, 56 + dx, 36 + dy + row, INK);
      line(21 + dx, 34 + dy + row, 23 + dx, 34 + dy + row, INK);
      line(57 + dx, 34 + dy + row, 59 + dx, 34 + dy + row, INK);
    }
  }

  void smileFace(float elapsedSeconds) {
    const int dx = lroundf(pose.x / 4);
    const int dy = lroundf(pose.y / 8);
    if (is("done")) {
      eye(28, 24 + dy, 5 * (1 - FaceMotion::wink(elapsedSeconds)));
      eye(52, 24 + dy, 5);
      smile(0, dy);
    } else {
      const float blink = FaceMotion::blink(elapsedSeconds);
      eye(28 + dx, 24 + dy, (2 + (pose.left - 50) / 16) * blink);
      eye(52 + dx, 24 + dy, (2 + (pose.right - 50) / 16) * blink);
      smile(dx / 2, dy / 2);
    }
  }

  void thinking(float elapsedSeconds) {
    rect(24, 21, 5, 2, INK);
    rect(51, 21, 5, 2, INK);
    const int height = FaceMotion::mouthHeight(elapsedSeconds);
    const int top = 36 - height / 2;
    rect(21, top, 38, 2, INK);
    rect(21, top + height - 2, 38, 2, INK);
    rect(21, top, 2, height, INK);
    rect(57, top, 2, height, INK);
  }

  void running(float elapsedSeconds) {
    const auto pong = FaceMotion::pongAt(elapsedSeconds);
    rect(16, lroundf((pong.leftY - 24) / 4), 2, 12, INK);
    rect(62, lroundf((pong.rightY - 24) / 4), 2, 12, INK);
    const int x = lroundf(pong.x / 4);
    const int y = lroundf(pong.y / 4);
    rect(x, y - 1, 1, 3, INK);
    rect(x - 1, y, 3, 1, INK);
  }

  void waiting(float elapsedSeconds) {
    const int height = (int)fmaxf(1, lroundf(8 * FaceMotion::blink(elapsedSeconds, 6.8f, 6.29f)));
    rect(24, 25 - height / 2, 8, height, INK);
    rect(48, 25 - height / 2, 8, height, INK);
    rect(29, 41, 22, 2, INK);
  }

  void error(float elapsedSeconds) {
    const int dx = FaceMotion::errorOffset(elapsedSeconds);
    thickLine(23 + dx, 21, 28 + dx, 26, FaceMotion::ERROR);
    thickLine(28 + dx, 26, 23 + dx, 31, FaceMotion::ERROR);
    thickLine(55 + dx, 21, 50 + dx, 26, FaceMotion::ERROR);
    thickLine(50 + dx, 26, 55 + dx, 31, FaceMotion::ERROR);
    rect(35 + dx, 41, 10, 2, FaceMotion::ERROR_MOUTH);
  }

  void offline() {
    for (const int center : {28, 52}) {
      thickLine(center - 4, 19, center + 4, 27, FaceMotion::OFFLINE);
      thickLine(center + 4, 19, center - 4, 27, FaceMotion::OFFLINE);
    }
    const int mouth[][2] = {{26, 37}, {29, 40}, {34, 42}, {40, 43}, {46, 42}, {51, 40}, {54, 37}};
    for (int index = 1; index < 7; index++) {
      thickLine(mouth[index - 1][0], mouth[index - 1][1], mouth[index][0], mouth[index][1],
                FaceMotion::OFFLINE);
    }
  }
};
