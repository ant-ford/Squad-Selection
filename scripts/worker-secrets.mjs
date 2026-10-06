// Prints a JSON object of the named environment variables, for
// `wrangler deploy --secrets-file` (.github/workflows/ci.yml). Values are
// read from the environment, so they never appear on a command line, and
// only the names reach stderr. A name that is unset or empty is left out,
// so the Worker keeps its current value: --secrets-file is additive.
//
//   node scripts/worker-secrets.mjs NAME [NAME ...] > secrets.json

export function workerSecrets(names, env = process.env) {
  const out = {};
  for (const name of names) {
    if (env[name]) out[name] = env[name];
    else console.error(`${name} is not in the production environment yet; the Worker keeps its current value.`);
  }
  return out;
}

if (process.argv[1]?.endsWith("worker-secrets.mjs")) {
  process.stdout.write(JSON.stringify(workerSecrets(process.argv.slice(2))));
}
