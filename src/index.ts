import { type EmitContext, emitFile, type Enum, type Model, type Type, type Union } from "@typespec/compiler";
import {
  collectServices,
  type BaseEmitterOptions,
  type EnumInfo,
  type EnumMemberInfo,
  type UnionInfo,
  type UnionVariantInfo,
  extractFields,
  scalarName,
  isArrayType,
  isRecordType,
  isUnionType,
  isScalarVariant,
  arrayElementType,
  recordElementType,
  toSnakeCase,
  dottedPathToSnakeCase,
  checkAndReportReservedKeywords,
  safeFieldName,
} from "@specodec/typespec-emitter-core";

export type EmitterOptions = BaseEmitterOptions;

function fieldPy(name: string): string {
  return safeFieldName("python", toSnakeCase(name));
}

function typeToPython(type: Type, optional: boolean = false): string {
  const n = scalarName(type);
  let base = "";
  if (n === "string") base = "str";
  else if (n === "boolean") base = "bool";
  else if (["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "integer"].includes(n))
    base = "int";
  else if (["float32", "float64", "float", "decimal"].includes(n)) base = "float";
  else if (n === "bytes") base = "bytes";
  else if (type.kind === "Enum") base = "str";
  else if (isArrayType(type)) base = `list[${typeToPython(arrayElementType(type)!)}]`;
  else if (isRecordType(type)) base = `dict[str, ${typeToPython(recordElementType(type)!)}]`;
  else if (type.kind === "Model" && (type as Model).name) base = (type as Model).name;
  else if (type.kind === "Union") base = (type as Union).name!;
  else base = "Any";
  return optional ? `Optional[${base}]` : base;
}

let writeLoopCounter = 0;
let fieldReadCounter = 0;

function writeLines(type: Type, varExpr: string, indent: string): string[] {
  const n = scalarName(type);
  if (n === "string") return [`${indent}w.write_string(${varExpr})`];
  if (n === "boolean") return [`${indent}w.write_bool(${varExpr})`];
  if (["int8", "int16", "int32", "integer"].includes(n)) return [`${indent}w.write_int32(int(${varExpr}))`];
  if (n === "int64") return [`${indent}w.write_int64(int(${varExpr}))`];
  if (["uint8", "uint16", "uint32"].includes(n)) return [`${indent}w.write_uint32(int(${varExpr}))`];
  if (n === "uint64") return [`${indent}w.write_uint64(int(${varExpr}))`];
  if (n === "float32") return [`${indent}w.write_float32(float(${varExpr}))`];
  if (["float64", "float", "decimal"].includes(n)) return [`${indent}w.write_float64(float(${varExpr}))`];
  if (n === "bytes") return [`${indent}w.write_bytes(${varExpr})`];
  if (isArrayType(type)) {
    const elem = arrayElementType(type)!;
    const it = `_it${writeLoopCounter++}`;
    return [
      `${indent}w.begin_array(len(${varExpr}))`,
      `${indent}for ${it} in ${varExpr}:`,
      `${indent}    w.next_element()`,
      ...writeLines(elem, it, `${indent}    `),
      `${indent}w.end_array()`,
    ];
  }
  if (isRecordType(type)) {
    const elem = recordElementType(type)!;
    const ki = `_k${writeLoopCounter++}`;
    const vi = `_v${writeLoopCounter++}`;
    return [
      `${indent}w.begin_object(len(${varExpr}))`,
      `${indent}for ${ki}, ${vi} in ${varExpr}.items():`,
      `${indent}    w.write_field(${ki})`,
      ...writeLines(elem, vi, `${indent}    `),
      `${indent}w.end_object()`,
    ];
  }
  if (type.kind === "Enum")
    return [`${indent}w.write_string(str(${varExpr}))`];
  if (type.kind === "Model" && (type as Model).name)
    return [`${indent}write_${toSnakeCase((type as Model).name)}(w, ${varExpr})`];
  if (type.kind === "Union")
    return [`${indent}write_${toSnakeCase((type as Union).name!)}(w, ${varExpr})`];
  return [`${indent}w.write_string(str(${varExpr}))`];
}

function readExpr(type: Type, optional?: boolean): string {
  const n = scalarName(type);
  if (n === "string") return `r.read_string()`;
  if (n === "boolean") return `r.read_bool()`;
  if (["int8", "int16", "int32", "integer"].includes(n)) return `r.read_int32()`;
  if (n === "int64") return `r.read_int64()`;
  if (["uint8", "uint16", "uint32"].includes(n)) return `r.read_uint32()`;
  if (n === "uint64") return `r.read_uint64()`;
  if (n === "float32") return `r.read_float32()`;
  if (["float64", "float", "decimal"].includes(n)) return `r.read_float64()`;
  if (n === "bytes") return `r.read_bytes()`;
  if (type.kind === "Enum") return "r.read_string()";
  if (type.kind === "Model" && (type as Model).name) {
    return `decode_${toSnakeCase((type as Model).name)}(r)`;
  }
  if (type.kind === "Union") {
    const sn = toSnakeCase((type as Union).name!);
    return `decode_${sn}(r)`;
  }
  return `r.read_string()`;
}


function generateFieldRead(L: string[], f: { name: string; type: Type; optional: boolean }, indent: string): string {
  const type = f.type;
  if (isArrayType(type)) {
    const elem = arrayElementType(type)!;
    const tmp = `_tmp${fieldReadCounter++}`;
    const elemRead = readExpr(elem);
    const inner = f.optional ? `    ` : ``;
    if (f.optional) {
      L.push(`${indent}if r.is_null():`);
      L.push(`${indent}    ${tmp} = None`);
      L.push(`${indent}    r.read_null()`);
      L.push(`${indent}else:`);
    }
    L.push(`${indent}${inner}${tmp} = []`);
    L.push(`${indent}${inner}r.begin_array()`);
    L.push(`${indent}${inner}while r.has_next_element():`);
    L.push(`${indent}${inner}    ${tmp}.append(${elemRead})`);
    L.push(`${indent}${inner}r.end_array()`);
    return tmp;
  }
  if (isRecordType(type)) {
    const elem = recordElementType(type)!;
    const tmp = `_tmp${fieldReadCounter++}`;
    const elemRead = readExpr(elem);
    const inner = f.optional ? `    ` : ``;
    if (f.optional) {
      L.push(`${indent}if r.is_null():`);
      L.push(`${indent}    ${tmp} = None`);
      L.push(`${indent}    r.read_null()`);
      L.push(`${indent}else:`);
    }
    L.push(`${indent}${inner}${tmp} = {}`);
    L.push(`${indent}${inner}r.begin_object()`);
    L.push(`${indent}${inner}while r.has_next_field():`);
    L.push(`${indent}${inner}    ${tmp}[r.read_field_name()] = ${elemRead}`);
    L.push(`${indent}${inner}r.end_object()`);
    return tmp;
  }
  if (f.optional && ((type.kind === "Model" && (type as Model).name) || type.kind === "Union")) {
    const tmp = `_tmp${fieldReadCounter++}`;
    const sn = toSnakeCase(type.kind === "Model" ? (type as Model).name! : (type as Union).name!);
    L.push(`${indent}if r.is_null():`);
    L.push(`${indent}    ${tmp} = None`);
    L.push(`${indent}    r.read_null()`);
    L.push(`${indent}else:`);
    L.push(`${indent}    ${tmp} = decode_${sn}(r)`);
    return tmp;
  }
  return readExpr(type);
}

function emitModelFunctions(m: Model, L: string[]): void {
  if (!m.name) return;
  const fields = extractFields(m);
  const required = fields.filter((f) => !f.optional);
  const optional = fields.filter((f) => f.optional);
  const sn = toSnakeCase(m.name);

  L.push(`def write_${sn}(w: SpecWriter, obj: ${m.name}) -> None:`);
  if (optional.length === 0) {
    L.push(`    w.begin_object(${fields.length})`);
  } else {
    L.push(`    field_count = ${required.length}`);
    for (const f of optional) {
      const fPy = fieldPy(f.name);
      L.push(`    if obj.${fPy} is not None: field_count += 1`);
    }
    L.push(`    w.begin_object(field_count)`);
  }
  for (const f of fields) {
    const fPy = fieldPy(f.name);
    if (f.optional) {
      L.push(`    if obj.${fPy} is not None:`);
      L.push(`        w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fPy}`, "        ")) L.push(line);
    } else {
      L.push(`    w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fPy}`, "    ")) L.push(line);
    }
  }
  L.push(`    w.end_object()`);
  L.push("");

  L.push(`def decode_${sn}(r: SpecReader) -> ${m.name}:`);
  L.push(`    kw: dict = {}`);
  L.push(`    r.begin_object()`);
  L.push(`    while r.has_next_field():`);
  L.push(`        key = r.read_field_name()`);
  fieldReadCounter = 0;
  for (const f of fields) {
    const fPy = fieldPy(f.name);
    const val = generateFieldRead(L, f, "        ");
    L.push(`        if key == "${f.name}": kw["${fPy}"] = ${val}; continue`);
  }
  L.push(`        r.skip()`);
  L.push(`    r.end_object()`);
  L.push(`    return ${m.name}(**kw)`);
  L.push("");
}

