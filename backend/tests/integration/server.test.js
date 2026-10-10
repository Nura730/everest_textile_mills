import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));

// Starts src/server.js as a real process. Inherits PATH/SystemRoot (needed for sockets on Windows)
// but never the parent's MONGODB_URI, and NODE_ENV=test means no local .env is read.
function startServer(envOverrides) {
  const env = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info' };
  delete env.MONGODB_URI;
  Object.assign(env, envOverrides);

  const child = spawn(process.execPath, ['src/server.js'], { cwd: BACKEND_DIR, env });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => (output.stdout += chunk));
  child.stderr.on('data', (chunk) => (output.stderr += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output, exited };
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
}

const randomPort = () => 40000 + Math.floor(Math.random() * 10000);

describe('server process', () => {
  it('exits 1 and names the bad variable when config is invalid, without echoing secrets', async () => {
    const { output, exited } = startServer({ PORT: 'not-a-port' });

    expect(await exited).toBe(1);
    expect(output.stderr).toMatch(/MONGODB_URI: is required/);
    expect(output.stderr).toMatch(/PORT/);
    expect(output.stderr).not.toContain('not-a-port');
  });

  it('exits 1 quickly when MongoDB is unreachable', async () => {
    const started = Date.now();
    const { output, exited } = startServer({ MONGODB_URI: 'mongodb://127.0.0.1:1/everest', PORT: String(randomPort()) });

    expect(await exited).toBe(1);
    expect(Date.now() - started).toBeLessThan(15000);
    expect(output.stdout).toContain('Could not connect to MongoDB');
  });

  it('starts, connects and serves /api/health', async () => {
    const port = randomPort();
    const { child, output, exited } = startServer({ MONGODB_URI: process.env.MONGODB_URI, PORT: String(port) });

    try {
      await waitFor(() => output.stdout.includes('Everest backend listening'), 15000);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);

      expect(res.status).toBe(200);
      expect((await res.json()).data.db).toBe('connected');
    } finally {
      child.kill();
      await exited;
    }
  });

  // Windows has no real SIGTERM: child.kill() terminates the process without running handlers.
  const itOnPosix = process.platform === 'win32' ? it.skip : it;

  itOnPosix('shuts down gracefully on SIGTERM and exits 0', async () => {
    const port = randomPort();
    const { child, output, exited } = startServer({ MONGODB_URI: process.env.MONGODB_URI, PORT: String(port) });

    await waitFor(() => output.stdout.includes('Everest backend listening'), 15000);
    child.kill('SIGTERM');

    expect(await exited).toBe(0);
    expect(output.stdout).toContain('Shutdown complete');
  });
});
