// TOKEN RADAR — "Build the best token launch radar" (make.fun, token-radar-01).
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol by an
// implied token value derived only from the snapshot's own figures, writes the
// ranked board, the dashboard's data, and the judge's dossier.
//
// The value model (radar-2), stated in full in the dashboard's Method section:
//   implied = tvl_usd x sectorMultiple(category)
//             x growthMult(change_7d) x maturityMult(age) x breadthMult(chains)
//   sectorMultiple  a sector's typical fully-diluted-value / TVL band, from the
//                   snapshot's category field alone (0.22 - 0.45, default 0.27)
//   growthMult      1 + clamp(change_7d, -80, +200) / 100 x 0.6   (0.52 - 2.20)
//   maturityMult    0.55 + min(age_days, 1460) / 1460 x 0.45       (0.55 - 1.00)
//   breadthMult     1 + min(chains - 1, 5) x 0.025                (1.00 - 1.125)
// No protocol name is ever special-cased: the same function scores every row.
// Protocols whose token already trades are never ranked; they are listed apart
// in the dashboard's "Already trading" view at their market's own value.
//
// Usage (outside the grader's container):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_VERSION = 'radar-2';
const TEXT_MAX_BYTES = 65_536;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- snapshot

interface Proto {
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

interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist');
  const protocols: Proto[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`protocol ${i} lacks a slug, a name or a TVL`);
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

// ---------------------------------------------------------------- model

/** Days from listed_at to as_of, clamped at zero; null when the date is absent. */
function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * A sector's typical fully-diluted-value / TVL band, keyed only by the snapshot's
 * category field. Fee-bearing, high-growth sectors command more; staking and
 * bridge sectors, whose TVL is mostly pass-through, command less.
 */
function sectorMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('prediction') || c.includes('launchpad') || c.includes('rwa') || c.includes('payment')) return 0.42;
  if (c.includes('dex') || c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('cdp') || c.includes('lend') || c.includes('basis') || c.includes('insurance')) return 0.33;
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking pool') || c.includes('bridge')) return 0.22;
  if (c.includes('yield') || c.includes('farm') || c.includes('risk curator') || c.includes('allocator') || c.includes('leveraged')) return 0.26;
  return 0.28;
}

interface Score {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  sectorMult: number;
  age: number | null;
}

function scoreProto(p: Proto, asOf: string): Score {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(typeof p.change_7d === 'number' ? p.change_7d : 0, -80, 200);
  const growthMult = 1 + (growthPct / 100) * 0.6;
  const ageForModel = age ?? 365;
  const maturityMult = 0.55 + (Math.min(Math.max(ageForModel, 0), 1460) / 1460) * 0.45;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.025;
  const sectorMult = sectorMultiple(p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * sectorMult * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, sectorMult, age };
}

/** A protocol records no token at all. */
function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rankable: pre-token, not an exchange, not a versioned pool of another protocol. */
function isRankable(p: Proto): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- farm plans

function capitalFor(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function mainChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: Proto, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so both sides of the position are active.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position in range.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave the receipt untouched.`;
  }
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} on ${chain} and take one position in an active market.`;
  }
  if (c.includes('risk curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares for the whole season.`;
  }
  if (c.includes('launchpad')) {
    return `Join ${name}'s next launch on ${chain} with $${capital} and hold the allocation through its lock.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('payment') || c.includes('stablecoin') || c.includes('algo-stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it in the wallet.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, matched to the category. */
function weeklyAction(p: Proto): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a supply top-up, a borrow, a repayment or a vote';
  if (c.includes('dex')) return 'a swap, a liquidity top-up or a range adjustment';
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic')) return 'a small trade, a margin top-up or a position close';
  if (c.includes('bridge')) return 'a bridge transfer or a swap on the destination chain';
  if (c.includes('prediction')) return 'a market position or a claim on a resolved market';
  return 'a deposit, a swap, a claim or a vote';
}

/** Six concrete steps, each with a cost and a time, derived from the protocol's own record. */
function farmSteps(p: Proto, age: number | null): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const hold = holdDays(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${coreAction(p, capital, chain)} Cost: $${capital} of capital and about $${gas} of gas on ${chain}. Time: 15 minutes to set up.`,
    `Do one qualifying action each week, such as ${weeklyAction(p)}. Cost: about $2 of gas a week on ${chain}. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open ${p.name}'s own points or rewards page from its official docs and claim only from the link it publishes, never from a link in a chat or an ad. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- board

interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: { sector_multiple: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; breadth_multiplier: number };
  farm_steps: string[];
}

interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  model_version: string;
  model: { formula: string; sector_multiples: Record<string, number>; growth: string; maturity: string; breadth: string };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: Row[];
  live: LiveRow[];
}

function buildBoard(snap: Snap): { board: Row[]; early: number } {
  const index = new Map(snap.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Proto>();
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snap.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProto(p, snap.as_of) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: Row[] = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: s.age,
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    model: {
      sector_multiple: s.sectorMult,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    farm_steps: farmSteps(p, s.age),
  }));
  return { board, early: early.length };
}

function liveRows(snap: Snap): LiveRow[] {
  return snap.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** Why a board is not one the gate will take, or null. */
function boardIssue(board: Row[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares the same implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// ---------------------------------------------------------------- run

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, early } = buildBoard(snap);
const issue = boardIssue(board, snap);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
const live = liveRows(snap);
const radar: RadarData = {
  as_of: snap.as_of,
  source: snap.source,
  floor_usd: snap.floor_usd,
  watchlist: snap.watchlist,
  model_version: MODEL_VERSION,
  model: {
    formula: 'implied = tvl_usd x sectorMultiple(category) x growthMult(change_7d) x maturityMult(age) x breadthMult(chains)',
    sector_multiples: { prediction_launchpad_rwa_payments: 0.42, dex_derivatives_lending_cdp_basis_insurance: 0.33, yield_farm_risk_curators_allocators: 0.26, restaking_liquid_staking_bridge: 0.22, default: 0.28 },
    growth: '1 + clamp(change_7d, -80, +200) / 100 x 0.6',
    maturity: '0.55 + min(age_days, 1460) / 1460 x 0.45 (unknown age: 365 days)',
    breadth: '1 + min(chains - 1, 5) x 0.025',
  },
  watchlist_size: snap.watchlist.length,
  board_size: board.length,
  early_size: early,
  live_size: live.length,
  rows: board,
  live,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${early} early, ${live.length} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
