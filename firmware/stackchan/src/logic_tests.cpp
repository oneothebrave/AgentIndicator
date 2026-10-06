#include <Arduino.h>
#include "head_policy.h"
#include "face_motion.h"
#include "status_message.h"

// This test firmware never initializes servos, power expander, Wi-Fi or NVS.
static int checks = 0;
static int failures = 0;
static int failedLines[32] = {};
#define CHECK(expression)                                         \
  do {                                                            \
    checks++;                                                     \
    if (!(expression)) {                                          \
      failures++;                                                 \
      if (failures <= 32) {                                       \
        failedLines[failures - 1] = __LINE__;                     \
      }                                                           \
      Serial.printf("FAIL line=%d: %s\n", __LINE__, #expression); \
    }                                                             \
  } while (0)

static bool near(float actual, float expected) {
  return fabsf(actual - expected) < .01f;
}

static DecodedMessage decode(const char* json, bool ready = true) {
  return decodeStatusMessage((const uint8_t*)json, strlen(json), ready);
}

static void headTests() {
  HeadPolicy policy;
  CHECK(policy.next(1000, true, "running") == -1);
  CHECK(!HeadPolicy::validCalibration(0, 620));
  CHECK(!HeadPolicy::validCalibration(950, 950));
  CHECK(HeadPolicy::validCalibration(591, 599));
  policy.configure(591, 599, true);
  CHECK(!policy.safe(590));
  CHECK(!policy.safe(656));
  CHECK(policy.safe(655));
  CHECK(policy.next(0, true, "idle") == -1);
  CHECK(policy.next(349, true, "idle") == -1);
  CHECK(policy.next(350, true, "idle") == 591);
  policy.succeeded(591);
  CHECK(policy.next(1000, true, "idle") == -1);
  CHECK(policy.next(1000, true, "thinking") == -1);
  CHECK(policy.next(1349, true, "thinking") == -1);
  CHECK(policy.next(1350, true, "thinking") == 655);
  policy.succeeded(655);
  for (const char* state :
       {"waiting", "done", "error", "running", "editing", "tool", "searching", "speaking"}) {
    CHECK(policy.next(2000, true, state) == -1);
  }
  policy.disable();
  CHECK(policy.next(2500, true, "running") == -1);
  policy.enable();
  CHECK(policy.next(2500, true, "running") == -1);
  CHECK(policy.next(2850, true, "running") == 655);
  policy.succeeded(655);
  CHECK(policy.next(3000, false, "error") == -1);
  CHECK(policy.next(3350, false, "error") == 591);
  policy.succeeded(591);
  policy.manual(607, 3500);
  CHECK(policy.next(3500, true, "idle") == 607);
  policy.succeeded(607);
  CHECK(policy.next(4000, true, "running") == -1);
  policy.enable();
  CHECK(policy.next(4000, true, "running") == -1);
  CHECK(policy.next(4350, true, "running") == 655);
  policy.failed(4350);
  CHECK(policy.next(5349, true, "running") == -1);
  CHECK(policy.next(5350, true, "running") == 655);
  policy.failed(5350);
  CHECK(policy.next(6350, true, "running") == 655);
  policy.failed(6350);
  CHECK(policy.faulted());
  CHECK(policy.next(100000, false, "idle") == -1);
  policy.enable();
  CHECK(!policy.faulted());
  CHECK(policy.next(100000, false, "idle") == -1);
  CHECK(policy.next(100350, false, "idle") == 591);
  policy.configure(591, 599, true);
  CHECK(policy.next(0xfffffff0u, true, "running") == -1);
  CHECK(policy.next(0x00000150u, true, "running") == 655);
  policy.configure(0, 599, true);
  CHECK(!policy.enabled());
  CHECK(policy.next(10000, true, "running") == -1);
  policy.configure(591, 599, true);
  policy.next(0, true, "idle");
  policy.succeeded(591);
  policy.next(100, true, "running");
  policy.next(200, true, "idle");
  CHECK(policy.next(500, true, "idle") == -1);
}

static void motionTests() {
  using namespace FaceMotion;
  CHECK(INK == 0xb8bdc4);
  CHECK(ERROR == 0xb51f32);
  CHECK(OFFLINE == 0x808080);
  auto idle = target("idle", 0);
  CHECK(near(idle.width, 29.64f));
  CHECK(near(idle.left, 67.08f));
  auto right = target("thinking", .8f);
  auto left = target("thinking", 4.3f);
  CHECK(near(right.x, 23));
  CHECK(near(left.x, -23));
  CHECK(near(left.y, -22));
  CHECK(near(right.left, left.right));
  CHECK(near(right.right, left.left));
  CHECK(near(WRITE_SECONDS, 1.6666667f));
  CHECK(near(writingPhase(WRITE_SECONDS), 2));
  CHECK(near(writingPhase(WRITE_PERIOD + .01f), .012f));
  float x;
  float y;
  writtenPoint(writingPhase(.8f), x, y);
  auto writing = target("running", .8f);
  CHECK(near(writing.x, (x - 156) * .95f));
  auto glance = target("running", 3.f);
  CHECK(glance.x < 0 && glance.y < 0);
  auto nextGlance = target("running", WRITE_PERIOD + 3.f);
  CHECK(nextGlance.x > 0 && nextGlance.y < 0);
  CHECK(wink(0) == 0);
  CHECK(wink(.99f) > .99f);
  CHECK(wink(1.5f) == 0);
  CHECK(wink(9) == 0);
  CHECK(target("done", 10).happy == 1);
  CHECK(target("error", 10).failed == 1);
  CHECK(target("waiting", 1).x < 0);
  CHECK(target("waiting", 3).x > 0);
  CHECK(!strcmp(visual("editing"), "running"));
  CHECK(!strcmp(visual("speaking"), "thinking"));
}

static void protocolTests() {
  CHECK(decode("{bad").kind == MessageKind::BadJson);
  CHECK(decodeStatusMessage((const uint8_t*)"", 8193, true).kind == MessageKind::Oversize);
  CHECK(decode(R"({"kind":"bridge.hello","version":1,"source":"codex","at":1})").kind ==
        MessageKind::Hello);
  CHECK(decode(R"({"kind":"bridge.hello","version":2,"source":"codex","at":1})").kind ==
        MessageKind::ProtocolError);
  CHECK(decode(R"({"kind":"bridge.hello","version":1})").kind == MessageKind::ProtocolError);
  CHECK(decode(R"({"kind":"future"})").kind == MessageKind::Ignored);
  CHECK(
      decode(
          R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"codex","type":"turn.completed"}})",
          false)
          .kind == MessageKind::Ignored);
  CHECK(
      decode(R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"codex","type":"future"}})")
          .kind == MessageKind::BadEvent);
  CHECK(
      decode(
          R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"bad","type":"turn.completed"}})")
          .kind == MessageKind::BadEvent);
  for (const auto& row : EVENT_STATES) {
    char json[200];
    snprintf(json, sizeof(json),
             "{\"kind\":\"agent.event\",\"event\":{\"id\":\"test\",\"at\":1,\"origin\":\"codex\","
             "\"type\":\"%s\"}}",
             row.event);
    const auto message = decode(json);
    CHECK(message.kind == MessageKind::Event);
    CHECK(message.event == &row);
    CHECK(!strcmp(message.origin, "codex"));
  }
  CHECK(decode(R"({"kind":"bridge.hello","version":1,"source":"codex","at":2})").kind ==
        MessageKind::Hello);
  CHECK(
      decode(
          R"({"kind":"agent.event","event":{"id":"replay","at":2,"origin":"codex","type":"turn.failed"}})")
          .event == findEventState("turn.failed"));
  const auto owned = decode(
      R"({"kind":"agent.event","event":{"id":"owned-id","at":123,"origin":"codex","type":"turn.completed"}})");
  CHECK(!strcmp(owned.id, "owned-id"));
  CHECK(owned.at == 123);
  CHECK(decode(R"({"kind":"bridge.hello","version":1,"source":"codex","at":456})").at == 456);
  CHECK(
      decode(
          R"({"kind":"agent.event","event":{"id":"","at":1,"origin":"codex","type":"turn.completed"}})")
          .kind == MessageKind::BadEvent);
  char oversizedId[600];
  char id[258];
  memset(id, 'x', sizeof(id) - 1);
  id[sizeof(id) - 1] = 0;
  snprintf(oversizedId, sizeof(oversizedId),
           "{\"kind\":\"agent.event\",\"event\":{\"id\":\"%s\",\"at\":1,\"origin\":\"codex\","
           "\"type\":\"turn.completed\"}}",
           id);
  CHECK(decode(oversizedId).kind == MessageKind::BadEvent);
}

