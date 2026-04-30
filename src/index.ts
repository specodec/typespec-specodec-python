import {
  EmitContext,
  emitFile,
  listServices,
  getNamespaceFullName,
  navigateTypesInNamespace,
  Model,
  Namespace,
  Interface,
  Program,
  Type,
  Scalar,
  ModelProperty,
  Diagnostic,
} from "@typespec/compiler";
import {
  isReservedKeyword,
  checkReservedKeyword,
  formatReservedError,
  formatReservedWarning,
} from "@specodec/typespec-specodec-core";

export type EmitterOptions = {
  "emitter-output-dir": string;
  "ignore-reserved-keywords"?: boolean;
};

interface FieldInfo {
  name: string;
  type: Type;
  optional: boolean;
}

interface ServiceInfo {
  namespace: Namespace;
  iface: Interface;
  serviceName: string;
  models: Model[];
}

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
  "while", "with", "yield",
]);

function safeName(name: string): string {
  return PY_KEYWORDS.has(name) ? name + "_" : name;
}

function extractFields(model: Model): FieldInfo[] {
  const fields: FieldInfo[] = [];
  for (const [name, prop] of model.properties) {
    fields.push({ name, type: prop.type, optional: prop.optional ?? false });
  }
  return fields;
}

function snakeName(s: string): string {
  return s.replace(/([A-Z])/g, (m, c, i) => (i ? "_" : "") + c.toLowerCase());
}

function scalarName(type: Type): string {
  if (type.kind === "Scalar") return (type as Scalar).name;
  return "";
}

function typeToPython(type: Type, optional: boolean = false): string {
  const n = scalarName(type);
  let base = "";
  if (n === "string") base = "str";
  else if (n === "boolean") base = "bool";
  else if (["int8","int16","int32","int64","uint8","uint16","uint32","uint64","integer"].includes(n)) base = "int";
  else if (["float32","float64","float","decimal"].includes(n)) base = "float";
  else if (n === "bytes") base = "bytes";
  else if (type.kind === "Model" && (type as Model).indexer) base = `list[${typeToPython((type as Model).indexer!.value)}]`;
  else if (type.kind === "Model" && type.name) base = type.name;
  else base = "Any";
  return optional ? `Optional[${base}]` : base;
}

// Returns lines (each prefixed with indent)
function writeJsonLines(type: Type, varExpr: string, indent: string): string[] {
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
  if (type.kind === "Model" && (type as Model).indexer) {
    const elem = (type as Model).indexer!.value;
    return [
      `${indent}w.begin_array(len(${varExpr}))`,
      `${indent}for _e in ${varExpr}:`,
      `${indent}    w.next_element()`,
      ...writeJsonLines(elem, "_e", indent + "    "),
      `${indent}w.end_array()`,
    ];
  }
  if (type.kind === "Model" && type.name) return [`${indent}_write_json_${snakeName(type.name)}(w, ${varExpr})`];
  return [`${indent}w.write_string(str(${varExpr}))`];
}

function writeMsgPackLines(type: Type, varExpr: string, indent: string): string[] {
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
  if (type.kind === "Model" && (type as Model).indexer) {
    const elem = (type as Model).indexer!.value;
    return [
      `${indent}w.begin_array(len(${varExpr}))`,
      `${indent}for _e in ${varExpr}:`,
      `${indent}    w.next_element()`,
      ...writeMsgPackLines(elem, "_e", indent + "    "),
      `${indent}w.end_array()`,
    ];
  }
  if (type.kind === "Model" && type.name) return [`${indent}_write_msgpack_${snakeName(type.name)}(w, ${varExpr})`];
  return [`${indent}w.write_string(str(${varExpr}))`];
}

function readExpr(type: Type): string {
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
  if (type.kind === "Model" && (type as Model).indexer) {
    const elem = (type as Model).indexer!.value;
    return `_decode_array(r, lambda: ${readExpr(elem)})`;
  }
  if (type.kind === "Model" && type.name) return `_decode_${snakeName(type.name)}(r)`;
  return `r.read_string()`;
}

function emitModelFunctions(m: Model, L: string[]): void {
  if (!m.name) return;
  const fields = extractFields(m);
  const required = fields.filter(f => !f.optional);
  const optional = fields.filter(f => f.optional);
  const sn = snakeName(m.name);

  // _write_json_${name}(w, obj)
  L.push(`def _write_json_${sn}(w: JsonWriter, obj: ${m.name}) -> None:`);
  if (fields.length === 0) {
    L.push(`    w.begin_object()`);
    L.push(`    w.end_object()`);
  } else {
    L.push(`    w.begin_object()`);
    for (const f of fields) {
      const fsn = safeName(f.name);
      if (f.optional) {
        L.push(`    if obj.${fsn} is not None:`);
        L.push(`        w.write_field("${f.name}")`);
        for (const line of writeJsonLines(f.type, `obj.${fsn}`, "        ")) L.push(line);
      } else {
        L.push(`    w.write_field("${f.name}")`);
        for (const line of writeJsonLines(f.type, `obj.${fsn}`, "    ")) L.push(line);
      }
    }
    L.push(`    w.end_object()`);
  }
  L.push("");

  // _write_msgpack_${name}(w, obj)
  L.push(`def _write_msgpack_${sn}(w: MsgPackWriter, obj: ${m.name}) -> None:`);
  if (optional.length === 0) {
    L.push(`    w.begin_object(${fields.length})`);
  } else {
    L.push(`    _n = ${required.length}`);
    for (const f of optional) {
      L.push(`    if obj.${safeName(f.name)} is not None: _n += 1`);
    }
    L.push(`    w.begin_object(_n)`);
  }
  for (const f of fields) {
    const fsn = safeName(f.name);
    if (f.optional) {
      L.push(`    if obj.${fsn} is not None:`);
      L.push(`        w.write_field("${f.name}")`);
      for (const line of writeMsgPackLines(f.type, `obj.${fsn}`, "        ")) L.push(line);
    } else {
      L.push(`    w.write_field("${f.name}")`);
      for (const line of writeMsgPackLines(f.type, `obj.${fsn}`, "    ")) L.push(line);
    }
  }
  L.push(`    w.end_object()`);
  L.push("");

  // _decode_${name}(r)
  L.push(`def _decode_${sn}(r: SpecReader) -> ${m.name}:`);
  L.push(`    _kw: dict = {}`);
  L.push(`    r.begin_object()`);
  L.push(`    while r.has_next_field():`);
  L.push(`        _k = r.read_field_name()`);
    for (const f of fields) {
      L.push(`        if _k == "${f.name}": _kw["${safeName(f.name)}"] = ${readExpr(f.type)}; continue`);
    }
  L.push(`        r.skip()`);
  L.push(`    r.end_object()`);
  L.push(`    return ${m.name}(**_kw)`);
  L.push("");
}

