import {
  EmitContext,
  emitFile,
  Model,
  Type,
} from "@typespec/compiler";
import {
  collectServices,
  ServiceInfo,
  BaseEmitterOptions,
  FieldInfo,
  extractFields,
  scalarName,
  isArrayType,
  isRecordType,
  arrayElementType,
  recordElementType,
  toSnakeCase,
  RESERVED_KEYWORDS,
  checkAndReportReservedKeywords,
} from "@specodec/typespec-emitter-core";

export type EmitterOptions = BaseEmitterOptions;

function safeName(name: string): string {
  return RESERVED_KEYWORDS.python.has(name) ? name + "_" : name;
}

function typeToPython(type: Type, optional: boolean = false): string {
  const n = scalarName(type);
  let base = "";
  if (n === "string") base = "str";
  else if (n === "boolean") base = "bool";
  else if (["int8","int16","int32","int64","uint8","uint16","uint32","uint64","integer"].includes(n)) base = "int";
  else if (["float32","float64","float","decimal"].includes(n)) base = "float";
  else if (n === "bytes") base = "bytes";
  else if (isArrayType(type)) base = `list[${typeToPython(arrayElementType(type))}]`;
  else if (isRecordType(type)) base = `dict[str, ${typeToPython(recordElementType(type))}]`;
  else if (type.kind === "Model" && (type as Model).name) base = (type as Model).name;
  else base = "Any";
  return optional ? `Optional[${base}]` : base;
}

function writeLines(type: Type, varExpr: string, indent: string): string[] {
  const n = scalarName(type);
  if (n === "string") return [`${indent}w.write_string(${varExpr})`];
  if (n === "boolean") return [`${indent}w.write_bool(${varExpr})`];
  if (["int8","int16","int32","integer"].includes(n)) return [`${indent}w.write_int32(int(${varExpr}))`];
  if (n === "int64") return [`${indent}w.write_int64(int(${varExpr}))`];
  if (["uint8","uint16","uint32"].includes(n)) return [`${indent}w.write_uint32(int(${varExpr}))`];
  if (n === "uint64") return [`${indent}w.write_uint64(int(${varExpr}))`];
  if (n === "float32") return [`${indent}w.write_float32(float(${varExpr}))`];
  if (["float64","float","decimal"].includes(n)) return [`${indent}w.write_float64(float(${varExpr}))`];
  if (n === "bytes") return [`${indent}w.write_bytes(${varExpr})`];
  if (isArrayType(type)) {
    const elem = arrayElementType(type);
    return [
      `${indent}w.begin_array(len(${varExpr}))`,
      `${indent}for _e in ${varExpr}:`,
      `${indent}    w.next_element()`,
      ...writeLines(elem, "_e", indent + "    "),
      `${indent}w.end_array()`,
    ];
  }
  if (isRecordType(type)) {
    const elem = recordElementType(type);
    return [
      `${indent}w.begin_object(len(${varExpr}))`,
      `${indent}for _k, _v in ${varExpr}.items():`,
      `${indent}    w.write_field(_k)`,
      ...writeLines(elem, "_v", indent + "    "),
      `${indent}w.end_object()`,
    ];
  }
  if (type.kind === "Model" && (type as Model).name) return [`${indent}_write_${toSnakeCase((type as Model).name)}(w, ${varExpr})`];
  return [`${indent}w.write_string(str(${varExpr}))`];
}

function readExpr(type: Type, optional?: boolean): string {
  const n = scalarName(type);
  if (n === "string") return `r.read_string()`;
  if (n === "boolean") return `r.read_bool()`;
  if (["int8","int16","int32","integer"].includes(n)) return `r.read_int32()`;
  if (n === "int64") return `r.read_int64()`;
  if (["uint8","uint16","uint32"].includes(n)) return `r.read_uint32()`;
  if (n === "uint64") return `r.read_uint64()`;
  if (n === "float32") return `r.read_float32()`;
  if (["float64","float","decimal"].includes(n)) return `r.read_float64()`;
  if (n === "bytes") return `r.read_bytes()`;
  if (isArrayType(type)) {
    const elem = arrayElementType(type);
    const arrExpr = `(lambda: (_arr := [], r.begin_array(), [_arr.append(${readExpr(elem)}) for _ in iter(r.has_next_element, False)], r.end_array(), _arr)[-1])()`;
    if (optional) return `r.read_null() if r.is_null() else ${arrExpr}`;
    return arrExpr;
  }
  if (isRecordType(type)) {
    const elem = recordElementType(type);
    const mapExpr = `(lambda: (_map := {}, r.begin_object(), [_map.__setitem__(r.read_field_name(), ${readExpr(elem)}) for _ in iter(r.has_next_field, False)], r.end_object(), _map)[-1])()`;
    if (optional) return `r.read_null() if r.is_null() else ${mapExpr}`;
    return mapExpr;
  }
  if (type.kind === "Model" && (type as Model).name) {
    if (optional) return `r.read_null() if r.is_null() else _decode_${toSnakeCase((type as Model).name)}(r)`;
    return `_decode_${toSnakeCase((type as Model).name)}(r)`;
  }
  return `r.read_string()`;
}