function generateEnumCode(e: EnumInfo): string[] {
  const lines: string[] = [];
  lines.push(`class ${e.name}(enum.IntEnum):`);
  for (const m of e.members) {
    lines.push(`    ${m.name} = ${m.value}`);
  }
  return lines;
}

function generateUnionCode(u: UnionInfo, L: string[]): void {
  const snakeName = toSnakeCase(u.name);
  const undefCls = `${u.name}Undefined`;

  for (const v of u.variants) {
    const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
    const wrapper = `${u.name}${pascal}`;
    const pyType = typeToPython(v.type);
    L.push("@dataclass");
    L.push(`class ${wrapper}:`);
    L.push(`    value: ${pyType}`);
    L.push("");
  }

  L.push("@dataclass");
  L.push(`class ${undefCls}:`);
  L.push(`    value: SpecUndefined`);
  L.push("");

  const wrappers = u.variants.map(
    (v) => `${u.name}${v.name.charAt(0).toUpperCase() + v.name.slice(1)}`
  );
  wrappers.push(undefCls);
  L.push(`${u.name} = Union[${wrappers.join(", ")}]`);
  L.push("");

  L.push(`def write_${snakeName}(w: SpecWriter, obj: ${u.name}) -> None:`);
  L.push(`    w.begin_object(1)`);
  for (let i = 0; i < u.variants.length; i++) {
    const v = u.variants[i];
    const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
    const wrapper = `${u.name}${pascal}`;
    const stmts = writeLines(v.type, "obj.value", "").join("; ");
    const kw = i === 0 ? "if" : "elif";
    L.push(`    ${kw} isinstance(obj, ${wrapper}): w.write_field("${v.name}"); ${stmts}`);
  }
  L.push(`    else: raise ValueError("cannot encode Undefined")`);
  L.push(`    w.end_object()`);
  L.push("");

  L.push(`def decode_${snakeName}(r: SpecReader) -> ${u.name}:`);
  L.push(`    r.begin_object()`);
  L.push(`    if not r.has_next_field(): r.end_object(); raise ValueError("empty union ${u.name}")`);
  L.push(`    field = r.read_field_name()`);
  L.push(`    result: ${u.name} = ${undefCls}(value=SpecUndefined())`);
  for (let i = 0; i < u.variants.length; i++) {
    const v = u.variants[i];
    const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
    const wrapper = `${u.name}${pascal}`;
    const kw = i === 0 ? "if" : "elif";
    L.push(`    ${kw} field == "${v.name}": result = ${wrapper}(value=${readExpr(v.type)})`);
  }
  L.push(`    else: raise ValueError(f"unknown variant {field}")`);
  L.push(`    while r.has_next_field(): r.read_field_name(); r.skip()`);
  L.push(`    r.end_object()`);
  L.push(`    return result`);
  L.push("");
}

