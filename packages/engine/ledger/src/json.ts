export type JsonObject = { readonly [key: string]: Json };

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

function tagOf(value: Json): string {
  return Object.prototype.toString.call(value);
}

export function isJsonString(value: Json): value is string {
  return tagOf(value) === "[object String]";
}

export function isJsonNumber(value: Json): value is number {
  return tagOf(value) === "[object Number]" && Number.isFinite(value);
}

export function isJsonObject(value: Json): value is JsonObject {
  return tagOf(value) === "[object Object]";
}

export function jsonString(value: Json | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isJsonString(value) ? value : undefined;
}

export function jsonNumber(value: Json | undefined): number | undefined {
  if (value === undefined) return undefined;
  return isJsonNumber(value) ? value : undefined;
}

function requireJson(input: Json): Json {
  if (input === null || input === true || input === false) return input;
  if (isJsonString(input) || isJsonNumber(input)) return input;
  if (Array.isArray(input)) return input.map(requireJson);
  if (isJsonObject(input)) {
    const object: { [key: string]: Json } = {};
    for (const key of Object.keys(input)) {
      object[key] = requireJson(input[key]!);
    }
    return object;
  }
  throw new SyntaxError("invalid_json");
}

export function parseJsonText(text: string): Json {
  return requireJson(JSON.parse(text));
}

export function parseJsonTextOrNull(value: string | null): Json | null {
  if (value === null) return null;
  return parseJsonText(value);
}
