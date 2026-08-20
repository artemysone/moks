# Schema Package Guide

`@moks/schema` owns browser-safe wire and storage contracts shared by protocol, server, core, and generated SDKs. Keep runtime behavior, service layers, side effects, and host-local implementation details in the domain package that owns them.

## Package Boundary

- Preserve the dependency direction: `@moks/schema <- @moks/protocol <- @moks/server`.
- Schema values should be serializable contract definitions, not service implementations or runtime registries.
- A domain may keep a minimal public wire contract here when SDK generation needs it, but do not move the broader runtime model into Schema just because an event is public. `plugin.added` is the current example: Schema may own the minimum browser-safe event payload, while plugin runtime behavior stays outside Schema.
- The root barrel exports canonical current domain contracts. Specialized event modules, manifests, infrastructure modules, and V1 contracts use direct entrypoints instead of becoming first-class root exports.

## Current versus leftover names

OpenCode started a Session rewrite and labeled it V2. That is not a moks product version. Current contracts are unversioned. The shipped TUI still uses the CLI loop and its `V1` contracts.

- Current contracts are unversioned: use names like `Session`, `Permission`, `Question`, and identifiers like `Permission.Request`.
- CLI-loop contracts still in use are explicitly `V1`: use names like `SessionV1`, `PermissionV1`, and identifiers like `PermissionV1.Request`.
- Do not keep `V2` as the name for current contracts. Remove `V2` from current namespaces, brands, and identifiers as you touch them.
- Keep `V1` entrypoints only while the CLI loop needs them. Do not add new `V2` names.
- `@moks/protocol` and `@moks/sdk-next` are current `/api/...` surfaces. The product prompt path is still `/session`, not `/api/session`.

## Events

- Classify event definitions by protocol role before adding them to a public manifest: `current`, `shared transitional`, or `V1-only`.
- Being emitted by V1 is not enough to include an event in Protocol or SDK Next.
- Keep clearly V1-only events, such as `message.updated` and `message.part.*`, out of the current Protocol/SDK Next event surface unless a current-client requirement is documented.
- Keep compatibility events available only to the existing App/TUI/CLI compatibility surface while they are still needed.
- Preserve a single canonical event definition. Do not duplicate definitions for generation convenience.

## Module Shape

- Use one canonical exported value for each contract. Avoid bridge aliases such as `PluginID`, `PluginEvent`, `PtyInfo`, `PtyEvent`, and `SessionTodoInfo`.
- Prefer importing the schema module namespace and reading canonical members, for example `Plugin.ID` or `SessionTodo.Info`.
- Core may compose Schema contracts with runtime behavior into a deliberate domain facade, but the facade must re-export the exact canonical Schema value. Do not create a second schema identity.
- Use flat top-level exports plus the package's existing namespace projection pattern, for example `export * as SessionMessage from "./session-message"`.
- Keep standalone ID modules only when they prevent real cycles or heavy dependency edges. Inline one-off IDs into their owning contract module when no cycle exists.

## Naming

- Exported schema values and namespace objects use `PascalCase`.
- Schema-building functions and combinators use `camelCase`.
- The package's static-method combinator is `statics(...)`.
- Keep descriptive schema value names such as `PositiveInt`, `NonNegativeInt`, `AbsolutePath`, `RelativePath`, and `DateTimeUtcFromMillis`.

## Optional Fields And Defaults

- Use the package `optional(...)` helper for optional object properties, including nested structs and event payloads, so encoded objects omit `undefined` keys.
- Use raw `Schema.optional(...)` only when preserving `undefined` as an explicitly encoded property is intentional and documented.
- External convenience defaults are normally decode-only with `Schema.withDecodingDefault(...)`.
- Add constructor defaults only when the domain value itself requires construction-time normalization.

## Public Types

- Public `Schema.Struct` records use same-name interfaces:

  ```ts
  export interface Info extends Schema.Schema.Type<typeof Info> {}
  export const Info = Schema.Struct({ ... })
  ```

- Use type aliases for unions, scalars, arrays, branded scalar types, and event payload helper types.
- Closed documented string sets use `Schema.Literals(...)`. If arbitrary strings are valid, document the field as arbitrary rather than listing a closed set.

## Mutability

- Public Schema contracts are readonly by default.
- Do not use `Schema.mutable(...)` in public contracts for runtime convenience.
- Runtime code that needs mutation should opt in at the boundary with `Types.DeepMutable`, a purpose-built draft type, or another explicit mutable API.

## Unknown Values

- Current public contracts avoid `Schema.Any`.
- Use `Schema.Json` for values that must be JSON-serializable.
- Use `Schema.Unknown` for genuinely opaque values that require consumer-side narrowing.
- Keep `Schema.Any` only at an explicitly unsafe compatibility boundary with a documented reason.

## IDs And Identifiers

- Current ID constructors expose `create()`.
- Directional constructors such as `ascending()` or `descending()` remain only where ordering semantics are part of the public contract or compatibility requires the old method.
- New generated ID schemas must validate exactly the prefix they emit, including the underscore.
- Do not tighten legacy loose ID validators without an explicit compatibility and migration decision; existing callers and tests may rely on accepted non-canonical IDs.
- Reusable exported public schemas get stable, domain-qualified identifiers such as `Model.Ref` or `Agent.Color`.
- Public schema identifiers and brands must be unique and stable. Private one-use nested schemas may remain anonymous.

## Tests For Contract Changes

- Add focused tests when changing contract behavior or generated surface.
- Cover optional properties omitting `undefined`, no accidental current-contract `Schema.Any`, stable and unique public identifiers, exact facade/schema identity, and current Protocol manifests excluding V1-only events.
