#!/usr/bin/env node
/**
 * Register (or list / delete) the Airtable webhook that tells the API
 * Worker when the base changes - see worker/src/airtableWebhook.ts.
 *
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... \
 *     node scripts/register-airtable-webhook.mjs create https://api.eddy.global/api/internal/airtable-webhook
 *   node scripts/register-airtable-webhook.mjs list
 *   node scripts/register-airtable-webhook.mjs delete ach...
 *
 * The token needs the `webhook:manage` scope on the base, in addition to
 * the data scopes the Worker already uses. Credentials come from the
 * environment only; this script never reads a file.
 *
 * `create` prints the webhook id and its MAC secret once. Airtable does not
 * show the secret again, so set both on the Worker straight away:
 *
 *   cd worker
 *   npx wrangler secret put AIRTABLE_WEBHOOK_SECRET     # the macSecretBase64
 *   # and add AIRTABLE_WEBHOOK_ID = "ach..." under [vars] in wrangler.toml
 */

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
const [command = "list", arg] = process.argv.slice(2);

if (!token || !baseId) {
  console.error("Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID in the environment.");
  process.exit(1);
}

const api = `https://api.airtable.com/v0/bases/${baseId}/webhooks`;

async function call(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Airtable ${init.method || "GET"} ${path} failed (${res.status}): ${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

if (command === "list") {
  const { webhooks = [] } = await call("");
  if (webhooks.length === 0) console.log("No webhooks on this base.");
  for (const w of webhooks) {
    console.log(`${w.id}  ${w.notificationUrl}  enabled=${w.isHookEnabled}  expires=${w.expirationTime}`);
  }
} else if (command === "create") {
  if (!arg) {
    console.error("Usage: create <notification URL>");
    process.exit(1);
  }
  const created = await call("", {
    method: "POST",
    body: JSON.stringify({
      notificationUrl: arg,
      specification: {
        options: {
          // Whole base, any source. The Worker maps table ids to the caches
          // they feed and ignores tables it does not cache (the CRM side).
          filters: { dataTypes: ["tableData"] },
        },
      },
    }),
  });
  console.log(`Webhook created: ${created.id}`);
  console.log(`Expires: ${created.expirationTime} (the Worker refreshes it on every ping and daily)`);
  console.log("");
  console.log("Now, from worker/:");
  console.log(`  npx wrangler secret put AIRTABLE_WEBHOOK_SECRET`);
  console.log(`  (paste this value): ${created.macSecretBase64}`);
  console.log(`  and add to [vars] in wrangler.toml:  AIRTABLE_WEBHOOK_ID = "${created.id}"`);
} else if (command === "delete") {
  if (!arg) {
    console.error("Usage: delete <webhook id>");
    process.exit(1);
  }
  await call(`/${arg}`, { method: "DELETE" });
  console.log(`Deleted ${arg}`);
} else {
  console.error(`Unknown command ${command}. Use list, create <url>, or delete <id>.`);
  process.exit(1);
}
