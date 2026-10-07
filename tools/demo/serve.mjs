// Eddy on fictional data, for guide screenshots and trying screens out.
//   node tools/demo/serve.mjs [port]      (default 5190)
// Then open http://127.0.0.1:5190/?as=<persona>; personas are listed in README.md.
import { startDemoServer } from './server.mjs';
import { PERSONAS } from './personas.mjs';

const port = Number(process.argv[2] ?? 5190);
const server = await startDemoServer({ port });
server.printUrls();
console.log(`\n  Personas: ${Object.keys(PERSONAS).map((p) => `?as=${p}`).join('  ')}\n`);
