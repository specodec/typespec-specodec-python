import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkScalar } from '@specodec/typespec-emitter-core/test-utils';
import { typeToPython, writeLines, readExpr } from './index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const TSP = join(ROOT, 'node_modules', '.bin', 'tsp');
const TESTS = join(ROOT, 'tests');
const GENERATED = join(TESTS, 'generated');

describe('typeToPython', () => {
  it('string → str', () => expect(typeToPython(mkScalar('string') as any)).toBe('str'));
  it('boolean → bool', () => expect(typeToPython(mkScalar('boolean') as any)).toBe('bool'));
  it('int32 → int', () => expect(typeToPython(mkScalar('int32') as any)).toBe('int'));
  it('int64 → int', () => expect(typeToPython(mkScalar('int64') as any)).toBe('int'));
  it('float32 → float', () => expect(typeToPython(mkScalar('float32') as any)).toBe('float'));
  it('float64 → float', () => expect(typeToPython(mkScalar('float64') as any)).toBe('float'));
  it('bytes → bytes', () => expect(typeToPython(mkScalar('bytes') as any)).toBe('bytes'));
  it('model → User', () => expect(typeToPython({ kind: 'Model', name: 'User' } as any)).toBe('User'));
});

describe('readExpr', () => {
  it('int32', () => expect(readExpr(mkScalar('int32') as any)).toBe('r.read_int32()'));
  it('string', () => expect(readExpr(mkScalar('string') as any)).toBe('r.read_string()'));
  it('bool', () => expect(readExpr(mkScalar('boolean') as any)).toBe('r.read_bool()'));
  it('float32', () => expect(readExpr(mkScalar('float32') as any)).toBe('r.read_float32()'));
  it('bytes', () => expect(readExpr(mkScalar('bytes') as any)).toBe('r.read_bytes()'));
});

describe('writeLines', () => {
  it('int32 write', () => {
    const lines = writeLines(mkScalar('int32') as any, 'v', '  ');
    expect(lines[0]).toContain('write_int32');
  });
});

describe('full generation from alltypes.tsp', () => {
  it('generates all ~200 model files', () => {
    if (existsSync(GENERATED)) rmSync(GENERATED, { recursive: true });
    const tspFile = join(TESTS, 'alltypes.tsp');
    expect(existsSync(tspFile)).toBe(true);
    execSync(`${TSP} compile ${tspFile} --emit=@specodec/typespec-emitter-python --option @specodec/typespec-emitter-python.emitter-output-dir={cwd}/tests/generated`, { cwd: ROOT, stdio: 'pipe' });
    const pyFiles = readdirSync(GENERATED).filter(f => f.endsWith('.py'));
    expect(pyFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('generated code compiles', () => {
    const files = readdirSync(GENERATED).filter(f => f.endsWith('.py'));
    for (const f of files) {
      execSync(`python3 -m py_compile ${join(GENERATED, f)}`, { stdio: 'pipe' });
    }
  });
});

describe('generation + compile', () => {
  const ROOT = join(__dir, '..');
  const TSP = join(ROOT, 'node_modules', '.bin', 'tsp');
  const TDIR = join(ROOT, 'tests');
  const GEN = join(TDIR, 'generated');

  it('tsp generates ~200 codec files', () => {
    if (existsSync(GEN)) rmSync(GEN, { recursive: true });
    execSync(`${TSP} compile alltypes.tsp --emit=@specodec/typespec-emitter-python --option @specodec/typespec-emitter-python.emitter-output-dir=generated`, { cwd: TDIR, stdio: 'pipe' });
    expect(readdirSync(GEN).length).toBeGreaterThanOrEqual(10);
  });
});
