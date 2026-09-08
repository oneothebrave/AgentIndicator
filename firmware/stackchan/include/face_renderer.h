#pragma once
#include <M5Unified.h>
#include <math.h>
#include <string.h>
#include "face_motion.h"

// Canonical design: docs/design/expression-design.md and video-motion-review-v5.html.
class FaceRenderer {
 public:
  bool begin() {
    canvas.setColorDepth(16); canvas.setPsram(true);
    ready=canvas.createSprite(320,240)!=nullptr;
    if(!ready){canvas.setColorDepth(8);canvas.setPsram(false);ready=canvas.createSprite(320,240)!=nullptr;}
    Serial.printf("face design=motion-eyes-v5-silver framebuffer=%d\n",ready);
    return ready;
  }
  bool available() const {return ready;}
  void update(uint32_t now,bool connected,const char* state,bool visible){
    const char* next=connected?visual(state):"offline";
    if(strcmp(next,current)){current=next;changedAt=now;Serial.printf("face state=%s\n",current);}
    if(!ready||!visible||now-lastFrame<33)return;
    const float dt=lastFrame?fminf((now-lastFrame)/1000.f,.05f):.033f;
    lastFrame=now;const float t=(now-changedAt)/1000.f;
    Pose q=target(t);const float k=1-expf(-dt*12);
    smooth(p.x,q.x,k);smooth(p.y,q.y,k);smooth(p.left,q.left,k);smooth(p.right,q.right,k);
    smooth(p.w,q.w,k);smooth(p.gap,q.gap,k);smooth(p.happy,q.happy,k);smooth(p.failed,q.failed,k);
    smooth(p.work,q.work,k);smooth(p.thought,q.thought,k);smooth(p.attention,q.attention,k);smooth(p.amber,q.amber,k);
    canvas.fillScreen(rgb(BG));
    if(is("offline")){offline(t);canvas.pushSprite(0,0);return;}
    const uint32_t eyeColor=blend(INK,FaceMotion::WAITING,p.amber);
    float blink=1,phase=fmodf(t,5.7f);
    if(!is("done")&&!is("error")&&phase>5.2f&&phase<5.38f)blink=fabsf((phase-5.29f)/.09f);
    const float normal=fmaxf(0,1-p.happy-p.failed);
    if(normal>.01f)for(int side=0;side<2;side++){
      const float h=fmaxf(4,(side?p.right:p.left)*blink);
      canvas.fillRoundRect(lroundf(160+(side?1:-1)*p.gap/2+p.x-p.w/2),lroundf(103+p.y-h/2),lroundf(p.w),lroundf(h),lroundf(fminf(h,p.w)/2),rgb(blend(BG,eyeColor,normal)));
    }
    const float wink=is("done")?FaceMotion::wink(t):0;
    if(p.happy>.01f)for(int side=0;side<2;side++){
      const float x=160+(side?43.7f:-43.7f);
      curve(x-22.5f,x+22.5f,108+p.y,-45.f+45.f*(side?0:wink),rgb(blend(BG,INK,p.happy)),4);
    }
    if(p.failed>.01f)for(int side=0;side<2;side++){
      float x=side?217.f:103.f;const auto c=rgb(blend(BG,FaceMotion::ERROR,p.failed));
      stroke(x-16.5f+p.x,86.5f,x+16.5f+p.x,119.5f,c,4);stroke(x+16.5f+p.x,86.5f,x-16.5f+p.x,119.5f,c,4);
    }
    if(p.thought>.01f){
      const auto c=rgb(blend(BG,INK,p.thought*(.35f+.65f*fminf(1,fabsf(p.x)/12))));
      // Mirror around screen center, preserving the upward outward direction.
      canvas.fillCircle(p.x<0?54:266,37,2,c);canvas.fillCircle(p.x<0?43:277,27,3,c);
    }
    if(p.attention>.01f)canvas.fillCircle(160,174,3,rgb(blend(BG,FaceMotion::WAITING,p.attention*(.35f+.65f*(1-cosf(t*2*PI/3.6f))/2))));
    if(p.work>.01f)writing(t);
    if(connected)canvas.fillCircle(160,220,2,rgb(0x718080));
    canvas.pushSprite(0,0);
  }
 private:
  static constexpr uint32_t BG=FaceMotion::BG,INK=FaceMotion::INK;
  using Pose=FaceMotion::Pose;
  M5Canvas canvas{&M5.Display};Pose p;bool ready=false;
  const char* current="offline";uint32_t changedAt=0,lastFrame=0;
  bool is(const char* s)const{return !strcmp(current,s);}
  static const char* visual(const char* s){return FaceMotion::visual(s);}
  static float ease(float u){return FaceMotion::ease(u);}
  static float writingPhase(float t){return FaceMotion::writingPhase(t);}
  static void smooth(float& v,float q,float k){v+=(q-v)*k;}
  Pose target(float t){return FaceMotion::target(current,t);}
  static uint32_t blend(uint32_t a,uint32_t b,float u){
    u=fmaxf(0,fminf(1,u));uint32_t value=0;
    for(int shift=0;shift<=16;shift+=8){float x=(a>>shift)&255,y=(b>>shift)&255;value|=(uint32_t)lroundf(x+(y-x)*u)<<shift;}return value;
  }
  uint16_t rgb(uint32_t c){return canvas.color565(c>>16,(c>>8)&255,c&255);}
  void stroke(float x,float y,float xx,float yy,uint16_t c,int r){int n=(int)fmaxf(fabsf(xx-x),fabsf(yy-y))+1;for(int i=0;i<=n;i++){float u=(float)i/n;canvas.fillCircle(lroundf(x+(xx-x)*u),lroundf(y+(yy-y)*u),r,c);}}
  void curve(float left,float right,float y,float bend,uint16_t c,int r){float px=left,py=y;for(int i=1;i<=24;i++){float u=i/24.f,x=left+(right-left)*u,yy=y+2*bend*u*(1-u);stroke(px,py,x,yy,c,r);px=x;py=yy;}}
  static const float (&writingPoints())[9][2]{return FaceMotion::writingPoints();}
  static void writtenPoint(float c,float& x,float& y){FaceMotion::writtenPoint(c,x,y);}
  void offline(float t){
    const auto eye=rgb(FaceMotion::OFFLINE);
    canvas.fillRoundRect(102,78,29,58,14,eye);
    canvas.fillRoundRect(189,78,29,58,14,eye);
    stroke(129,95,141,95,eye,2);stroke(129,119,141,119,eye,2);
    stroke(199,97,199,103,rgb(BG),2);stroke(208,111,208,117,rgb(BG),2);
    const float pts[][2]={{120,177},{140,177},{148,172},{155,184},{163,163},{171,181},{178,177},{200,177}};
    float lengths[7],total=0;
    const float alpha=.4f+.6f*(1-cosf(t*2*PI/3.2f))/2;
    const auto line=rgb(blend(BG,FaceMotion::OFFLINE,alpha));
    for(int i=0;i<7;i++){lengths[i]=hypotf(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);total+=lengths[i];stroke(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],line,1);}
    float distance=fmodf(t,3.2f)/3.2f*total;
    for(int i=0;i<7;i++){if(distance<=lengths[i]){float u=distance/lengths[i];canvas.fillCircle(lroundf(pts[i][0]+u*(pts[i+1][0]-pts[i][0])),lroundf(pts[i][1]+u*(pts[i+1][1]-pts[i][1])),3,rgb(blend(BG,0xb0b0b0,alpha)));break;}distance-=lengths[i];}
  }
  void writing(float t){
    const float cycle=writingPhase(t);const auto& pts=writingPoints();
    float progress=fminf(1,cycle/2)*8;int index=(int)fminf(7,floorf(progress));
    float x,y;writtenPoint(cycle,x,y);
    float alpha=p.work*(1-ease((cycle-2.1f)/.3f));
    if(alpha>.01f&&cycle>0){auto c=rgb(blend(BG,INK,alpha));for(int i=0;i<index;i++)stroke(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],c,1);stroke(pts[index][0],pts[index][1],x,y,c,1);}
    float pen=1;if(cycle>=2){y-=8*ease((cycle-2)/.3f);pen=1-ease((cycle-2.1f)/.3f);}
    if(cycle>=4.8f){x=130;y=180-8*(1-ease((cycle-4.8f)/.6f));pen=ease((cycle-4.8f)/.6f);}
    alpha=p.work*pen;if(alpha<.01f)return;
    auto c=rgb(blend(BG,INK,alpha));
    canvas.fillTriangle(x+3.45f,y-11.5f,x+17.25f,y-33.35f,x+25.3f,y-26.45f,c);canvas.fillTriangle(x+3.45f,y-11.5f,x+25.3f,y-26.45f,x+11.5f,y-5.75f,c);
    stroke(x+19.55f,y-33.35f,x+24.15f,y-29.9f,c,3);
    canvas.fillTriangle(x,y,x+3.45f,y-11.5f,x+11.5f,y-5.75f,rgb(blend(BG,0xf0e7dc,alpha)));
    canvas.fillTriangle(x,y,x+2.3f,y-5.75f,x+5.75f,y-2.3f,rgb(blend(BG,0x8d7dac,alpha)));
    stroke(x+16.1f,y-31.05f,x+24.15f,y-25.3f,rgb(blend(BG,0x827494,alpha)),1);stroke(x+6.9f,y-13.8f,x+18.4f,y-29.9f,rgb(blend(BG,0xf5efff,alpha)),1);
  }
};
