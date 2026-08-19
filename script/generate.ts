#!/usr/bin/env bun

import { $ } from "bun"
import { generate } from "../packages/cli/src/cli/cmd/generate"

await $`bun ./packages/engine/sdk/js/script/build.ts`

await Bun.write("packages/engine/sdk/openapi.json", await generate())

await $`./script/format.ts`
