#pragma once
#include <M5Unified.h>
#include <Preferences.h>
#include <SCSCL.h>
#include <PY32IOExpander.hpp>

// Pitch only: no broadcast writes, no yaw writes, no factory calibration writes.
class HeadMotion {
  SCSCL bus;
  m5::PY32IOExpander_Class power;
  int level=-1, zero=620, target=-1;
  bool ready=false, automatic=false;
  uint32_t changed=0;
  int desired=-1;
  bool valid(int pos){return pos>=0 && pos<=1000;}
  // User-confirmed horizontal may differ slightly from factory zero.
  bool calibrationValid(int pos){return valid(pos) && pos>=zero-16 && pos<=zero+16 && pos+64<=1000;}
  bool safe(int pos){return calibrationValid(level) && valid(pos) && pos>=level && pos<=level+64;}
  void move(int pos){
    if(!ready || !safe(pos) || pos==target)return;
    const int current=bus.ReadPos(2);
    if(!valid(current)){Serial.println("head read-failed; motion skipped");return;}
    // The servo executes the timed move; the display loop never waits for it.
    if(bus.WritePos(2,pos,900,0)!=1){Serial.println("head write-failed");return;}
    if(bus.EnableTorque(2,1)!=1){Serial.println("head torque-failed");return;}target=pos;
    Serial.printf("head target=%d from=%d duration=900ms\n",pos,current);
  }
public:
  void begin(){
    Preferences factory;
    if(factory.begin("servo",true)){zero=factory.getInt("zero_pos_2",620);factory.end();}
    if(!valid(zero)){Serial.println("head invalid-factory-zero");return;}
    if(!power.begin()){Serial.println("head power-expander-missing");return;}
    if(!power.setDirection(0,true)||!power.setPullMode(0,m5::IOExpander_Base::pull_up)||!power.digitalWrite(0,true)){Serial.println("head power-failed");return;}
    delay(200);
    if(!bus.begin(UART_NUM_1,1000000,6,7)){Serial.println("head uart-failed");return;}
    int pos=bus.ReadPos(2);
    if(!valid(pos)){Serial.println("head pitch-unavailable");return;}
    ready=true;
    Preferences prefs;
    if(prefs.begin("indicator-head",true)){level=prefs.getInt("level",-1);automatic=prefs.getBool("enabled",false);prefs.end();}
    if(!calibrationValid(level)){level=-1;automatic=false;}
    Serial.printf("head ready raw=%d factory-zero=%d level=%d automatic=%d\n",pos,zero,level,automatic);
  }
  void update(bool connected,const char* state){
    if(!ready)return;
    while(Serial.available()){
      char c=Serial.read();
      if(c=='h'){
        int pos=bus.ReadPos(2);
        if(!calibrationValid(pos)){Serial.println("head calibration-out-of-range");continue;}
        level=pos;target=pos;automatic=false;desired=-1;
        Preferences prefs;prefs.begin("indicator-head",false);prefs.putInt("level",level);prefs.putBool("enabled",false);prefs.end();
        Serial.printf("head horizontal-saved=%d\n",level);
      }
      if(c=='u' && level>=0){automatic=false;move(level+16);}
      if(c=='n' && level>=0){automatic=false;move(level);}
      if(c=='e' && level>=0){automatic=true;desired=-1;Preferences prefs;prefs.begin("indicator-head",false);prefs.putBool("enabled",true);prefs.end();Serial.println("head automatic-enabled rise=20deg");}
      if(c=='x'){automatic=false;bus.EnableTorque(2,0);Preferences prefs;prefs.begin("indicator-head",false);prefs.putBool("enabled",false);prefs.end();Serial.println("head disabled");}
    }
    if(!automatic||level<0)return;
    int next=target;
    if(!connected||!strcmp(state,"idle")||!strcmp(state,"sleep")||!strcmp(state,"sleepy"))next=level;
    else if(!strcmp(state,"thinking")||!strcmp(state,"running")||!strcmp(state,"editing")||!strcmp(state,"tool")||!strcmp(state,"searching")||!strcmp(state,"speaking"))next=level+64;
    if(next<0)next=level;
    if(desired!=next){desired=next;changed=millis();}
    if(millis()-changed>=350)move(desired);
  }
};
