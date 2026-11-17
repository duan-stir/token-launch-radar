// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol the snapshot's record says is pre-token and rankable: every slug on
// the watchlist (the floor, never a ceiling) plus every other pre-token protocol below the floor that
// passes the watchlist's own exclusion rule. A wrapped, staked or bridged product of a protocol whose
// token already trades is not a launch waiting to happen — WBTC is Bitcoin on another chain, not a
// protocol still waiting on a token of its own — so the board leaves those out, exactly as the
// watchlist's rule does: the bridged and staked categories, names carrying a whole word wrapped,
// staked or staking, names beginning with an exchange's name, and version-marked names. Protocols
// whose token already trades are kept apart in the live view, at the market's own values, never mixed
// into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The multiple is not a house guess: it is
// the median market-cap-to-TVL ratio of the snapshot's live-token protocols in the same category,
// learned from the snapshot at run time:
//
//   multiple     = median(mcap_usd / tvl_usd) over live-token comparables in the category,
//                  when the category holds at least MIN_COMPS of them; else the median over every
//                  live-token comparable. Clamped to [MULTIPLE_FLOOR, MULTIPLE_CAP] so one outlier
//                  comparable cannot set the multiple.
//   growthMult   = 1 + clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100 x GROWTH_WEIGHT
//   maturityMult = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x MATURITY_RANGE
//                  (age unknown: the median age of the snapshot's dated protocols)
//   implied      = max(1, round(tvl_usd x multiple x growthMult x maturityMult))
//
// No protocol name is ever special-cased: the same functions score every row, and the dashboard states
// the formula, the constants and the comparables behind every row's multiple.

import { planSteps } from './farm.ts';

/** One protocol entry of the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tuning: the constants the dashboard states and the sandbox may change. */
export interface ModelTuning {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
}

export const TUNING: ModelTuning = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  min_comps: 3,
};

/** The model's version label, carried by the board and the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 50;

/** The gate's cap on one implied value, in dollars. */
const IMPLIED_CAP = 100_000_000_000_000;

/** One row of board.json: the ranked board's row, with its model breakdown and farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, with the ratio the model learns from. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_ratio: number;
}

/** Everything the dashboard renders: the board, the live set, the multiples and the tuning. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  tuning: ModelTuning;
  unknown_age_days: number;
  global_multiple: number;
  global_comps: number;
  multiples: Record<string, { multiple: number; comps: number }>;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers; null when the list is empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol's record shows no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist's rule leaves out: bridged, staked and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking, in any case, is another protocol's product. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** A name beginning with an exchange's name is the exchange's product, not a protocol of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and none of the watchlist rule's
 * exclusions — not a bridged or staked product, not an exchange, not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The comparables the multiples are learned from: live-token protocols with a market cap and TVL. */
interface Comparable {
  category: string | null;
  ratio: number;
}

function comparables(snapshot: Snapshot): Comparable[] {
  const out: Comparable[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      out.push({ category: p.category, ratio: p.mcap_usd / p.tvl_usd });
    }
  }
  return out;
}

/** What the model learned from the snapshot: the multiples, and the fallback age. */
export interface ModelContext {
  byCategory: Map<string, { multiple: number; comps: number }>;
  globalMultiple: number;
  globalComps: number;
  unknownAgeDays: number;
}

/** Learn the multiples from the snapshot's own live-token protocols. */
export function learnContext(snapshot: Snapshot, tuning: ModelTuning = TUNING): ModelContext {
  const comps = comparables(snapshot);
  const global = median(comps.map((c) => c.ratio)) ?? 0.25;
  const globalMultiple = Math.min(tuning.multiple_cap, Math.max(tuning.multiple_floor, global));
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  const ratiosByCategory = new Map<string, number[]>();
  for (const c of comps) {
    if (c.category === null) continue;
    const list = ratiosByCategory.get(c.category) ?? [];
    list.push(c.ratio);
    ratiosByCategory.set(c.category, list);
  }
  for (const [category, ratios] of [...ratiosByCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length < tuning.min_comps) continue;
    const med = median(ratios) ?? global;
    byCategory.set(category, {
      multiple: Math.min(tuning.multiple_cap, Math.max(tuning.multiple_floor, med)),
      comps: ratios.length,
    });
  }
  const knownAges = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const unknownAgeDays = Math.round(median(knownAges) ?? 365);
  return { byCategory, globalMultiple, globalComps: comps.length, unknownAgeDays };
}

/** The multiple one protocol gets: its category's, or the global one when its category has too few comps. */
export function multipleFor(p: SnapshotProtocol, ctx: ModelContext): { multiple: number; source: 'category' | 'global'; comps: number } {
  if (p.category !== null) {
    const entry = ctx.byCategory.get(p.category);
    if (entry !== undefined) return { multiple: entry.multiple, source: 'category', comps: entry.comps };
  }
  return { multiple: ctx.globalMultiple, source: 'global', comps: ctx.globalComps };
}

/** The three multipliers and the implied value one protocol gets. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  ctx: ModelContext,
  tuning: ModelTuning = TUNING,
): { implied: number; multiple: number; source: 'category' | 'global'; comps: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, source, comps } = multipleFor(p, ctx);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageForModel = age ?? ctx.unknownAgeDays;
  const maturityMult = tuning.maturity_floor + (Math.min(Math.max(ageForModel, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, source, comps, growthPct, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, tuning: ModelTuning = TUNING): BoardRow[] {
  const ctx = learnContext(snapshot, tuning);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, first.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, whatever its size.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, ctx, tuning) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        multiple: round4(s.multiple),
        multiple_source: s.source,
        comps: s.comps,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: planSteps(p, s.age),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      mcap_tvl_ratio: round4((p.mcap_usd as number) / p.tvl_usd),
    }));
}

/** Everything the dashboard renders, from the snapshot. The rows it ships are the board's own rows. */
export function buildRadar(snapshot: Snapshot, tuning: ModelTuning = TUNING): { board: BoardRow[]; radar: RadarData } {
  const ctx = learnContext(snapshot, tuning);
  const board = buildBoard(snapshot, tuning);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const multiples: Record<string, { multiple: number; comps: number }> = {};
  for (const [category, entry] of ctx.byCategory) multiples[category] = { multiple: round4(entry.multiple), comps: entry.comps };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    tuning,
    unknown_age_days: ctx.unknownAgeDays,
    global_multiple: round4(ctx.globalMultiple),
    global_comps: ctx.globalComps,
    multiples,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0 || typeof p.name !== 'string' || p.name.length === 0 || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Why a board is not one the gate will take, or null: row count, coverage, ranks, order, one shared
 * implied value, farm steps, and every row's fields.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `${r.slug} is not a valid slug`;
    if (r.name.length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
    }
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** The dashboard's dataset as one script: the page reads window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
