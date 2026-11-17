// Token Launch Radar: build the ranked board and the dashboard from the sealed snapshot.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program reads the snapshot (the sealed /input/snapshot.json, or --input <file|dir>), scores
// every rankable pre-token protocol with the model in lib/model.ts, and writes to the output directory
// (the sealed /output, --output, or $MAKEFUN_OUTPUT_DIR):
//
//   board.json     the ranked board: rank, implied value, model breakdown, farm plan
//   data.js        the same board, as window.RADAR, for the dashboard to render
//   dashboard/     the static page, copied from this repository
//   screenshots/   the three screenshots, copied from this repository
//   dossier.json   the judge's dossier, written last with the vendored make.fun library
//
// The run is deterministic: the same snapshot in, the same bytes out. No clock, no randomness, no
// network, and every ordering has an explicit tie-break. The board is self-checked before anything is
// written, and the program exits non-zero rather than hand in a board the gate would refuse.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the scorer states them: the dossier text cap shapes the bytes. */
const TEXT_MAX_BYTES = 65_536;
const BOARD_MAX_BYTES = 8 * 1024 * 1024;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524_288;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4 * 1024 * 1024;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** `--name <value>` or `--name=<value>` out of the arguments, or the fallback. */
function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy a directory's regular files into `to`, in name order, skipping dot-names. Returns the names. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!PLAIN_NAME.test(name)) fail(`${from}/${name}: a file name is letters, digits and . _ -, 1 to 128 characters`);
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

function main(): void {
  const inputArg = option('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
  const out = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

  const boardBytes = Buffer.from(`${JSON.stringify({ rows: board })}\n`, 'utf8');
  if (boardBytes.length > BOARD_MAX_BYTES) fail(`board.json is ${boardBytes.length} bytes, over the ${BOARD_MAX_BYTES} cap`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), boardBytes);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  const pageFiles = copyDirectory(join(REPO, 'dashboard'), join(out, 'dashboard'));
  if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
  if (!pageFiles.some((n) => n.endsWith('.css')) || !pageFiles.some((n) => n.endsWith('.js'))) {
    fail('dashboard/ needs at least one .css and one .js file');
  }
  const shots = copyDirectory(join(REPO, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
  if (shots.length > SCREENSHOT_MAX) fail(`screenshots/ holds ${shots.length} images, over the ${SCREENSHOT_MAX} cap`);
  for (const name of shots) {
    const size = statSync(join(out, 'screenshots', name)).size;
    if (size > SCREENSHOT_MAX_BYTES) fail(`screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_MAX_BYTES} cap`);
  }

  // The dossier is written last: the scorer rebuilds it from this output directory and compares bytes.
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} below the floor), ${radar.live_size} live-token protocols set aside\n` +
      `token radar: wrote ${join(out, 'board.json')} (${boardBytes.length} bytes), ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${pageFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images), ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
  );
}

main();
