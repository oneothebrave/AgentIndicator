#include <Arduino.h>
#include "head_policy.h"
#include "face_motion.h"
#include "status_message.h"

// This test firmware never initializes servos, power expander, Wi-Fi or NVS.
static int checks=0, failures=0;
#define CHECK(expression) do { checks++; if(!(expression)){failures++;Serial.printf("FAIL line=%d: %s\n",__LINE__,#expression);} } while(0)
static bool near(float a,float b){return fabsf(a-b)<.01f;}
static DecodedMessage decode(const char* s,bool ready=true){return decodeStatusMessage((const uint8_t*)s,strlen(s),ready);}

static void headTests() {
  HeadPolicy p;
  CHECK(p.next(1000,true,"running")==-1);
  CHECK(!HeadPolicy::validCalibration(0,620));
  CHECK(!HeadPolicy::validCalibration(950,950));
  CHECK(HeadPolicy::validCalibration(591,599));
  p.configure(591,599,true);
  CHECK(!p.safe(590));CHECK(!p.safe(656));CHECK(p.safe(655));
  CHECK(p.next(0,true,"idle")==-1);
  CHECK(p.next(349,true,"idle")==-1);
  CHECK(p.next(350,true,"idle")==591);p.succeeded(591);
  CHECK(p.next(1000,true,"idle")==-1);
  CHECK(p.next(1000,true,"thinking")==-1);
  CHECK(p.next(1349,true,"thinking")==-1);
  CHECK(p.next(1350,true,"thinking")==655);p.succeeded(655);
  for(const char* s:{"waiting","done","error","running","editing","tool","searching","speaking"}) CHECK(p.next(2000,true,s)==-1);
  p.disable(); CHECK(p.next(2500,true,"running")==-1);
  p.enable(); CHECK(p.next(2500,true,"running")==-1);
  CHECK(p.next(2850,true,"running")==655);p.succeeded(655);
  CHECK(p.next(3000,false,"error")==-1);
  CHECK(p.next(3350,false,"error")==591);p.succeeded(591);
  p.manual(607,3500);CHECK(p.next(3500,true,"idle")==607);p.succeeded(607);
  CHECK(p.next(4000,true,"running")==-1);
  p.enable();CHECK(p.next(4000,true,"running")==-1);
  CHECK(p.next(4350,true,"running")==655);p.failed(4350);
  CHECK(p.next(5349,true,"running")==-1);
  CHECK(p.next(5350,true,"running")==655);p.failed(5350);
  CHECK(p.next(6350,true,"running")==655);p.failed(6350);
  CHECK(p.faulted());CHECK(p.next(100000,false,"idle")==-1);
  p.enable();CHECK(!p.faulted());CHECK(p.next(100000,false,"idle")==-1);
  CHECK(p.next(100350,false,"idle")==591);
  p.configure(591,599,true);
  CHECK(p.next(0xfffffff0u,true,"running")==-1);
  CHECK(p.next(0x00000150u,true,"running")==655);
  p.configure(0,599,true);CHECK(!p.enabled());CHECK(p.next(10000,true,"running")==-1);
  p.configure(591,599,true);
  p.next(0,true,"idle");p.succeeded(591);
  p.next(100,true,"running");p.next(200,true,"idle");
  CHECK(p.next(500,true,"idle")==-1);
}
static void motionTests() {
  using namespace FaceMotion;
  CHECK(INK==0xb8bdc4);CHECK(ERROR==0xb51f32);CHECK(OFFLINE==0x808080);
  auto idle=target("idle",0);CHECK(near(idle.w,29.64f));CHECK(near(idle.left,67.08f));
  auto right=target("thinking",.8f),left=target("thinking",4.3f);
  CHECK(near(right.x,23));CHECK(near(left.x,-23));CHECK(near(left.y,-22));
  CHECK(near(right.left,left.right));CHECK(near(right.right,left.left));
  CHECK(near(WRITE_SECONDS,1.6666667f));CHECK(near(writingPhase(WRITE_SECONDS),2));
  CHECK(near(writingPhase(WRITE_PERIOD+.01f),.012f));
  float x,y;writtenPoint(writingPhase(.8f),x,y);
  auto writing=target("running",.8f);CHECK(near(writing.x,(x-156)*.95f));
  auto glance=target("running",3.f);CHECK(glance.x<0&&glance.y<0);
  auto nextGlance=target("running",WRITE_PERIOD+3.f);CHECK(nextGlance.x>0&&nextGlance.y<0);
  CHECK(wink(0)==0);CHECK(wink(.99f)>.99f);CHECK(wink(1.5f)==0);CHECK(wink(9)==0);
  CHECK(target("done",10).happy==1);CHECK(target("error",10).failed==1);
  CHECK(target("waiting",1).x<0);CHECK(target("waiting",3).x>0);
  CHECK(!strcmp(visual("editing"),"running"));CHECK(!strcmp(visual("speaking"),"thinking"));
}
static void protocolTests() {
  CHECK(decode("{bad").kind==MessageKind::BadJson);
  CHECK(decodeStatusMessage((const uint8_t*)"",8193,true).kind==MessageKind::Oversize);
  CHECK(decode(R"({"kind":"bridge.hello","version":1,"source":"codex","at":1})").kind==MessageKind::Hello);
  CHECK(decode(R"({"kind":"bridge.hello","version":2,"source":"codex","at":1})").kind==MessageKind::ProtocolError);
  CHECK(decode(R"({"kind":"bridge.hello","version":1})").kind==MessageKind::ProtocolError);
  CHECK(decode(R"({"kind":"future"})").kind==MessageKind::Ignored);
  CHECK(decode(R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"codex","type":"turn.completed"}})",false).kind==MessageKind::Ignored);
  CHECK(decode(R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"codex","type":"future"}})").kind==MessageKind::BadEvent);
  CHECK(decode(R"({"kind":"agent.event","event":{"id":"x","at":1,"origin":"bad","type":"turn.completed"}})").kind==MessageKind::BadEvent);
  for(const auto& row:EVENT_STATES) {
    char json[200];snprintf(json,sizeof(json),"{\"kind\":\"agent.event\",\"event\":{\"id\":\"test\",\"at\":1,\"origin\":\"codex\",\"type\":\"%s\"}}",row.event);
    const auto m=decode(json);CHECK(m.kind==MessageKind::Event);CHECK(m.event==&row);CHECK(!strcmp(m.origin,"codex"));
  }
  CHECK(decode(R"({"kind":"bridge.hello","version":1,"source":"codex","at":2})").kind==MessageKind::Hello);
  CHECK(decode(R"({"kind":"agent.event","event":{"id":"replay","at":2,"origin":"codex","type":"turn.failed"}})").event==findEventState("turn.failed"));
}
void setup(){Serial.begin(115200);delay(1800);headTests();motionTests();protocolTests();}
void loop(){Serial.printf("LOGIC_TEST_RESULT checks=%d failures=%d\n",checks,failures);delay(3000);}