function emitModelFunctions(m: Model, L: string[]): void {
  if (!m.name) return;
  const fields = extractFields(m);
  const required = fields.filter(f => !f.optional);
  const optional = fields.filter(f => f.optional);
  const sn = toSnakeCase(m.name);

  L.push(`def _write_${sn}(w: SpecWriter, obj: ${m.name}) -> None:`);
  if (optional.length === 0) {
    L.push(`    w.begin_object(${fields.length})`);
  } else {
    L.push(`    _n = ${required.length}`);
    for (const f of optional) L.push(`    if obj.${safeName(f.name)} is not None: _n += 1`);
    L.push(`    w.begin_object(_n)`);
  }
  for (const f of fields) {
    const fsn = safeName(f.name);
    if (f.optional) {
      L.push(`    if obj.${fsn} is not None:`);
      L.push(`        w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fsn}`, "        ")) L.push(line);
    } else {
      L.push(`    w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fsn}`, "    ")) L.push(line);
    }
  }
  L.push(`    w.end_object()`);
  L.push("");

  L.push(`def _decode_${sn}(r: SpecReader) -> ${m.name}:`);
  L.push(`    _kw: dict = {}`);
  L.push(`    r.begin_object()`);
  L.push(`    while r.has_next_field():`);
  L.push(`        _k = r.read_field_name()`);
  for (const f of fields) {
    L.push(`        if _k == "${f.name}": _kw["${safeName(f.name)}"] = ${readExpr(f.type, f.optional)}; continue`);
  }
  L.push(`        r.skip()`);
  L.push(`    r.end_object()`);
  L.push(`    return ${m.name}(**_kw)`);
  L.push("");
}

export async function $onEmit(context: EmitContext<EmitterOptions>) {
  const program = context.program;
  const outputDir = context.emitterOutputDir;
  const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
  const services = collectServices(program);

  if (checkAndReportReservedKeywords(program, services, ignoreReservedKeywords)) return;

  for (const svc of services) {
    const L: string[] = [];
    L.push("# Generated by @specodec/typespec-emitter-python. DO NOT EDIT.");
    L.push("from __future__ import annotations");
    L.push("from dataclasses import dataclass");
    L.push("from typing import Optional, Any, Callable, List, TypeVar");
    L.push("from specodec import SpecWriter, SpecReader, SpecCodec");
    L.push("");
    L.push("T = TypeVar('T')");
    L.push("");

    for (const m of svc.models) {
      if (!m.name) continue;
      const fields = extractFields(m);
      const required = fields.filter(f => !f.optional);
      const optional = fields.filter(f => f.optional);
      L.push("@dataclass");
      L.push(`class ${m.name}:`);
      if (fields.length === 0) {
        L.push("    pass");
      } else {
        for (const f of required) L.push(`    ${safeName(f.name)}: ${typeToPython(f.type)}`);
        for (const f of optional) L.push(`    ${safeName(f.name)}: ${typeToPython(f.type, true)} = None`);
      }
      L.push("");
    }

    for (const m of svc.models) emitModelFunctions(m, L);

    for (const m of svc.models) {
      if (!m.name) continue;
      const sn = toSnakeCase(m.name);
      L.push(`${m.name}Codec: SpecCodec = SpecCodec(`);
      L.push(`    encode=_write_${sn},`);
      L.push(`    decode=_decode_${sn},`);
      L.push(`)`);
      L.push("");
    }

    const fileName = `${toSnakeCase(svc.serviceName)}_types.py`;
    await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
  }
}