function collectServices(program: Program): ServiceInfo[] {
  const services = listServices(program);
  const result: ServiceInfo[] = [];
  
  function collectFromNs(ns: Namespace, iface?: Interface) {
    const models: Model[] = [];
    const seen = new Set<string>();
    navigateTypesInNamespace(ns, {
      model: (m: Model) => {
        if (m.name && !seen.has(m.name)) { models.push(m); seen.add(m.name); }
      },
    });
    if (models.length > 0) {
      result.push({ 
        namespace: ns, 
        iface: iface || { name: ns.name || "TestService", namespace: ns } as Interface, 
        serviceName: iface?.name || ns.name || "TestService", 
        models 
      });
    }
  }
  
  for (const svc of services) collectFromNs(svc.type);
  if (result.length === 0) {
    const globalNs = program.getGlobalNamespaceType();
    for (const [, ns] of globalNs.namespaces) collectFromNs(ns);
    collectFromNs(globalNs);
  }
  return result;
}

export async function $onEmit(context: EmitContext<EmitterOptions>) {
  const program = context.program;
  const outputDir = context.emitterOutputDir;
  const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
  const services = collectServices(program);

  // Check all field names for reserved keywords across all languages
  const reservedFieldErrors: Diagnostic[] = [];
  for (const svc of services) {
    for (const m of svc.models) {
      if (!m.name) continue;
      for (const [fieldName, prop] of m.properties) {
        const reservedIn = checkReservedKeyword(fieldName);
        if (reservedIn.length > 0) {
          const message = formatReservedError(fieldName, m.name, reservedIn);
          const diag: Diagnostic = {
            severity: "error",
            code: "reserved-keyword",
            message,
            target: prop,
          };
          reservedFieldErrors.push(diag);
        }
      }
    }
  }

  // If any reserved keywords found and not ignoring, report errors and abort
  if (reservedFieldErrors.length > 0 && !ignoreReservedKeywords) {
    program.reportDiagnostics(reservedFieldErrors);
    return;
  }

  // If ignoring, just log warnings (but continue)
  if (reservedFieldErrors.length > 0 && ignoreReservedKeywords) {
    for (const diag of reservedFieldErrors) {
      console.warn(`Warning: ${diag.message}`);
    }
  }

  for (const svc of services) {
    const L: string[] = [];
    L.push("# Generated by @specodec/typespec-specodec-python. DO NOT EDIT.");
    L.push("from __future__ import annotations");
    L.push("from dataclasses import dataclass");
    L.push("from typing import Optional, Any, Callable, List, TypeVar");
    L.push("from specodec import JsonWriter, MsgPackWriter, SpecReader, SpecCodec");
    L.push("");
    L.push("T = TypeVar('T')");
    L.push("");
    L.push("def _decode_array(r: SpecReader, elem_fn: Callable[[], T]) -> List[T]:");
    L.push("    result: List[T] = []");
    L.push("    r.begin_array()");
    L.push("    while r.has_next_element():");
    L.push("        result.append(elem_fn())");
    L.push("    r.end_array()");
    L.push("    return result");
    L.push("");

    // 1. Dataclasses (required first, then optional)
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

    // 2. Internal helpers
    for (const m of svc.models) {
      emitModelFunctions(m, L);
    }

    // 3. Exported SpecCodec instances — wrap helpers in simple functions
    for (const m of svc.models) {
      if (!m.name) continue;
      const sn = snakeName(m.name);
      L.push(`def _encode_json_${sn}(obj: ${m.name}) -> bytes:`);
      L.push(`    w = JsonWriter()`);
      L.push(`    _write_json_${sn}(w, obj)`);
      L.push(`    return w.to_bytes()`);
      L.push("");
      L.push(`def _encode_msgpack_${sn}(obj: ${m.name}) -> bytes:`);
      L.push(`    w = MsgPackWriter()`);
      L.push(`    _write_msgpack_${sn}(w, obj)`);
      L.push(`    return w.to_bytes()`);
      L.push("");
      L.push(`${m.name}Codec: SpecCodec = SpecCodec(`);
      L.push(`    encode_json=_encode_json_${sn},`);
      L.push(`    encode_msgpack=_encode_msgpack_${sn},`);
      L.push(`    decode=_decode_${sn},`);
      L.push(`)`);
      L.push("");
    }

    const fileName = `${snakeName(svc.serviceName)}_types.py`;
    await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
  }
}
