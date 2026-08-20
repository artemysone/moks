This is a plugin to simulate a remote environment locally. Add this to the **monorepo** coding-agent config (`.opencode/`), not product `moks.json`:

```json
  "plugin": ["../packages/cli/src/control-plane/dev/debug-workspace-plugin.ts"]
```

In a separate terminal, run a second moks server. This acts like a remote server and the local instance proxies requests to it:

```
./packages/cli/script/run-workspace-server
```

With the plugin installed, you can run moks and create a `debug` workspace type. This creates a "remote" workspace that talks to the second workspace server started above.

How this works:

- The workspace server needs the workspace id and port. It waits for this information to be written to a file and starts the server when the data is written.
- The debug plugin writes this information in the `create` call. Creating a `debug` workspace always kicks off a new external server.
- The server script watches for file changes, so whenever you create a new `debug` workspace it restarts with the new information. Only one working `debug` workspace exists at a time; previous debug workspaces will fail to connect.
