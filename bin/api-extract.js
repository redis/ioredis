#!/usr/bin/env node
/**
 * Lists the public API of the built package, one sorted line per item:
 *
 *   <Kind> <Parent.name> :: <signature>
 *   Event <Emitter>.<event>
 *
 * Overloads produce one line each. Reads <root>/built/index.d.ts, so build
 * that checkout first. --root defaults to this repository; pass another
 * checkout (e.g. the PR base) to extract its API with this script.
 *
 * Usage: node bin/api-extract.js [--root <dir>] [outFile]
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseArgs } = require("util");
const { Extractor, ExtractorConfig } = require("@microsoft/api-extractor");
const { ApiModel, ApiItemKind } = require("@microsoft/api-extractor-model");

function extractDocModel(root, entryPoint, apiJsonFilePath) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      mainEntryPointFilePath: entryPoint,
      compiler: { tsconfigFilePath: path.join(root, "tsconfig.json") },
      apiReport: { enabled: false },
      docModel: {
        enabled: true,
        apiJsonFilePath,
        // Include unexported types that exported ones depend on, such as
        // Commander, CommanderOptions and Transaction.
        includeForgottenExports: true,
      },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: { logLevel: "error" } },
        extractorMessageReporting: { default: { logLevel: "none" } },
        tsdocMessageReporting: { default: { logLevel: "none" } },
      },
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(root, "package.json"),
  });

  const result = Extractor.invoke(config, {
    localBuild: true,
    messageCallback(message) {
      message.handled = true;
      if (message.logLevel === "error") {
        console.error(message.formatMessageWithLocation(root));
      }
    },
  });
  if (!result.succeeded) {
    throw new Error(`API Extractor failed with ${result.errorCount} error(s)`);
  }
}

// Drops how a symbol is declared (`export default`, `declare`), which says
// nothing about its API.
const signature = (text) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(export |default |declare )+/, "");

function listApi(apiJsonFilePath) {
  const pkg = new ApiModel().loadPackage(apiJsonFilePath);
  const [entry] = pkg.entryPoints;

  // Resolves `on(event: RedisStatus, ...)` to the alias's string literals.
  const typeAliases = new Map(
    entry.members
      .filter((m) => m.kind === ApiItemKind.TypeAlias)
      .map((m) => [m.displayName, m.typeExcerpt.text])
  );
  const eventNames = (typeText) => {
    const text = typeAliases.get(typeText.trim()) || typeText;
    return (text.match(/"[^"]+"/g) || []).map((s) => s.slice(1, -1));
  };

  const lines = new Set();
  const walk = (item, parent) => {
    for (const member of item.members) {
      const name = parent
        ? `${parent}.${member.displayName}`
        : member.displayName;
      lines.add(`${member.kind} ${name} :: ${signature(member.excerpt.text)}`);

      if (member.displayName === "on" && member.parameters?.length) {
        const eventType = member.parameters[0].parameterTypeExcerpt.text;
        for (const event of eventNames(eventType)) {
          lines.add(`Event ${parent}.${event}`);
        }
      }

      if (member.members?.length) walk(member, name);
    }
  };
  walk(entry, "");

  return [...lines].sort();
}

function main() {
  const { values, positionals } = parseArgs({
    options: { root: { type: "string" } },
    allowPositionals: true,
  });
  const root = path.resolve(values.root || path.join(__dirname, ".."));
  const entryPoint = path.join(root, "built", "index.d.ts");
  const [outFile] = positionals;
  if (!fs.existsSync(entryPoint)) {
    throw new Error(`${entryPoint} not found; run \`npm run build\` first`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ioredis-api-"));
  try {
    const apiJsonFilePath = path.join(tmp, "ioredis.api.json");
    extractDocModel(root, entryPoint, apiJsonFilePath);
    const output = listApi(apiJsonFilePath).join("\n") + "\n";
    if (outFile) fs.writeFileSync(outFile, output);
    else process.stdout.write(output);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
