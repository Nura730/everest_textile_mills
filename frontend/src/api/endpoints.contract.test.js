import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression for "ordersApi.timeline is not a function": every xxxApi.method(...) used anywhere in the
// frontend must exist in api/endpoints.js (a missing one only fails at runtime, on that screen).
const SRC = fileURLToPath(new URL('..', import.meta.url));

function defined() {
  const text = readFileSync(join(SRC, 'api', 'endpoints.js'), 'utf8').replace(/\r\n/g, '\n');
  const apis = {};
  for (const m of text.matchAll(/export const (\w+Api) = \{([\s\S]*?)\n\};/g)) apis[m[1]] = new Set([...m[2].matchAll(/^\s+(\w+):/gm)].map((x) => x[1]));
  return apis;
}
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.jsx?$/.test(name) && !name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

test('every API method the screens call is defined in endpoints.js', () => {
  const apis = defined();
  const missing = [];
  for (const file of sources(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\b(\w+Api)\.(\w+)\(/g)) {
      if (apis[m[1]] && !apis[m[1]].has(m[2])) missing.push(`${m[1]}.${m[2]} in ${file.slice(SRC.length)}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the order timeline method calls the backend route', async () => {
  const text = readFileSync(join(SRC, 'api', 'endpoints.js'), 'utf8');
  assert.match(text, /timeline: \(id\) => apiRequest\(`\/orders\/\$\{id\}\/timeline`\)/);
});