export async function $onEmit(context: EmitContext<EmitterOptions>) {
  const program = context.program;
  const outputDir = context.emitterOutputDir;
  const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
  const services = collectServices(program);

  if (checkAndReportReservedKeywords(program, services, ignoreReservedKeywords)) return;

  // Build model→namespace map for cross-namespace imports
  const pyModelNs = new Map<string, string>();
  for (const s of services) {
    for (const m of s.models) { if (m.name) pyModelNs.set(m.name, s.serviceName); }
    for (const e of s.enums) { if (e.name) pyModelNs.set(e.name, s.serviceName); }
    for (const u of s.unions) { if (u.name) pyModelNs.set(u.name, s.serviceName); }
  }

  for (const svc of services) {
    const L: string[] = [];
    L.push("# Generated by @specodec/typespec-emitter-python. DO NOT EDIT.");
    L.push("from __future__ import annotations");
    L.push("import enum");
    L.push("from dataclasses import dataclass");
    L.push("from typing import Optional, Any, Callable, List, Union");
    L.push("from specodec import SpecWriter, SpecReader, SpecCodec, SpecUndefined");

    // Cross-namespace imports: re-export all functions from referenced parent namespaces
    const xrefNs = new Set<string>();
    for (const m of svc.models) {
      if (!m.name) continue;
      for (const f of extractFields(m)) {
        const collectX = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = pyModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) xrefNs.add(dottedPathToSnakeCase(ns));
          }
          if (isArrayType(t)) collectX(arrayElementType(t)!);
          if (isRecordType(t)) collectX(recordElementType(t)!);
        };
        collectX(f.type);
      }
    }
    for (const u of svc.unions) {
      for (const v of u.variants) {
        const collectX = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = pyModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) xrefNs.add(dottedPathToSnakeCase(ns));
          }
          if (isArrayType(t)) collectX(arrayElementType(t)!!);
          if (isRecordType(t)) collectX(recordElementType(t)!!);
        };
        collectX(v.type);
      }
    }
    for (const ns of [...xrefNs].sort()) {
      L.push(`from .${ns}_types import *`);
    }

    L.push("");

    for (const m of svc.models) {
      if (!m.name) continue;
      const fields = extractFields(m);
      const required = fields.filter((f) => !f.optional);
      const optional = fields.filter((f) => f.optional);
      L.push("@dataclass");
      L.push(`class ${m.name}:`);
      if (fields.length === 0) {
        L.push("    pass");
      } else {
        for (const f of required) {
          const fPy = fieldPy(f.name);
          L.push(`    ${fPy}: ${typeToPython(f.type)}`);
        }
        for (const f of optional) {
          const fPy = fieldPy(f.name);
          L.push(`    ${fPy}: ${typeToPython(f.type, true)} = None`);
        }
      }
      L.push("");
    }

    for (const e of svc.enums) {
      L.push(...generateEnumCode(e));
      L.push("");
    }

    for (const u of svc.unions) {
      generateUnionCode(u, L);
    }

    for (const m of svc.models) emitModelFunctions(m, L);

    for (const m of svc.models) {
      if (!m.name) continue;
      const sn = toSnakeCase(m.name);
      L.push(`${m.name}Codec: SpecCodec = SpecCodec(`);
      L.push(`    encode=write_${sn},`);
      L.push(`    decode=decode_${sn},`);
      L.push(`)`);
      L.push("");
    }

    for (const u of svc.unions) {
      if (!u.name) continue;
      const sn = toSnakeCase(u.name);
      L.push(`${u.name}Codec: SpecCodec = SpecCodec(`);
      L.push(`    encode=write_${sn},`);
      L.push(`    decode=decode_${sn},`);
      L.push(`)`);
      L.push("");
    }

    const fileName = `${dottedPathToSnakeCase(svc.serviceName)}_types.py`;
    await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
  }

  let barrelContent = "# Generated by @specodec/typespec-emitter-python. DO NOT EDIT.\n";
  for (const svc of services) {
    barrelContent += `from .${dottedPathToSnakeCase(svc.serviceName)}_types import *\n`;
  }
  await emitFile(program, { path: `${outputDir}/__init__.py`, content: barrelContent });
}
