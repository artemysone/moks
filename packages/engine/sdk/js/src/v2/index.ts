export * from "./client.js"
export * from "./server.js"

import { createMoksClient } from "./client.js"
import { createMoksServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createMoks(options?: ServerOptions) {
  const server = await createMoksServer({
    ...options,
  })

  const client = createMoksClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
