// Daily-use entry point: stale app-server test variables must not start a turn.
process.env.AGENT_INDICATOR_SOURCE = "codex-hooks";
process.env.AGENT_INDICATOR_HOST ??= "0.0.0.0";
await import("./index");
export {};
