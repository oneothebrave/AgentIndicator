import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import hookRegistration from "../shared/hook-events.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function updateHookConfig(config, { command, legacyCommand, uninstall = false }) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid existing hooks config");
  // Transform a copy: malformed input never partially edits the caller's config.
  const updated = structuredClone(config);
  updated.hooks ??= {};
  if (typeof updated.hooks !== "object" || Array.isArray(updated.hooks)) throw new Error("Invalid hooks table");
  for (const [event, enabled] of Object.entries(hookRegistration)) {
    const groups = updated.hooks[event] ?? [];
    if (!Array.isArray(groups) || groups.some(g => !g || !Array.isArray(g.hooks) || g.hooks.some(h => !h || typeof h !== "object")))
      throw new Error(`Invalid existing ${event} hooks`);
    // Also remove retired registrations, preserving unrelated handlers/matchers.
    const kept = groups.map(group => ({ ...group,
      hooks: group.hooks.filter(hook => ![command, legacyCommand].includes(hook.command)),
    })).filter(group => group.hooks.length);
    if (!uninstall && enabled) kept.push({ hooks: [{ type: "command", command, timeout: 2 }] });
    if (kept.length) updated.hooks[event] = kept;
    else delete updated.hooks[event];
  }
  return updated;
}

export async function installHooks({ target, uninstall = false, executable = process.execPath, sender = join(root, "scripts", "codex-hook.mjs") }) {
  const legacyCommand = `"${executable}" "${sender}"`;
  const command = process.platform === "win32"
    ? `& '${executable.replaceAll("'", "''")}' '${sender.replaceAll("'", "''")}'`
    : legacyCommand;
  let config = {}, original;
  try { original = await readFile(target, "utf8"); config = JSON.parse(original); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const encoded = JSON.stringify(updateHookConfig(config, { command, legacyCommand, uninstall }), null, 2) + "\n";
  if (original === encoded) return false;
  await mkdir(dirname(target), { recursive: true });
  if (original) await copyFile(target, `${target}.${Date.now()}.bak`);
  await writeFile(target, encoded);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !["--global", "--uninstall"].includes(a))) throw new Error("Usage: npm run hooks:install -- [--global] [--uninstall]");
  const uninstall = args.includes("--uninstall");
  const target = args.includes("--global")
    ? join(process.env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json")
    : join(root, ".codex", "hooks.json");
  const changed = await installHooks({ target, uninstall });
  console.log(`${changed ? (uninstall ? "Removed" : "Installed") : "Unchanged"} notification hooks: ${target}`);
  if (!uninstall) console.log("In your interactive Codex CLI, use /hooks to review and trust these definitions.");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
