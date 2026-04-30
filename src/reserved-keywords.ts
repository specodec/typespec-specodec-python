export const RESERVED_KEYWORDS = {
  python: new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await",
    "break", "class", "continue", "def", "del", "elif", "else", "except",
    "finally", "for", "from", "global", "if", "import", "in", "is",
    "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
    "while", "with", "yield",
  ]),
  
  dart: new Set([
    "abstract", "as", "assert", "async", "await", "break", "case", "catch",
    "class", "const", "continue", "covariant", "default", "deferred", "do",
    "dynamic", "else", "enum", "export", "extends", "extension", "external",
    "factory", "false", "final", "finally", "for", "Function", "get", "hide",
    "if", "implements", "import", "in", "interface", "is", "late", "library",
    "mixin", "new", "null", "on", "operator", "part", "required", "rethrow",
    "return", "set", "show", "static", "super", "switch", "sync", "this",
    "throw", "true", "try", "typedef", "var", "void", "while", "with", "yield",
  ]),
  
  kotlin: new Set([
    "abstract", "actual", "annotation", "as", "as?", "break", "by", "catch",
    "class", "companion", "const", "constructor", "continue", "crossinline",
    "data", "delegate", "do", "dynamic", "else", "enum", "expect", "external",
    "field", "file", "final", "finally", "for", "fun", "get", "if", "import",
    "in", "infix", "init", "inline", "inner", "interface", "internal", "is",
    "it", "lateinit", "lazy", "noinline", "object", "open", "operator", "out",
    "override", "package", "param", "private", "property", "protected", "public",
    "receiver", "reified", "return", "sealed", "set", "setparam", "suspend",
    "tailrec", "this", "throw", "try", "typealias", "typeof", "val", "var",
    "vararg", "when", "where", "while",
  ]),
  
  rust: new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn",
    "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in",
    "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while",
    // Reserved for future use
    "abstract", "become", "box", "do", "final", "macro", "override", "priv",
    "typeof", "unsized", "virtual", "yield",
  ]),
  
  go: new Set([
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
    "map", "package", "range", "return", "select", "struct", "switch", "type",
    "var",
    // Built-in functions/types
    "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
    "int", "int8", "int16", "int32", "int64", "rune", "string", "uint",
    "uint8", "uint16", "uint32", "uint64", "uintptr",
    "true", "false", "nil", "iota",
    "append", "cap", "close", "complex", "copy", "delete", "imag", "len",
    "make", "new", "panic", "print", "println", "real", "recover",
  ]),
  
  swift: new Set([
    "associatedtype", "as", "break", "case", "catch", "class", "continue",
    "convenience", "default", "defer", "deinit", "didSet", "do", "dynamic",
    "else", "enum", "extension", "fallthrough", "false", "fileprivate", "final",
    "for", "func", "get", "guard", "if", "import", "in", "infix", "init",
    "inout", "internal", "is", "lazy", "left", "let", "mutating", "nil",
    "none", "nonmutating", "open", "operator", "optional", "override", "postfix",
    "precedence", "prefix", "private", "protocol", "public", "repeat", "required",
    "rethrows", "return", "right", "self", "Self", "set", "some", "static",
    "struct", "subscript", "super", "switch", "throw", "throws", "true", "try",
    "typealias", "unowned", "var", "weak", "where", "while", "willSet",
  ]),
  
  typescript: new Set([
    "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "enum", "export", "extends", "false",
    "finally", "for", "function", "if", "import", "in", "instanceof", "new",
    "null", "return", "super", "switch", "this", "throw", "true", "try",
    "typeof", "var", "void", "while", "with",
    // TypeScript/JavaScript reserved
    "as", "async", "await", "constructor", "declare", "from", "get", "infer",
    "is", "keyof", "let", "module", "namespace", "never", "of", "package",
    "private", "protected", "public", "readonly", "require", "set", "static",
    "symbol", "type", "unique", "unknown", "yield",
  ]),
};

export type LangName = keyof typeof RESERVED_KEYWORDS;

export function checkReservedKeyword(
  name: string,
  langs: LangName[]
): { isReserved: boolean; reservedIn: LangName[] } {
  const reservedIn: LangName[] = [];
  for (const lang of langs) {
    if (RESERVED_KEYWORDS[lang]?.has(name)) {
      reservedIn.push(lang);
    }
  }
  return { isReserved: reservedIn.length > 0, reservedIn };
}

export function formatReservedWarning(
  fieldName: string,
  modelName: string,
  reservedIn: LangName[]
): string {
  const langNames = reservedIn.map(l => {
    const names: Record<LangName, string> = {
      python: "Python",
      dart: "Dart",
      kotlin: "Kotlin",
      rust: "Rust",
      go: "Go",
      swift: "Swift",
      typescript: "TypeScript",
    };
    return names[l];
  });
  
  return `"${fieldName}" in model "${modelName}" is a reserved keyword in ${langNames.join(", ")}, and is unrecommended for single source of specodec identifier names. Add --ignore-reserved-keywords to continue.`;
}