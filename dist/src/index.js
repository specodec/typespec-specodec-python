import { emitFile, listServices, navigateTypesInNamespace, } from "@typespec/compiler";
function extractFields(model) {
    const fields = [];
    for (const [name, prop] of model.properties) {
        fields.push({ name, type: prop.type, optional: prop.optional ?? false });
    }
    return fields;
}
function snake(s) {
    return s.replace(/([A-Z])/g, (m, c, i) => (i ? "_" : "") + c.toLowerCase());
}
function scalarName(type) {
    if (type.kind === "Scalar")
        return type.name;
    return "";
}
function typeToPython(type, optional = false) {
    const n = scalarName(type);
    let base = "";
    if (n === "string")
        base = "str";
    else if (n === "boolean")
        base = "bool";
    else if (["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "integer"].includes(n))
        base = "int";
    else if (["float32", "float64", "float", "decimal"].includes(n))
        base = "float";
    else if (n === "bytes")
        base = "bytes";
    else if (type.kind === "Model" && type.indexer)
        base = `list[${typeToPython(type.indexer.value)}]`;
    else if (type.kind === "Model" && type.name)
        base = type.name;
    else
        base = "Any";
    return optional ? `Optional[${base}]` : base;
}
function writeJsonExpr(type, varExpr, indent) {
    const n = scalarName(type);
    if (n === "string")
        return [`${indent}w.write_string(${varExpr})`];
    if (n === "boolean")
        return [`${indent}w.write_bool(${varExpr})`];
    if (["int8", "int16", "int32", "integer"].includes(n))
        return [`${indent}w.write_int32(int(${varExpr}))`];
    if (n === "int64")
        return [`${indent}w.write_int64(int(${varExpr}))`];
    if (["uint8", "uint16", "uint32"].includes(n))
        return [`${indent}w.write_uint32(int(${varExpr}))`];
    if (n === "uint64")
        return [`${indent}w.write_uint64(int(${varExpr}))`];
    if (n === "float32")
        return [`${indent}w.write_float32(float(${varExpr}))`];
    if (["float64", "float", "decimal"].includes(n))
        return [`${indent}w.write_float64(float(${varExpr}))`];
    if (n === "bytes")
        return [`${indent}w.write_bytes(${varExpr})`];
    if (type.kind === "Model" && type.indexer) {
        const elem = type.indexer.value;
        return [
            `${indent}w.begin_array(len(${varExpr}))`,
            `${indent}for _e in ${varExpr}:`,
            `${indent}    w.next_element()`,
            ...writeJsonExpr(elem, "_e", indent + "    "),
            `${indent}w.end_array()`,
        ];
    }
    if (type.kind === "Model" && type.name)
        return [`${indent}${type.name}Codec.encode_json_into(w, ${varExpr})`];
    return [`${indent}w.write_string(str(${varExpr}))`];
}
function writeMsgPackExpr(type, varExpr, indent) {
    const n = scalarName(type);
    if (n === "string")
        return [`${indent}w.write_string(${varExpr})`];
    if (n === "boolean")
        return [`${indent}w.write_bool(${varExpr})`];
    if (["int8", "int16", "int32", "integer"].includes(n))
        return [`${indent}w.write_int32(int(${varExpr}))`];
    if (n === "int64")
        return [`${indent}w.write_int64(int(${varExpr}))`];
    if (["uint8", "uint16", "uint32"].includes(n))
        return [`${indent}w.write_uint32(int(${varExpr}))`];
    if (n === "uint64")
        return [`${indent}w.write_uint64(int(${varExpr}))`];
    if (n === "float32")
        return [`${indent}w.write_float32(float(${varExpr}))`];
    if (["float64", "float", "decimal"].includes(n))
        return [`${indent}w.write_float64(float(${varExpr}))`];
    if (n === "bytes")
        return [`${indent}w.write_bytes(${varExpr})`];
    if (type.kind === "Model" && type.indexer) {
        const elem = type.indexer.value;
        return [
            `${indent}w.begin_array(len(${varExpr}))`,
            `${indent}for _e in ${varExpr}:`,
            `${indent}    w.next_element()`,
            ...writeMsgPackExpr(elem, "_e", indent + "    "),
            `${indent}w.end_array()`,
        ];
    }
    if (type.kind === "Model" && type.name)
        return [`${indent}${type.name}Codec.encode_msgpack_into(w, ${varExpr})`];
    return [`${indent}w.write_string(str(${varExpr}))`];
}
function readExpr(type) {
    const n = scalarName(type);
    if (n === "string")
        return `r.read_string()`;
    if (n === "boolean")
        return `r.read_bool()`;
    if (["int8", "int16", "int32", "integer"].includes(n))
        return `r.read_int32()`;
    if (n === "int64")
        return `r.read_int64()`;
    if (["uint8", "uint16", "uint32"].includes(n))
        return `r.read_uint32()`;
    if (n === "uint64")
        return `r.read_uint64()`;
    if (n === "float32")
        return `r.read_float32()`;
    if (["float64", "float", "decimal"].includes(n))
        return `r.read_float64()`;
    if (n === "bytes")
        return `r.read_bytes()`;
    if (type.kind === "Model" && type.indexer) {
        return `_decode_array(r, lambda: ${readExpr(type.indexer.value)})`;
    }
    if (type.kind === "Model" && type.name)
        return `${type.name}Codec.decode(r)`;
    return `r.read_string()`;
}
function collectServices(program) {
    const services = listServices(program);
    const result = [];
    function collectFromNs(ns) {
        for (const [, iface] of ns.interfaces) {
            const models = [];
            const seen = new Set();
            navigateTypesInNamespace(ns, {
                model: (m) => {
                    if (m.name && !seen.has(m.name)) {
                        models.push(m);
                        seen.add(m.name);
                    }
                },
            });
            result.push({ namespace: ns, iface, serviceName: iface.name, models });
        }
    }
    for (const svc of services)
        collectFromNs(svc.type);
    if (result.length === 0) {
        const globalNs = program.getGlobalNamespaceType();
        for (const [, ns] of globalNs.namespaces)
            collectFromNs(ns);
        collectFromNs(globalNs);
    }
    return result;
}
export async function $onEmit(context) {
    const program = context.program;
    const outputDir = context.emitterOutputDir;
    const services = collectServices(program);
    for (const svc of services) {
        const L = [];
        L.push("# Generated by @specodec/typespec-specodec-python. DO NOT EDIT.");
        L.push("from __future__ import annotations");
        L.push("from dataclasses import dataclass, field");
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
        for (const m of svc.models) {
            if (!m.name)
                continue;
            const fields = extractFields(m);
            const required = fields.filter(f => !f.optional);
            const optional = fields.filter(f => f.optional);
            // dataclass
            L.push("@dataclass");
            L.push(`class ${m.name}:`);
            if (fields.length === 0) {
                L.push("    pass");
            }
            else {
                for (const f of required) {
                    L.push(`    ${f.name}: ${typeToPython(f.type)}`);
                }
                for (const f of optional) {
                    L.push(`    ${f.name}: ${typeToPython(f.type, true)} = None`);
                }
            }
            L.push("");
            // codec
            L.push(`class _${m.name}Codec:`);
            // encode_json
            L.push(`    @staticmethod`);
            L.push(`    def encode_json(obj: ${m.name}) -> bytes:`);
            L.push(`        w = JsonWriter()`);
            L.push(`        _${m.name}Codec.encode_json_into(w, obj)`);
            L.push(`        return w.to_bytes()`);
            // encode_json_into
            L.push(`    @staticmethod`);
            L.push(`    def encode_json_into(w: JsonWriter, obj: ${m.name}) -> None:`);
            L.push(`        w.begin_object()`);
            for (const f of fields) {
                if (f.optional) {
                    L.push(`        if obj.${f.name} is not None:`);
                    L.push(`            w.write_field("${f.name}")`);
                    for (const line of writeJsonExpr(f.type, `obj.${f.name}`, "            "))
                        L.push(line);
                }
                else {
                    L.push(`        w.write_field("${f.name}")`);
                    for (const line of writeJsonExpr(f.type, `obj.${f.name}`, "        "))
                        L.push(line);
                }
            }
            L.push(`        w.end_object()`);
            // encode_msgpack
            L.push(`    @staticmethod`);
            L.push(`    def encode_msgpack(obj: ${m.name}) -> bytes:`);
            L.push(`        w = MsgPackWriter()`);
            L.push(`        _${m.name}Codec.encode_msgpack_into(w, obj)`);
            L.push(`        return w.to_bytes()`);
            // encode_msgpack_into
            L.push(`    @staticmethod`);
            L.push(`    def encode_msgpack_into(w: MsgPackWriter, obj: ${m.name}) -> None:`);
            if (optional.length === 0) {
                L.push(`        w.begin_object(${fields.length})`);
            }
            else {
                L.push(`        _n = ${required.length}`);
                for (const f of optional) {
                    L.push(`        if obj.${f.name} is not None: _n += 1`);
                }
                L.push(`        w.begin_object(_n)`);
            }
            for (const f of fields) {
                if (f.optional) {
                    L.push(`        if obj.${f.name} is not None:`);
                    L.push(`            w.write_field("${f.name}")`);
                    for (const line of writeMsgPackExpr(f.type, `obj.${f.name}`, "            "))
                        L.push(line);
                }
                else {
                    L.push(`        w.write_field("${f.name}")`);
                    for (const line of writeMsgPackExpr(f.type, `obj.${f.name}`, "        "))
                        L.push(line);
                }
            }
            L.push(`        w.end_object()`);
            // decode
            L.push(`    @staticmethod`);
            L.push(`    def decode(r: SpecReader) -> ${m.name}:`);
            L.push(`        _kw: dict = {}`);
            L.push(`        r.begin_object()`);
            L.push(`        while r.has_next_field():`);
            L.push(`            _k = r.read_field_name()`);
            for (const f of fields) {
                L.push(`            if _k == "${f.name}": _kw["${f.name}"] = ${readExpr(f.type)}; continue`);
            }
            L.push(`            r.skip()`);
            L.push(`        r.end_object()`);
            L.push(`        return ${m.name}(**_kw)`);
            L.push("");
            L.push(`${m.name}Codec = SpecCodec(`);
            L.push(`    encode_json=_${m.name}Codec.encode_json,`);
            L.push(`    encode_msgpack=_${m.name}Codec.encode_msgpack,`);
            L.push(`    decode=_${m.name}Codec.decode,`);
            L.push(`)`);
            L.push("");
        }
        const fileName = `${snake(svc.serviceName)}_types.py`;
        await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
    }
}
