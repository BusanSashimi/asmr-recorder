// Use a persistent certificate for packaged macOS capture testing. Linker ad-hoc
// signatures identify each rebuild by its hash and invalidate existing TCC grants.
import { spawnSync, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const env = { ...process.env };
env.PATH = `${homedir()}/.cargo/bin:${env.PATH ?? ""}`;
if (process.platform === "darwin") {
  env.DYLD_LIBRARY_PATH = `/usr/lib/swift${env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : ""}`;
  const debugBuild = args[0] === "build" && (args.includes("--debug") || args.includes("-d"))
    && !args.includes("--help") && !args.includes("-h");
  if (debugBuild) {
    if (!env.APPLE_SIGNING_IDENTITY) {
      const identities = execFileSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
      const names = [...identities.matchAll(/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"(Apple Development:[^"]+)"/gm)].map(match => match[1]);
      if (names.length !== 1) {
        console.error("A stable signing identity is required for macOS debug bundles. Install an Apple Development certificate in Xcode → Settings → Apple Accounts → Manage Certificates, or set APPLE_SIGNING_IDENTITY to an existing certificate. No unsigned bundle was built.");
        process.exit(1);
      }
      env.APPLE_SIGNING_IDENTITY = names[0];
    }
    if (env.APPLE_SIGNING_IDENTITY === "-") {
      console.error("Ad-hoc signing changes identity after rebuilds. Choose a certificate in APPLE_SIGNING_IDENTITY for capture testing.");
      process.exit(1);
    }
    console.info("Using certificate signing for the macOS debug bundle.");
  }
}
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
