#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

namespace FaceMotion {
constexpr float WRITE_SECONDS = 2.f / 1.2f;
constexpr float WRITE_PERIOD = WRITE_SECONDS + 3.6f;
constexpr uint32_t BG = 0x08090e, INK = 0xb8bdc4, WAITING = 0xe89820, ERROR = 0xb51f32, OFFLINE = 0x808080;
struct Pose { float x=0,y=0,left=67.08f,right=67.08f,w=29.64f,gap=87.4f,happy=0,failed=0,work=0,thought=0,attention=0,amber=0; };
struct Key { float t,v; };
inline float ease(float u) { u=fmaxf(0,fminf(1,u)); return u*u*(3-2*u); }
template<size_t N> float track(float t, const Key (&keys)[N]) {
  t=fmodf(t,keys[N-1].t);
  for(size_t i=1;i<N;i++) if(t<=keys[i].t) {
    float u=ease((t-keys[i-1].t)/(keys[i].t-keys[i-1].t));
    return keys[i-1].v+(keys[i].v-keys[i-1].v)*u;
  }
  return keys[0].v;
}
inline const char* visual(const char* s) {
  if(!strcmp(s,"editing")||!strcmp(s,"tool"))return "running";
  if(!strcmp(s,"searching")||!strcmp(s,"speaking"))return "thinking";
  if(!strcmp(s,"sleepy")||!strcmp(s,"sleep"))return "idle";
  return s;
}
inline float writingPhase(float t) { float c=fmodf(t,WRITE_PERIOD);return c<WRITE_SECONDS?c*1.2f:c+2.f-WRITE_SECONDS; }
inline const float (&writingPoints())[9][2] { static const float p[9][2]={{130,180},{137,177},{141,181},{148,176},{154,180},{160,176},{166,179},{174,177},{182,179}};return p; }
inline void writtenPoint(float c,float& x,float& y) {
  const auto& p=writingPoints();float progress=fminf(1,c/2)*8;
  int i=(int)fminf(7,floorf(progress));float v=progress-i;
  x=p[i][0]+(p[i+1][0]-p[i][0])*v;y=p[i][1]+(p[i+1][1]-p[i][1])*v;
}
inline float wink(float t) { return t>=.85f&&t<=1.13f?sinf((t-.85f)/.28f*3.14159265358979323846f):0; }
inline Pose target(const char* state,float t) {
  Pose q;
  if(!strcmp(state,"idle")) { const Key k[]={{0,0},{1.8f,0},{2.2f,8},{3.4f,8},{3.9f,0},{7.2f,0}};q.x=track(t,k);q.y=-2; }
  else if(!strcmp(state,"thinking")) {
    const Key k[]={{0,0},{.45f,1},{1.1f,1},{1.3f,.85f},{1.5f,1},{2.4f,1},{2.95f,0},{3.5f,0},{3.95f,-1},{4.6f,-1},{4.8f,-.85f},{5,-1},{5.9f,-1},{6.45f,0},{8,0}};
    float look=track(t,k);q.x=23*look;q.y=-4-18*fabsf(look);q.left=(40+10*look)*1.56f;q.right=(40-10*look)*1.56f;q.thought=1;
  } else if(!strcmp(state,"running")) {
    const float c=writingPhase(t),side=((uint32_t)(t/WRITE_PERIOD)%2)?1:-1;q.work=1;q.gap=80.5f;
    if(c<2) { float x,y;writtenPoint(c,x,y);q.x=(x-156)*.95f;q.y=12+(y-178)*.7f;q.left=q.right=52.8f;q.gap=82; }
    else {
      const Key x[]={{0,24.7f},{2,24.7f},{2.45f,0},{2.9f,side*23},{3.85f,side*23},{4.45f,0},{5.6f,0}};
      const Key y[]={{0,12},{2,12},{2.45f,0},{2.9f,-21},{3.85f,-21},{4.45f,0},{5.6f,0}};
      q.x=track(c,x);q.y=track(c,y);q.left=q.right=64.8f;
    }
  } else if(!strcmp(state,"waiting")) { const Key k[]={{0,0},{.5f,-16},{1.5f,-16},{2.3f,16},{3.3f,16},{3.9f,0},{4.8f,0}};q.x=track(t,k);q.y=-2;q.left=q.right=76.44f;q.w=32.76f;q.attention=q.amber=1; }
  else if(!strcmp(state,"done")) {q.happy=1;q.y=t<.6f?-4*sinf(t/.6f*3.14159265358979323846f):0;}
  else if(!strcmp(state,"error")) {q.failed=1;q.x=t<.55f?4*sinf(t/.55f*3.14159265358979323846f*4)*(1-t/.55f):0;}
  else if(!strcmp(state,"offline")) q.left=q.right=21.84f;
  return q;
}
}
