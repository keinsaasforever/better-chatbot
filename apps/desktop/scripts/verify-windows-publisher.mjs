/**
 * Assert that a signed Windows artifact will be accepted by electron-updater.
 *
 * `signtool verify` proves the signature and chain are valid. It does not prove
 * that clients will accept an *update* signed with it: electron-updater reads the
 * signer certificate's subject via PowerShell and compares it against the
 * configured `publisherName`. A mismatch there rejects every update while
 * signtool still reports success — so this check reproduces electron-updater's
 * comparison against the same certificate, at build time.
 *
 * Mirrors electron-updater's windowsExecutableCodeSignatureVerifier:
 * the same `chcp 65001` prefix (certificates with non-ASCII subjects are read
 * correctly only under UTF-8) and the same field-by-field DN comparison.
 *
 * Usage: node scripts/verify-windows-publisher.mjs <file.exe> [...]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const builderConfig = join(desktopRoot, "electron-builder.yml");

/**
 * Parse a distinguished name into a field map, honouring quoted values and
 * backslash escapes the way electron-updater's parseDn does.
 */
function parseDn(input) {
  const result = new Map();
  let key = null;
  let value = "";
  let quoted = false;

  const commit = () => {
    if (key !== null) result.set(key.trim(), value.trim());
    key = null;
    value = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\") {
      value += input[++i] ?? "";
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === "=" && key === null) {
      key = value;
      value = "";
    } else if (!quoted && ch === ",") {
      commit();
    } else {
      value += ch;
    }
  }
  commit();
  return result;
}

function readConfiguredPublisherName() {
  const match = readFileSync(builderConfig, "utf8").match(
    /^\s*publisherName:\s*(.+?)\s*$/m,
  );
  if (!match) {
    throw new Error(`No publisherName found in ${builderConfig}`);
  }
  return match[1].replace(/^["']|["']$/g, "");
}

function readSignerSubject(file) {
  // Same invocation shape electron-updater uses: PSModulePath cleared, code page
  // forced to UTF-8, commands joined with & so chcp actually applies.
  const command = `Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}' | ConvertTo-Json -Compress`;
  const stdout = execFileSync(
    `set "PSModulePath=" & chcp 65001 >NUL & powershell.exe`,
    [
      "-NoProfile",
      "-NonInteractive",
      "-InputFormat",
      "None",
      "-Command",
      `"${command}"`,
    ],
    { shell: true, encoding: "utf8", timeout: 20_000 },
  );

  const data = JSON.parse(stdout);
  if (data.Status !== 0) {
    throw new Error(
      `Signature status ${data.Status} (${data.StatusMessage ?? "no message"}) for ${file}`,
    );
  }
  return data.SignerCertificate.Subject;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: verify-windows-publisher.mjs <file.exe> [...]");
  process.exit(1);
}

const configured = readConfiguredPublisherName();
const expected = parseDn(configured);
if (expected.size === 0) {
  // electron-updater falls back to matching the bare CN and warns. Treat it as a
  // configuration error here rather than shipping the weaker check.
  throw new Error(
    `publisherName "${configured}" is not a distinguished name; use the full DN`,
  );
}

let failed = false;
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`missing: ${file}`);
    failed = true;
    continue;
  }

  const subject = readSignerSubject(file);
  const actual = parseDn(subject);
  const mismatches = [...expected.entries()].filter(
    ([field, want]) => actual.get(field) !== want,
  );

  if (mismatches.length > 0) {
    console.error(`publisher mismatch: ${file}`);
    console.error(`  configured: ${configured}`);
    console.error(`  signed as:  ${subject}`);
    for (const [field, want] of mismatches) {
      console.error(
        `  ${field}: expected "${want}", got "${actual.get(field) ?? "<absent>"}"`,
      );
    }
    failed = true;
    continue;
  }

  console.log(`publisher OK: ${file} (${subject})`);
}

if (failed) {
  console.error(
    "electron-updater would reject updates signed like this. Fix win.signtoolOptions.publisherName or the certificate.",
  );
  process.exit(1);
}
