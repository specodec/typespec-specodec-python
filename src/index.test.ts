import { describe, it, expect } from 'vitest';
import { mkScalar, mkArray } from '@specodec/typespec-emitter-core/test-utils';
import { typeToPython, readExpr, writeExpr, writeLines, defaultValue } from './index.js';

describe('typeToPython', () => {
  it('string → str', () => expect(typeToPython(mkScalar('string') as any)).toBe('str'));
  it('boolean → bool', () => expect(typeToPython(mkScalar('boolean') as any)).toBe('bool'));
  it('int32 → int', () => expect(typeToPython(mkScalar('int32') as any)).toBe('int'));
  it('int64 → int', () => expect(typeToPython(mkScalar('int64') as any)).toBe('int'));
  it('float32 → float', () => expect(typeToPython(mkScalar('float32') as any)).toBe('float'));
  it('float64 → float', () => expect(typeToPython(mkScalar('float64') as any)).toBe('float'));
  it('bytes → bytes', () => expect(typeToPython(mkScalar('bytes') as any)).toBe('bytes'));
  it('model → model name', () => expect(typeToPython({ kind: 'Model', name: 'User' } as any)).toBe('User'));
});

describe('readExpr', () => {
  it('int32', () => expect(readExpr(mkScalar('int32') as any)).toContain('read_int32'));
  it('string', () => expect(readExpr(mkScalar('string') as any)).toContain('read_string'));
  it('bool', () => expect(readExpr(mkScalar('boolean') as any)).toContain('read_bool'));
  it('float32', () => expect(readExpr(mkScalar('float32') as any)).toContain('read_float32'));
  it('bytes', () => expect(readExpr(mkScalar('bytes') as any)).toContain('read_bytes'));
});
