/**
 * electron-builder custom Windows sign hook.
 *
 * Signs with signtool.exe against the HSM-backed Cloud KMS key via the Google
 * Cloud KMS CNG provider. The private key never leaves Google Cloud — signtool
 * hands the digest to the CNG provider, which calls
 * `cryptoKeyVersions.asymmetricSign` and gets a signature back.
 *
 * Wired up through `win.signtoolOptions.sign` in electron-builder.yml
 * (electron-builder >= 26 moved signtool options under `signtoolOptions`).
 *
 * Required on the signing machine:
 *   - Cloud KMS CNG provider installed (kmscng.msi)
 *   - C:\Windows\KMSCNG\config.yaml listing the key version
 *   - Application Default Credentials with roles/cloudkms.signerVerifier
 *
 * Env:
 *   GCP_KMS_KEY_VERSION  full cryptoKeyVersions resource name. Unset ⇒ signing
 *                        is skipped so local `pnpm dist:win` still produces an
 *                        (unsigned) installer.
 *   SIGNTOOL_PATH        explicit signtool.exe path; otherwise the newest
 *                        Windows SDK build tools directory wins.
 *   WIN_TIMESTAMP_URL    RFC-3161 timestamp server override.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const certsDir = join(desktopRoot, "certs");

const LEAF_CERT = join(certsDir, "keinsaas-codesigning.crt");
const INTERMEDIATE_CERT = join(certsDir, "gogetssl-intermediate.crt");
const CNG_PROVIDER = "Google Cloud KMS Provider";
const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";

const SDK_BIN_ROOTS = [
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin",
  "C:\\Program Files\\Windows Kits\\10\\bin",
];

/** Sort "10.0.22621.0"-style directory names newest-first. */
function compareSdkVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveSigntool() {
  const explicit = process.env.SIGNTOOL_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`SIGNTOOL_PATH does not exist: ${explicit}`);
    }
    return explicit;
  }

  const candidates = [];
  for (const root of SDK_BIN_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, "x64", "signtool.exe");
      if (existsSync(candidate)) candidates.push({ version: entry, candidate });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "signtool.exe not found. Install the Windows SDK signing tools or set SIGNTOOL_PATH.",
    );
  }

  candidates.sort((a, b) => compareSdkVersions(a.version, b.version));
  return candidates[0].candidate;
}

export default async function sign(configuration) {
  const keyVersion = process.env.GCP_KMS_KEY_VERSION?.trim();

  if (!keyVersion) {
    console.warn(
      `[sign] GCP_KMS_KEY_VERSION is unset — leaving ${configuration.path} unsigned. ` +
        "This is expected for local builds and a bug in CI.",
    );
    return;
  }

  for (const cert of [LEAF_CERT, INTERMEDIATE_CERT]) {
    if (!existsSync(cert)) {
      throw new Error(`Missing certificate: ${cert}`);
    }
  }

  const signtool = resolveSigntool();
  const timestampUrl =
    process.env.WIN_TIMESTAMP_URL?.trim() || DEFAULT_TIMESTAMP_URL;

  const args = [
    "sign",
    "/v",
    // Digest algorithm for the file hash. The KMS key is
    // RSA_SIGN_PKCS1_3072_SHA256, so anything but sha256 will be rejected.
    "/fd",
    "sha256",
    // RFC-3161 timestamp. Without it every signature dies when the certificate
    // expires (2027-08-04) instead of remaining valid indefinitely.
    "/tr",
    timestampUrl,
    "/td",
    "sha256",
    "/f",
    LEAF_CERT,
    // Ship the issuing CA inside the signature block so clients do not depend
    // on AIA fetching to build the chain.
    "/ac",
    INTERMEDIATE_CERT,
    "/csp",
    CNG_PROVIDER,
    "/kc",
    keyVersion,
  ];

  // Only reached if signingHashAlgorithms lists more than one algorithm;
  // additional passes must append rather than replace the signature.
  if (configuration.isNest) args.push("/as");

  args.push(configuration.path);

  console.log(
    `[sign] ${configuration.path} via Cloud KMS (${configuration.hash})`,
  );

  try {
    execFileSync(signtool, args, { stdio: "inherit" });
  } catch (error) {
    // signtool already wrote the diagnostic to stderr; keep the thrown message
    // free of the full argv so the KMS resource path stays out of noisy logs.
    throw new Error(
      `signtool failed for ${configuration.path} (exit ${error.status ?? "unknown"})`,
    );
  }
}

export { sign };