static void presentationTests() {
  // The bounded ID history is larger than the Arduino loop task's stack.
  static PresentationPolicy policy;
  const auto done = findEventState("turn.completed");
  const auto thinking = findEventState("turn.started");
  CHECK(!strcmp(policy.state(), "offline"));
  CHECK(!policy.receive(done, "before-hello", 101, 0));
  policy.hello(100);
  CHECK(!strcmp(policy.state(), "idle"));
  CHECK(policy.receive(done, "first-live", 101, 1000));
  CHECK(!strcmp(policy.state(), "done"));
  CHECK(policy.celebrationGeneration() == 1);
  CHECK(!policy.tick(5999));
  CHECK(!policy.receive(done, "first-live", 101, 5999));
  CHECK(policy.tick(6000));
  CHECK(!strcmp(policy.state(), "idle"));
  CHECK(policy.lastEvent() == done);
  CHECK(policy.completionSettled());
  CHECK(!policy.tick(7000));
  CHECK(!policy.receive(done, "first-live", 101, 8000));
  CHECK(!strcmp(policy.state(), "idle"));

  CHECK(policy.receive(done, "next-live", 102, 9000));
  CHECK(policy.celebrationGeneration() == 2);
  CHECK(!policy.completionSettled());
  CHECK(policy.receive(thinking, "new-turn", 103, 10000));
  CHECK(!policy.tick(14000));
  CHECK(!strcmp(policy.state(), "thinking"));
  for (const char* type : {"approval.requested", "turn.failed", "command.started", "thread.idle"}) {
    CHECK(policy.receive(done, type, 110, 20000));
    const auto next = findEventState(type);
    CHECK(policy.receive(next, "preempt", 111, 22000));
    CHECK(!policy.tick(30000));
    CHECK(!strcmp(policy.state(), next->state));
  }

  CHECK(policy.receive(done, "disconnect-live", 112, 31000));
  policy.disconnect();
  CHECK(!strcmp(policy.state(), "offline"));
  CHECK(!policy.tick(50000));
  policy.hello(200);
  CHECK(policy.receive(done, "disconnect-live", 112, 50000));
  CHECK(!strcmp(policy.state(), "idle"));
  CHECK(policy.completionSettled());
  CHECK(policy.lastEvent() == done);
  policy.hello(300);
  CHECK(policy.receive(done, "unknown-old-snapshot", 299, 60000));
  CHECK(!strcmp(policy.state(), "idle"));
  policy.hello(400);
  CHECK(policy.receive(done, "equal-clock-snapshot", 400, 61000));
  CHECK(!strcmp(policy.state(), "idle"));
  policy.hello(500);
  CHECK(policy.receive(done, "new-after-hello", 501, 0xfffffff0u));
  CHECK(!policy.tick(0x00001377u));
  CHECK(policy.tick(0x00001378u));
  CHECK(!strcmp(policy.state(), "idle"));

  // The derived idle state, rather than the raw completion, controls the head.
  HeadPolicy head;
  head.configure(591, 599, true);
  head.next(0, true, "thinking");
  CHECK(head.next(350, true, "thinking") == 655);
  head.succeeded(655);
  CHECK(head.next(1000, true, "done") == -1);
  CHECK(head.next(5000, true, policy.state()) == -1);
  CHECK(head.next(5350, true, policy.state()) == 591);
  CHECK(!policy.receive(nullptr, "bad", 600, 0));
  CHECK(!policy.receive(done, nullptr, 600, 0));
}

void setup() {
  Serial.begin(115200);
  delay(1800);
  headTests();
  motionTests();
  protocolTests();
  presentationTests();
}

void loop() {
  Serial.printf("LOGIC_TEST_RESULT checks=%d failures=%d\n", checks, failures);
  for (int index = 0; index < failures && index < 32; ++index) {
    Serial.printf("FAIL line=%d\n", failedLines[index]);
  }
  delay(3000);
}
