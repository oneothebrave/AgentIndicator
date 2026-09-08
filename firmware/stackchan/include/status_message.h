#pragma once
#include <ArduinoJson.h>
#include "event_states.h"

enum class MessageKind { Ignored, Hello, Event, ProtocolError, Oversize, BadJson, BadEvent };
struct DecodedMessage {
  MessageKind kind;
  const EventState* event;
  const char* origin;
  DecodedMessage(MessageKind kind, const EventState* event=nullptr, const char* origin="-") : kind(kind), event(event), origin(origin) {}
};
inline DecodedMessage decodeStatusMessage(const uint8_t* payload,size_t length,bool ready) {
  if(length>8192) return {MessageKind::Oversize};
  JsonDocument doc;
  if(deserializeJson(doc,payload,length,DeserializationOption::NestingLimit(5))) return {MessageKind::BadJson};
  const char* kind=doc["kind"]|"";
  if(!strcmp(kind,"bridge.hello")) {
    if(!doc["version"].is<int>()||doc["version"].as<int>()!=1||!doc["source"].is<const char*>()||!doc["at"].is<double>()||
       (!doc["intervalMs"].isUnbound()&&!doc["intervalMs"].is<double>())) return {MessageKind::ProtocolError};
    return {MessageKind::Hello};
  }
  if(!ready||strcmp(kind,"agent.event")) return {MessageKind::Ignored};
  JsonObjectConst event=doc["event"].as<JsonObjectConst>();
  const auto* mapping=findEventState(event["type"]|"");
  const char* origin=event["origin"]|"";
  if(!mapping||!event["id"].is<const char*>()||!event["at"].is<double>()||
     (strcmp(origin,"mock")&&strcmp(origin,"codex"))||
     (!event["label"].isUnbound()&&!event["label"].is<const char*>())||
     (!event["detail"].isUnbound()&&!event["detail"].is<const char*>())) return {MessageKind::BadEvent};
  return {MessageKind::Event,mapping,!strcmp(origin,"codex")?"codex":"mock"};
}
