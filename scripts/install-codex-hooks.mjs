import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uninstall = process.argv.includes("--uninstall");
const target = process.argv.includes("--global")
  ? join(process.env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json")
  : join(root, ".codex", "hooks.json");
const sender = join(root, "scripts", "codex-hook.mjs");
const legacyCommand = `"${process.execPath}" "${sender}"`;
const command = process.platform === "win32"
  ? `& '${process.execPath.replaceAll("'", "''")}' '${sender.replaceAll("'", "''")}'`
  : legacyCommand;
const events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop"];
let config = {};
let original;
try { original = await readFile(target, "utf8"); config = JSON.parse(original); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid existing hooks config");
config.hooks ??= {};
if (typeof config.hooks !== "object" || Array.isArray(config.hooks)) throw new Error("Invalid hooks table");
for (const event of events) {
  const groups = config.hooks[event] ?? [];
  if (!Array.isArray(groups)) throw new Error(`Invalid existing ${event} hooks`);
  // Preserve every unrelated handler, even when it shares our matcher group.
  config.hooks[event] = groups.map(group => ({ ...group,
    hooks: group.hooks.filter(hook => ![command, legacyCommand].includes(hook.command)),
  })).filter(group => group.hooks.length);
  if (!uninstall) config.hooks[event].push({ hooks: [{
    type: "command", command, timeout: 2,
  }] });
}
await mkdir(dirname(target), { recursive: true });
const encoded = JSON.stringify(config, null, 2) + "\n";
if (original !== encoded) {
  if (original) await copyFile(target, `${target}.${Date.now()}.bak`);
  await writeFile(target, encoded);
}
console.log(`${uninstall ? "Removed" : "Installed"} notification hooks: ${target}`);
if (!uninstall) console.log("In your interactive Codex CLI, use /hooks to review and trust these definitions.");
