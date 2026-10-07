// Makes Eddy's Web Push signing key (VAPID, a P-256 key pair) and stores the
// private half as the VAPID_PRIVATE_KEY secret of one GitHub environment,
// which the deploys hand to the API Worker (worker/src/push.ts). The private
// key goes straight from here into `gh secret set` on its standard input:
// it is never printed, written to a file or put on a command line.
//
// The owner runs it, once per environment:
//
//   node scripts/vapid-keys.mjs --env preview
//   node scripts/vapid-keys.mjs --env production
//
// Needs the GitHub CLI signed in with access to the repo's environments.
// Running it again makes a new key: every device then has to turn
// Notifications on again (the app re-subscribes when it is switched on).
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";

const REPO = "ant-ford/Squad-Selection";
const ENVS = ["preview", "production"];

const i = process.argv.indexOf("--env");
const env = i > 0 ? process.argv[i + 1] : undefined;
if (!ENVS.includes(env ?? "")) {
  console.log("Usage: node scripts/vapid-keys.mjs --env preview|production");
  console.log("Makes a VAPID key pair and stores the private key as that environment's VAPID_PRIVATE_KEY secret.");
  process.exit(1);
}

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await subtle.exportKey("jwk", pair.privateKey);
const secret = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
const publicKey = Buffer.from(await subtle.exportKey("raw", pair.publicKey)).toString("base64url");

const gh = spawn("gh", ["secret", "set", "VAPID_PRIVATE_KEY", "--env", env, "--repo", REPO], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: process.platform === "win32",
});
gh.on("error", (err) => {
  console.error(`Could not run gh (${err.message}). Install the GitHub CLI and sign in with: gh auth login`);
  process.exit(1);
});
gh.stdin.end(secret);
gh.on("close", (code) => {
  if (code !== 0) {
    console.error(`gh secret set failed (exit ${code}). Nothing was stored.`);
    process.exit(code ?? 1);
  }
  console.log(`VAPID_PRIVATE_KEY stored in the ${env} environment of ${REPO}.`);
  console.log(`Public key (the Worker derives it from the secret; for reference only): ${publicKey}`);
  console.log("Next:");
  console.log(
    env === "preview"
      ? "  1. Run the preview workflow (it installs the secret on hkfc-api-preview)."
      : "  1. The next deploy from main installs the secret on hkfc-api.",
  );
  console.log(`  2. Set PUSH = "on" in worker/wrangler.toml (${env === "preview" ? "[env.preview.vars]" : "[vars]"}) in a PR, and deploy.`);
});
