# post-prod-mcp

One command that connects post-prod.io to the coding assistants on your computer, plus a helper that zips a project
folder as a version's working files.

```
npx post-prod-mcp
```

What it does:

- **Claude Code** (tested): runs `claude mcp add --transport http --scope user post-prod https://mcp.post-prod.io/mcp`.
- **Cursor** (also works; tested less): adds `"post-prod": { "url": "https://mcp.post-prod.io/mcp" }` under `mcpServers` in `~/.cursor/mcp.json`, if `~/.cursor` exists.
- **Codex** (also works where its remote MCP support is on; tested less): adds `[mcp_servers.post-prod]` with the `url` to `~/.codex/config.toml`. If Codex asks you to sign in, run `codex mcp login post-prod`.

The first time a post-prod tool is used, the browser opens to sign in to post-prod.io and pick a workspace (a paid
workspace's owner or admin approves it).

Options: `--read-only` (connects `https://mcp.post-prod.io/mcp/read`: only the tools that read), `--only claude|cursor|codex`,
`--dry-run` (says what it would do).

## Working files

```
npx post-prod-mcp zip ./my-project        # prints the zip's path and size
npx post-prod-mcp attach ./my-project     # the same, plus what to tell Claude
```

Leaves out `node_modules`, `.git`, symlinks and what `.gitignore` files list. One zip of up to 500 MB; it counts against
the workspace's storage. Claude then sends it with `attach_working_files` (or `upload_file`'s `working_files_zip`).

## Publishing (Seth)

Nothing here is published. To publish:

1. `cd integrations/npx-connect`
2. Check the name is free: `npm view post-prod-mcp` (a 404 means it is free). If not, change `name` (and the commands in
   this README and on post-prod.io/mcp).
3. `npm login` (the post-prod npm account), then `npm publish --access public`.
4. Try it: `npx post-prod-mcp --dry-run`.

Later versions: bump `version` in package.json, then `npm publish`.

Tests live in the backend repo: `test/npx-connect.test.js` (node --test).
