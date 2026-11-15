/**
 * Unified server logging. Patches console.{log,info,warn,error,debug} AND the
 * raw process.{stdout,stderr}.write streams so every line — ours, third-party,
 * and Node's own warnings — gets a timestamp + level prefix.
 *
 * Format (prefix appears ONCE per log call; continuation lines are indented):
 *   2026-04-24T11:28:51.494Z ERROR routes/activity.ts:15  Unhandled rejection
 *     DrizzleQueryError: Failed query: SELECT ...
 *         at NodePgPreparedQuery.queryWithCache (.../session.ts:73:11)
 *         at async recentActivity (.../queries/turbines.ts:294:18)
 *
 * Design notes:
 *  - We render the whole entry (prefix + body, continuation lines indented 2 sp)
 *    as one string and write it in a single call. `grep ERROR` still finds the
 *    entry, and copy/paste gives a clean, readable stack trace.
 *  - `callerFrame()` skips any frame inside this file so the prefix points at
 *    the real call site — not logger.ts itself.
 *  - The stream-level patch (process.{stdout,stderr}.write) only prefixes
 *    third-party raw writes. Console-originated writes carry a sentinel so
 *    they pass through unchanged.
 *
 * Errors we can't reach:
 *  - Module-resolution errors (missing exports, bad imports). Node throws those
 *    before any app code runs; nothing in-process can catch them.
 *  - Output from `npm` / the shell itself. Those write before this module loads.
 */

import util from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_COLORS: Record<Level, string> = {
  DEBUG: '\x1b[90m',
  INFO: '\x1b[36m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};

// Severity gate. Default INFO — DEBUG lines from console.debug() are
// silently dropped unless LOG_LEVEL=debug. Use this to gate chatty
// per-request diagnostics that are only useful when investigating an
// actual problem (openai-shim request bodies, runAgent timing lines).
const LEVEL_RANK: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};
const MIN_LEVEL: Level = (() => {
  const raw = (process.env.LOG_LEVEL ?? 'INFO').toUpperCase() as Level;
  return (['DEBUG', 'INFO', 'WARN', 'ERROR'] as Level[]).includes(raw)
    ? raw
    : 'INFO';
})();
function shouldEmit(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Zero-width sentinel that no real log message will contain. If a write to
// stdout/stderr starts with this, it's already-formatted output from our
// console.* patch and should pass through unchanged.
const SELF_TAG = '\x00logger\x00';

// Continuation lines of multi-line bodies (stack frames, JSON dumps) are
// indented by this string instead of getting a fresh prefix. Keeps log
// entries visually grouped and easy to copy.
const CONT_INDENT = '    ';

// Absolute path of this file — used to walk past our own frames when
// locating the caller.
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_BASENAME = path.basename(THIS_FILE);

let installed = false;

export function installLogger(): void {
  if (installed) return;
  installed = true;

  const useColor = process.stdout.isTTY === true;

  const origStdoutWrite = process.stdout.write.bind(process.stdout) as (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => boolean;
  const origStderrWrite = process.stderr.write.bind(process.stderr) as (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => boolean;

  // --- Presentation helpers -------------------------------------------------

  const colorLevel = (level: Level): string =>
    useColor ? `${LEVEL_COLORS[level]}${level.padEnd(5)}${RESET}` : level.padEnd(5);
  const colorTs = (ts: string): string => (useColor ? `${DIM}${ts}${RESET}` : ts);
  const colorCaller = (caller: string): string =>
    useColor ? `${DIM}${caller}${RESET}` : caller;

  /**
   * Best-effort caller location ("server.ts:42") from new Error().stack.
   * Skips any frame whose file matches THIS_FILE so we never land on
   * logger.ts itself, no matter how deep the patch chain goes.
   */
  function callerFrame(): string {
    const stack = new Error().stack;
    if (!stack) return '';
    const lines = stack.split('\n');
    for (const line of lines) {
      const m = line.match(/\(?(?:file:\/\/)?([^\s()]+\.(?:ts|js|mjs|cjs)):(\d+):\d+\)?/);
      if (!m) continue;
      const file = m[1];
      // Skip frames inside the logger itself and node-internal frames.
      if (file.endsWith(THIS_BASENAME)) continue;
      if (file.startsWith('node:')) continue;
      const parts = file.split('/');
      const short = parts.slice(-2).join('/');
      return `${short}:${m[2]}`;
    }
    return '';
  }

  /** Build prefix: "<ts> <LEVEL> <caller>  " — appears once per log entry. */
  function prefix(level: Level, caller: string): string {
    const ts = new Date().toISOString();
    const callerPad = caller ? ` ${caller.padEnd(22)}` : '';
    return `${colorTs(ts)} ${colorLevel(level)}${colorCaller(callerPad)}  `;
  }

  /** util.inspect, but Errors print stack only (avoids duplicated message). */
  function formatArg(a: unknown): string {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
    return util.inspect(a, { colors: useColor, depth: 4, breakLength: 120 });
  }

  /**
   * Render one log call: prefix on the first line, CONT_INDENT on the rest.
   * `args` mirror console.*'s variadic form. Empty trailing lines are dropped
   * so we don't emit a stray prefix-only blank line.
   */
  function render(level: Level, args: unknown[]): string {
    const body = args.map(formatArg).join(' ');
    const lines = body.split('\n');
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const p = prefix(level, callerFrame());
    const out =
      lines.length === 1
        ? p + lines[0]
        : p + lines[0] + '\n' + lines.slice(1).map((l) => CONT_INDENT + l).join('\n');
    return SELF_TAG + out + '\n';
  }

  // --- Patch console.* (common case) ---------------------------------------

  const makeConsoleMethod =
    (level: Level, write: (chunk: string) => void) =>
    (...args: unknown[]) => {
      if (!shouldEmit(level)) return;
      const out = render(level, args);
      // Strip sentinel before the actual write; it's only used downstream
      // by the stream-level patch to recognize our own output.
      write(out.slice(SELF_TAG.length));
    };

  const stdoutSink = (s: string) => origStdoutWrite(s);
  const stderrSink = (s: string) => origStderrWrite(s);

  console.log = makeConsoleMethod('INFO', stdoutSink);
  console.info = makeConsoleMethod('INFO', stdoutSink);
  console.debug = makeConsoleMethod('DEBUG', stdoutSink);
  console.warn = makeConsoleMethod('WARN', stderrSink);
  console.error = makeConsoleMethod('ERROR', stderrSink);

  // --- Patch stream.write (catches raw writers that bypass console) ---------

  const patchWrite = (
    level: Level,
    orig: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean,
  ) => {
    return (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      let s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      // Already-formatted (from our console.*): pass through verbatim.
      if (s.startsWith(SELF_TAG)) {
        return orig(s.slice(SELF_TAG.length), ...rest);
      }
      // Raw third-party write. Buffer into lines, prefix once, indent the rest.
      const endsWithNL = s.endsWith('\n');
      const lines = (endsWithNL ? s.slice(0, -1) : s).split('\n');
      while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const p = prefix(level, callerFrame());
      const out =
        lines.length === 1
          ? p + lines[0]
          : p + lines[0] + '\n' + lines.slice(1).map((l) => CONT_INDENT + l).join('\n');
      return orig(out + (endsWithNL ? '\n' : ''), ...rest);
    };
  };

  process.stdout.write = patchWrite('INFO', origStdoutWrite) as typeof process.stdout.write;
  process.stderr.write = patchWrite('ERROR', origStderrWrite) as typeof process.stderr.write;
}
