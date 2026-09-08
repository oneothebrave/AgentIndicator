#pragma once
#include <M5Unified.h>
#include <math.h>
#include <string.h>

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
    const uint32_t eyeColor=blend(INK,0xe89820,p.amber);
    float blink=1,phase=fmodf(t,5.7f);
    if(!is("done")&&!is("error")&&phase>5.2f&&phase<5.38f)blink=fabsf((phase-5.29f)/.09f);
    const float normal=fmaxf(0,1-p.happy-p.failed);
    if(normal>.01f)for(int side=0;side<2;side++){
      const float h=fmaxf(4,(side?p.right:p.left)*blink);
      canvas.fillRoundRect(lroundf(160+(side?1:-1)*p.gap/2+p.x-p.w/2),lroundf(103+p.y-h/2),lroundf(p.w),lroundf(h),lroundf(fminf(h,p.w)/2),rgb(blend(BG,eyeColor,normal)));
    }
    const float wink=is("done")&&t>=.85f&&t<=1.13f?sinf((t-.85f)/.28f*PI):0;
    if(p.happy>.01f)for(int side=0;side<2;side++){
      const float x=160+(side?43.7f:-43.7f);
      curve(x-22.5f,x+22.5f,108+p.y,-45.f+45.f*(side?0:wink),rgb(blend(BG,INK,p.happy)),4);
    }
    if(p.failed>.01f)for(int side=0;side<2;side++){
      float x=side?217.f:103.f;const auto c=rgb(blend(BG,0xb51f32,p.failed));
      stroke(x-16.5f+p.x,86.5f,x+16.5f+p.x,119.5f,c,4);stroke(x+16.5f+p.x,86.5f,x-16.5f+p.x,119.5f,c,4);
    }
    if(p.thought>.01f){
      const auto c=rgb(blend(BG,INK,p.thought*(.35f+.65f*fminf(1,fabsf(p.x)/12))));
      // Mirror around screen center, preserving the upward outward direction.
      canvas.fillCircle(p.x<0?54:266,37,2,c);canvas.fillCircle(p.x<0?43:277,27,3,c);
    }
    if(p.attention>.01f)canvas.fillCircle(160,174,3,rgb(blend(BG,0xe89820,p.attention*(.35f+.65f*(1-cosf(t*2*PI/3.6f))/2))));
    if(p.work>.01f)writing(t);
    if(connected)canvas.fillCircle(160,220,2,rgb(0x718080));
    else {stroke(148,220,156,220,rgb(0xe89820),1);stroke(164,220,172,220,rgb(0xe89820),1);}
    canvas.pushSprite(0,0);
  }
 private:
  static constexpr float WRITE_PERIOD=5.6f-2.f+2.f/1.2f;
  static float writingPhase(float t){float c=fmodf(t,WRITE_PERIOD);return c<2.f/1.2f?c*1.2f:c+2.f-2.f/1.2f;}
  static constexpr uint32_t BG=0x08090e,INK=0xb8bdc4;
  struct Pose {float x=0,y=0,left=43,right=43,w=19,gap=76,happy=0,failed=0,work=0,thought=0,attention=0,amber=0;};
  struct Key {float t,v;};
  M5Canvas canvas{&M5.Display};Pose p;bool ready=false;
  const char* current="offline";uint32_t changedAt=0,lastFrame=0;
  bool is(const char* s)const{return !strcmp(current,s);}
  static const char* visual(const char* s){
    if(!strcmp(s,"editing")||!strcmp(s,"tool"))return "running";
    if(!strcmp(s,"searching")||!strcmp(s,"speaking"))return "thinking";
    if(!strcmp(s,"sleepy")||!strcmp(s,"sleep"))return "idle";
    return s;
  }
  static float ease(float u){u=fmaxf(0,fminf(1,u));return u*u*(3-2*u);}
  static void smooth(float& v,float q,float k){v+=(q-v)*k;}
  template<size_t N>static float track(float t,const Key(&keys)[N]){
    t=fmodf(t,keys[N-1].t);
    for(size_t i=1;i<N;i++)if(t<=keys[i].t){float u=ease((t-keys[i-1].t)/(keys[i].t-keys[i-1].t));return keys[i-1].v+(keys[i].v-keys[i-1].v)*u;}
    return keys[0].v;
  }
  Pose target(float t){
    Pose q;
    if(is("idle")){const Key keys[]={{0,0},{1.8f,0},{2.2f,8},{3.4f,8},{3.9f,0},{7.2f,0}};q.x=track(t,keys);q.y=-2;}
    if(is("thinking")){const Key keys[]={{0,0},{.6f,1},{2.4f,1},{3,0},{3.5f,0},{4.1f,-1},{5.9f,-1},{6.5f,0},{8,0}};float look=track(t,keys);q.x=12*look;q.y=-3-10*fabsf(look);q.left=39+6*look;q.right=39-6*look;q.thought=1;}
    if(is("running")){
      const float c=writingPhase(t),side=((uint32_t)(t/WRITE_PERIOD)%2)?1:-1;q.work=1;q.gap=70;
      if(c<2){q.x=-10+20*c/2;q.y=10;q.left=q.right=32;}
      else{const Key x[]={{0,10},{2,10},{2.5f,0},{2.95f,side*12},{3.85f,side*12},{4.5f,0},{5.6f,0}};const Key y[]={{0,10},{2,10},{2.5f,0},{2.95f,-13},{3.85f,-13},{4.5f,0},{5.6f,0}};q.x=track(c,x);q.y=track(c,y);q.left=q.right=40;}
    }
    if(is("waiting")){const Key keys[]={{0,0},{.5f,-16},{1.5f,-16},{2.3f,16},{3.3f,16},{3.9f,0},{4.8f,0}};q.x=track(t,keys);q.y=-2;q.left=q.right=49;q.w=21;q.attention=q.amber=1;}
    if(is("done")){q.happy=1;q.y=t<.6f?-4*sinf(t/.6f*PI):0;}
    if(is("error")){q.failed=1;q.x=t<.55f?4*sinf(t/.55f*PI*4)*(1-t/.55f):0;}
    if(is("offline"))q.left=q.right=14;
    // Approved v4 proportions and more visible eye choreography.
    q.w*=1.3f;q.left*=1.3f;q.right*=1.3f;q.gap*=1.15f;
    if(is("thinking")){
      const Key keys[]={{0,0},{.45f,1},{1.1f,1},{1.3f,.85f},{1.5f,1},{2.4f,1},{2.95f,0},{3.5f,0},{3.95f,-1},{4.6f,-1},{4.8f,-.85f},{5,-1},{5.9f,-1},{6.45f,0},{8,0}};
      float look=track(t,keys);q.x=23*look;q.y=-4-18*fabsf(look);q.left=(40+10*look)*1.3f;q.right=(40-10*look)*1.3f;
    }
    if(is("running")){
      const float c=writingPhase(t),side=((uint32_t)(t/WRITE_PERIOD)%2)?1:-1;
      if(c<2){float x,y;writtenPoint(c,x,y);q.x=(x-156)*.95f;q.y=12+(y-178)*.7f;q.left=q.right=44;q.gap=82;}
      else{const Key x[]={{0,24.7f},{2,24.7f},{2.45f,0},{2.9f,side*23},{3.85f,side*23},{4.45f,0},{5.6f,0}};const Key y[]={{0,12},{2,12},{2.45f,0},{2.9f,-21},{3.85f,-21},{4.45f,0},{5.6f,0}};q.x=track(c,x);q.y=track(c,y);q.left=q.right=54;}
    }
    q.w*=1.2f;q.left*=1.2f;q.right*=1.2f;
    return q;
  }
  static uint32_t blend(uint32_t a,uint32_t b,float u){
    u=fmaxf(0,fminf(1,u));uint32_t value=0;
    for(int shift=0;shift<=16;shift+=8){float x=(a>>shift)&255,y=(b>>shift)&255;value|=(uint32_t)lroundf(x+(y-x)*u)<<shift;}return value;
  }
  uint16_t rgb(uint32_t c){return canvas.color565(c>>16,(c>>8)&255,c&255);}
  void stroke(float x,float y,float xx,float yy,uint16_t c,int r){int n=(int)fmaxf(fabsf(xx-x),fabsf(yy-y))+1;for(int i=0;i<=n;i++){float u=(float)i/n;canvas.fillCircle(lroundf(x+(xx-x)*u),lroundf(y+(yy-y)*u),r,c);}}
  void curve(float left,float right,float y,float bend,uint16_t c,int r){float px=left,py=y;for(int i=1;i<=24;i++){float u=i/24.f,x=left+(right-left)*u,yy=y+2*bend*u*(1-u);stroke(px,py,x,yy,c,r);px=x;py=yy;}}
  static const float (&writingPoints())[9][2]{static const float points[9][2]={{130,180},{137,177},{141,181},{148,176},{154,180},{160,176},{166,179},{174,177},{182,179}};return points;}
  static void writtenPoint(float c,float& x,float& y){const auto& points=writingPoints();float progress=fminf(1,c/2)*8;int i=(int)fminf(7,floorf(progress));float v=progress-i;x=points[i][0]+(points[i+1][0]-points[i][0])*v;y=points[i][1]+(points[i+1][1]-points[i][1])*v;}
  void offline(float t){
    const auto eye=rgb(0x808080);
    canvas.fillRoundRect(102,78,29,58,14,eye);
    canvas.fillRoundRect(189,78,29,58,14,eye);
    stroke(129,95,141,95,eye,2);stroke(129,119,141,119,eye,2);
    stroke(199,97,199,103,rgb(BG),2);stroke(208,111,208,117,rgb(BG),2);
    const float pts[][2]={{120,177},{140,177},{148,172},{155,184},{163,163},{171,181},{178,177},{200,177}};
    float lengths[7],total=0;
    const float alpha=.4f+.6f*(1-cosf(t*2*PI/3.2f))/2;
    const auto line=rgb(blend(BG,0x808080,alpha));
    for(int i=0;i<7;i++){lengths[i]=hypotf(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);total+=lengths[i];stroke(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],line,1);}
    float distance=fmodf(t,3.2f)/3.2f*total;
    for(int i=0;i<7;i++){if(distance<=lengths[i]){float u=distance/lengths[i];canvas.fillCircle(lroundf(pts[i][0]+u*(pts[i+1][0]-pts[i][0])),lroundf(pts[i][1]+u*(pts[i+1][1]-pts[i][1])),3,rgb(blend(BG,0xb0b0b0,alpha)));break;}distance-=lengths[i];}
  }
  void writing(float t){
    const float cycle=writingPhase(t);const auto& pts=writingPoints();
    float progress=fminf(1,cycle/2)*8;int index=(int)fminf(7,floorf(progress));
    float x,y;writtenPoint(cycle,x,y);
    float alpha=p.work*(1-ease((cycle-2.1f)/.3f));
    if(alpha>.01f&&cycle>0){auto c=rgb(blend(BG,0xb8bdc4,alpha));for(int i=0;i<index;i++)stroke(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],c,1);stroke(pts[index][0],pts[index][1],x,y,c,1);}
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
