#!/usr/bin/env node
// Patch dist/cli.mjs to inject newer Claude model IDs that postdate the bundle.
// Idempotent. Backs up the original to dist/cli.mjs.bak (once) before writing.
//
// Usage:
//   node scripts/patch-models.mjs           # patch
//   node scripts/patch-models.mjs --check   # verify already patched
//   node scripts/patch-models.mjs --restore # restore from .bak
//
// Add new entries to NEW_MODELS below. Each entry seeds:
//   - ALL_MODEL_CONFIGS registry (firstParty/bedrock/vertex/foundry IDs)
//   - MODEL_COSTS pricing table
//   - getMarketingNameForModel display string
//   - getPublicModelDisplayName switch case
//   - sanitizeModelName attribution map
// The /model picker is NOT modified — invoke via `--model <id>` or
// ANTHROPIC_MODEL=<id>. Picker injection requires touching React option
// builders and is left out to keep this patch low-risk.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "..", "dist", "cli.mjs");
const BACKUP = TARGET + ".bak";

// ---------- model definitions ----------
// Pricing reuses existing COST_TIER_* constants already in the bundle.
// Opus 4.7 pricing assumed identical to 4.6 ($5/$25). Update if Anthropic
// publishes different rates.
const NEW_MODELS = [
  {
    constName: "CLAUDE_OPUS_4_7_CONFIG",
    registryKey: "opus47",
    firstParty: "claude-opus-4-7",
    bedrock: "us.anthropic.claude-opus-4-7-v1",
    vertex: "claude-opus-4-7",
    foundry: "claude-opus-4-7",
    costTier: "COST_TIER_5_25",
    publicName: "Opus 4.7",
    marketingMatch: "claude-opus-4-7",
    sanitizeMatch: "opus-4-7",
    sanitizeReturn: "claude-opus-4-7",
  },
];

// ---------- helpers ----------
const args = process.argv.slice(2);
const mode = args[0] ?? "patch";

function die(msg) { console.error("✗", msg); process.exit(1); }
function ok(msg)  { console.log("✓", msg); }

if (!existsSync(TARGET)) die(`not found: ${TARGET}`);

if (mode === "--restore") {
  if (!existsSync(BACKUP)) die(`no backup at ${BACKUP}`);
  copyFileSync(BACKUP, TARGET);
  ok(`restored ${TARGET} from backup`);
  process.exit(0);
}

let src = readFileSync(TARGET, "utf8");
const original = src;

// ---------- patch operations ----------
function injectAfter(needle, addition, label, sentinel) {
  // sentinel: a unique substring of `addition` that proves the patch is in place.
  // Required — relying on first line is unsafe when addition starts with punctuation.
  if (!sentinel) die(`${label}: missing sentinel`);
  if (src.includes(sentinel)) {
    ok(`${label}: already present, skipping`);
    return;
  }
  const idx = src.indexOf(needle);
  if (idx === -1) die(`${label}: anchor not found: ${needle.slice(0, 60)}…`);
  const insertAt = idx + needle.length;
  src = src.slice(0, insertAt) + addition + src.slice(insertAt);
  ok(`${label}: injected`);
}

