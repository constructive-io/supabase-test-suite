import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import { committedRoot, FORWARD_MODULE, materializeAll, REVERSE_MODULE } from '../src/materialize-fixtures';

// The committed modules under `portability/materialized/packages` are a build
// artifact of the apply proxies. Materialization is deterministic, so this is
// the drift gate: re-materialize into a temp dir and assert the output is
// byte-identical to what is committed. If a source module, the vendor shape, or
// the transform engine changes the emitted SQL, this fails until the artifact
// is regenerated (`ts-node src/materialize-fixtures.ts`) and reviewed.
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pgpm-materialize-drift-'));
  await materializeAll(tmpRoot);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe.each([FORWARD_MODULE, REVERSE_MODULE])('committed materialized module: %s', moduleName => {
  const committedDir = join(committedRoot, moduleName);
  // Lazy: tmpRoot is created in beforeAll, after this factory runs at collection.
  const freshDir = () => join(tmpRoot, moduleName);

  it('is an ordinary pgpm module (no pgpm.apply.json)', () => {
    expect(existsSync(join(committedDir, 'pgpm.apply.json'))).toBe(false);
    expect(existsSync(join(committedDir, 'pgpm.plan'))).toBe(true);
    expect(existsSync(join(committedDir, `${moduleName}.control`))).toBe(true);
    expect(existsSync(join(committedDir, 'deploy'))).toBe(true);
    expect(existsSync(join(committedDir, 'revert'))).toBe(true);
    expect(existsSync(join(committedDir, 'verify'))).toBe(true);
  });

  it('has the same file set as a fresh materialization', () => {
    expect(listFiles(committedDir)).toEqual(listFiles(freshDir()));
  });

  it('is byte-identical to a fresh materialization (no drift)', () => {
    for (const rel of listFiles(committedDir)) {
      expect(readFileSync(join(committedDir, rel), 'utf-8')).toBe(
        readFileSync(join(freshDir(), rel), 'utf-8')
      );
    }
  });
});
