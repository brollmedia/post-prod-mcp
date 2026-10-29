// post-prod-mcp: the pieces, kept free of side effects so they can be tested (bin.js does the I/O).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const MCP_URL = 'https://mcp.post-prod.io/mcp';
export const READ_URL = 'https://mcp.post-prod.io/mcp/read';
export const SERVER_NAME = 'post-prod';
export const ZIP_MAX = 500 * 1024 * 1024;
export const ALWAYS_SKIP = ['node_modules', '.git', '.DS_Store', 'Thumbs.db'];

// ── Cursor: ~/.cursor/mcp.json, { mcpServers: { name: { url } } } ──
export function cursorConfig(existing, url = MCP_URL) {
  let j = {};
  if (existing && existing.trim()) { j = JSON.parse(existing); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('~/.cursor/mcp.json is not a JSON object'); }
  j.mcpServers = { ...(j.mcpServers || {}), [SERVER_NAME]: { url } };
  return `${JSON.stringify(j, null, 2)}\n`;
}

// ── Codex: ~/.codex/config.toml, a [mcp_servers.post-prod] table with url (streamable HTTP) ──
export function codexConfig(existing, url = MCP_URL) {
  const text = String(existing || '');
  const block = `[mcp_servers.${SERVER_NAME}]\nurl = "${url}"\n`;
  const re = new RegExp(`\\[mcp_servers\\.${SERVER_NAME.replace('-', '\\-')}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`, 'm');
  if (re.test(text)) return text.replace(re, block);
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
}

// ── Claude Code: claude mcp add --transport http --scope user post-prod <url> ──
export const claudeArgs = (url = MCP_URL) => ['mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER_NAME, url];

// ── .gitignore, the common parts: comments, blank lines, !negation, leading / (anchored), trailing / (folders), * ? ** ──
export function gitignoreRules(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l && !l.startsWith('#')).map((l) => {
    let neg = false; if (l.startsWith('!')) { neg = true; l = l.slice(1); }
    let dir = false; if (l.endsWith('/')) { dir = true; l = l.slice(0, -1); }
    const anchored = l.startsWith('/') || l.includes('/'); l = l.replace(/^\//, '');
    const src = l.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*');
    const re = new RegExp(anchored ? `^${src}(/.*)?$` : `(^|/)${src}(/.*)?$`);
    return { re, neg, dir };
  });
}
/** Whether a path (relative to the folder the rules came from, forward slashes) is left out. isDir: it is a folder. */
export function ignored(rel, isDir, rules) {
  let out = false;
  for (const r of rules) {
    const sub = !r.base ? rel : rel.startsWith(`${r.base}/`) ? rel.slice(r.base.length + 1) : null;
    if (sub == null || (r.dir && !isDir)) continue;
    if (r.re.test(sub)) out = !r.neg;
  }
  return out;
}

/** Every file to zip under root: [{ rel, abs, size }], skipping node_modules, .git and what .gitignore files list. */
export function filesToZip(root) {
  const out = [];
  const walk = (dir, rules) => {
    const gi = path.join(dir, '.gitignore');
    const relDir = path.relative(root, dir).split(path.sep).join('/');
    const here = fs.existsSync(gi) ? gitignoreRules(fs.readFileSync(gi, 'utf8')).map((r) => ({ ...r, base: relDir })) : [];
    const all = [...rules, ...here];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ALWAYS_SKIP.includes(ent.name) || ent.isSymbolicLink()) continue;
      const abs = path.join(dir, ent.name), rel = path.relative(root, abs).split(path.sep).join('/');
      if (ignored(rel, ent.isDirectory(), all)) continue;
      if (ent.isDirectory()) walk(abs, all);
      else if (ent.isFile()) out.push({ rel, abs, size: fs.statSync(abs).size });
    }
  };
  walk(root, []);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ── a small zip writer (deflate, under 4 GB: the cap is 500 MB) ──
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Write files ([{ rel, abs }]) to zipPath. Returns its size in bytes. Throws TOO_BIG past max. */
export function writeZip(files, zipPath, { max = ZIP_MAX } = {}) {
  const fd = fs.openSync(zipPath, 'w');
  let off = 0; const cen = [];
  const put = (b) => { fs.writeSync(fd, b); off += b.length; if (off > max) { fs.closeSync(fd); fs.rmSync(zipPath, { force: true }); throw Object.assign(new Error(`The zip would be over ${Math.round(max / 1048576)} MB.`), { code: 'TOO_BIG' }); } };
  try {
    for (const f of files) {
      const data = fs.readFileSync(f.abs), crc = crc32(data);
      const packed = zlib.deflateRawSync(data, { level: 6 });
      const method = packed.length < data.length ? 8 : 0, body = method ? packed : data;
      const name = Buffer.from(f.rel, 'utf8');
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(method, 8);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
      const at = off; put(h); put(name); put(body);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(at, 42);
      cen.push(Buffer.concat([c, name]));
    }
    const start = off; for (const c of cen) put(c);
    const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cen.length, 8); e.writeUInt16LE(cen.length, 10); e.writeUInt32LE(off - start, 12); e.writeUInt32LE(start, 16);
    put(e);
  } finally { try { fs.closeSync(fd); } catch { /* closed on TOO_BIG */ } }
  return fs.statSync(zipPath).size;
}