for (const m of NEW_MODELS) {
  // 1. CONFIG constant + ALL_MODEL_CONFIGS entry
  // Anchor: end of CLAUDE_OPUS_4_6_CONFIG block, just before CLAUDE_SONNET_4_6_CONFIG
  injectAfter(
    `      foundry: "claude-opus-4-6"\n    };\n`,
    `    ${m.constName} = {\n` +
    `      firstParty: "${m.firstParty}",\n` +
    `      bedrock: "${m.bedrock}",\n` +
    `      vertex: "${m.vertex}",\n` +
    `      foundry: "${m.foundry}"\n` +
    `    };\n`,
    `${m.constName} declaration`,
    `${m.constName} = {`
  );

  // 2. ALL_MODEL_CONFIGS map
  injectAfter(
    `      opus46: CLAUDE_OPUS_4_6_CONFIG`,
    `,\n      ${m.registryKey}: ${m.constName}`,
    `ALL_MODEL_CONFIGS.${m.registryKey}`,
    `${m.registryKey}: ${m.constName}`
  );

  // 3. MODEL_COSTS table
  injectAfter(
    `[firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)]: COST_TIER_5_25`,
    `,\n      [firstPartyNameToCanonical(${m.constName}.firstParty)]: ${m.costTier}`,
    `MODEL_COSTS for ${m.firstParty}`,
    `firstPartyNameToCanonical(${m.constName}.firstParty)`
  );

  // 4. getMarketingNameForModel — must precede the substring-match for "claude-opus-4-6"
  // Insert a more-specific check (4-7) before the generic 4-6 branch.
  const marketingAnchor = `  if (canonical.includes("claude-opus-4-6")) {`;
  if (src.includes(`canonical.includes("${m.marketingMatch}")`)) {
    ok(`marketing name for ${m.firstParty}: already present`);
  } else {
    const idx = src.indexOf(marketingAnchor);
    if (idx === -1) die("getMarketingNameForModel anchor not found");
    const block =
      `  if (canonical.includes("${m.marketingMatch}")) {\n` +
      `    return has1m ? "${m.publicName} (with 1M context)" : "${m.publicName}";\n` +
      `  }\n`;
    src = src.slice(0, idx) + block + src.slice(idx);
    ok(`marketing name for ${m.firstParty}: injected`);
  }

  // 5. getPublicModelDisplayName — add switch case (uses string interpolation,
  // referencing the new registry key).
  const switchAnchor = `    case getModelStrings2().opus46:\n      return "Opus 4.6";\n`;
  if (src.includes(`getModelStrings2().${m.registryKey}:`)) {
    ok(`public display name for ${m.registryKey}: already present`);
  } else {
    const block =
      `    case getModelStrings2().${m.registryKey}:\n` +
      `      return "${m.publicName}";\n` +
      `    case getModelStrings2().${m.registryKey} + "[1m]":\n` +
      `      return "${m.publicName} (1M context)";\n`;
    injectAfter(switchAnchor, block, `display name switch for ${m.registryKey}`, `getModelStrings2().${m.registryKey}:`);
  }

  // 6. sanitizeModelName — must precede shorter prefix
  const sanitizeAnchor = `  if (shortName.includes("opus-4-6")) return "claude-opus-4-6";\n`;
  if (src.includes(`shortName.includes("${m.sanitizeMatch}")`)) {
    ok(`sanitizeModelName for ${m.sanitizeMatch}: already present`);
  } else {
    const idx = src.indexOf(sanitizeAnchor);
    if (idx === -1) die("sanitizeModelName anchor not found");
    const line = `  if (shortName.includes("${m.sanitizeMatch}")) return "${m.sanitizeReturn}";\n`;
    src = src.slice(0, idx) + line + src.slice(idx);
    ok(`sanitizeModelName for ${m.sanitizeMatch}: injected`);
  }
}

// ---------- post-retirement fixes ----------
// Anthropic deprecates claude-{sonnet,opus}-4-20250514 on 2026-06-15.
// The bundle's refusal-handler suggests claude-sonnet-4-20250514 as a fallback,
// which will start failing. Remap to claude-sonnet-4-6 (current GA Sonnet).

const REFUSAL_OLD = `model !== "claude-sonnet-4-20250514" ? " If you are seeing this refusal repeatedly, try running /model claude-sonnet-4-20250514 to switch models."`;
const REFUSAL_NEW = `model !== "claude-sonnet-4-6" ? " If you are seeing this refusal repeatedly, try running /model claude-sonnet-4-6 to switch models."`;

if (src.includes(REFUSAL_NEW)) {
  ok("refusal suggestion: already updated");
} else if (src.includes(REFUSAL_OLD)) {
  src = src.replace(REFUSAL_OLD, REFUSAL_NEW);
  ok("refusal suggestion: remapped to claude-sonnet-4-6");
} else {
  ok("refusal suggestion: anchor not found, skipping (already removed?)");
}

// ---------- write ----------
if (mode === "--check") {
  if (src === original) ok("no changes would be applied — fully patched");
  else die("file is NOT fully patched");
  process.exit(0);
}

if (src === original) {
  ok("nothing to do — already patched");
  process.exit(0);
}

if (!existsSync(BACKUP)) {
  copyFileSync(TARGET, BACKUP);
  ok(`backup written: ${BACKUP}`);
}

writeFileSync(TARGET, src);
ok(`patched: ${TARGET}`);
console.log("\nUse via:  claude --model claude-opus-4-7");
console.log("Or set:  ANTHROPIC_MODEL=claude-opus-4-7  in env / settings.json");
console.log("Restore: node scripts/patch-models.mjs --restore");
