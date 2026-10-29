#!/usr/bin/env node
// npx post-prod-mcp            add post-prod.io to Claude Code (and Cursor / Codex when they are here)
// npx post-prod-mcp --read-only    the read-only address instead (https://mcp.post-prod.io/mcp/read)
// npx post-prod-mcp zip <folder>   zip a project folder for a version's working files (skips node_modules, .git, .gitignore)
// npx post-prod-mcp attach <folder>   the same, and prints what to tell Claude
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MCP_URL, READ_URL, SERVER_NAME, ZIP_MAX, cursorConfig, codexConfig, claudeArgs, filesToZip, writeZip } from './lib.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const say = (s = '') => process.stdout.write(`${s}\n`);
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', shell: false }).status === 0;
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

function zipCmd(attach) {
  const dir = path.resolve(args[1] || '.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { say(`Not a folder: ${dir}`); process.exit(1); }
  const files = filesToZip(dir);
  if (!files.length) { say('Nothing to zip in that folder.'); process.exit(1); }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > ZIP_MAX * 3) { say(`That folder holds ${mb(total)}: working files go in one zip of up to 500 MB. Zip the files that made this version only.`); process.exit(1); }
  const i = args.indexOf('--out');
  const out = path.resolve(i > 0 && args[i + 1] ? args[i + 1] : path.join(os.tmpdir(), `${path.basename(dir) || 'working-files'}-${Date.now().toString(36)}.zip`));
  let size;
  try { size = writeZip(files, out); }
  catch (e) { say(e.code === 'TOO_BIG' ? `${e.message} Zip the files that made this version only.` : `Could not write the zip: ${e.message}`); process.exit(1); }
  say(`Zipped ${files.length} file${files.length === 1 ? '' : 's'} (${mb(size)}): ${out}`);
  if (attach) say(`\nTell Claude: attach these working files to the version: zip_path "${out}", size_bytes ${size}\n(the post-prod tools attach_working_files, or upload_file's working_files_zip and working_files_size)`);
  say(JSON.stringify({ zip_path: out, size_bytes: size, files: files.length }));
}

function connect() {
  const url = flag('--read-only') ? READ_URL : MCP_URL;
  const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? String(args[i + 1] || '') : ''; })();
  const dry = flag('--dry-run');
  const want = (k) => !only || only === k;
  let done = 0;
  say(`Connecting post-prod.io (${url})\n`);
  // Claude Code
  if (want('claude')) {
    if (has('claude')) {
      const a = claudeArgs(url);
      if (dry) say(`Claude Code: would run claude ${a.join(' ')}`);
      else {
        spawnSync('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { stdio: 'ignore', shell: process.platform === 'win32' }); // added before: replaced
        const r = spawnSync('claude', a, { stdio: 'inherit', shell: process.platform === 'win32' });
        if (r.status === 0) { say('Claude Code: added.'); done++; } else say(`Claude Code: that did not work. Run it yourself: claude ${a.join(' ')}`);
      }
    } else say(`Claude Code: not found. When it is installed: claude ${claudeArgs(url).join(' ')}`);
  }
  // Cursor (also works: it speaks remote MCP with sign-in; tested less than Claude)
  const cursorDir = path.join(os.homedir(), '.cursor');
  if (want('cursor') && fs.existsSync(cursorDir)) {
    const f = path.join(cursorDir, 'mcp.json');
    try {
      const next = cursorConfig(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', url);
      if (dry) say(`Cursor: would write ${f}`); else { fs.writeFileSync(f, next); say(`Cursor: added to ${f}.`); done++; }
    } catch (e) { say(`Cursor: could not update ${f} (${e.message}). Add "${SERVER_NAME}": { "url": "${url}" } under mcpServers yourself.`); }
  }
  // Codex (also works where its remote MCP support is on; tested less than Claude)
  const codexDir = path.join(os.homedir(), '.codex');
  if (want('codex') && (fs.existsSync(codexDir) || has('codex'))) {
    const f = path.join(codexDir, 'config.toml');
    try {
      const next = codexConfig(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', url);
      if (dry) say(`Codex: would write ${f}`); else { fs.mkdirSync(codexDir, { recursive: true }); fs.writeFileSync(f, next); say(`Codex: added to ${f}. If it asks you to sign in, run: codex mcp login ${SERVER_NAME}`); done++; }
    } catch (e) { say(`Codex: could not update ${f} (${e.message}).`); }
  }
  say(done || dry ? '\nThe first time you use a post-prod tool, your browser opens to sign in to post-prod.io and pick a workspace. It needs a workspace on a paid plan.' : '\nNothing was changed.');
}

if (args[0] === 'zip') zipCmd(false);
else if (args[0] === 'attach') zipCmd(true);
else if (flag('--help') || flag('-h')) say('npx post-prod-mcp [--read-only] [--only claude|cursor|codex] [--dry-run]\nnpx post-prod-mcp zip <folder> [--out file.zip]\nnpx post-prod-mcp attach <folder>');
else connect();
