// Farm plans for the token radar: every board row carries a plan a reader can follow.
//
// A plan is six steps, each one an action with what it costs and how long it takes. Everything in a
// plan is derived from the protocol's own snapshot record — its category, its chains, its TVL and its
// age — never from a hand-kept list of names. Gas figures are rough, and every one of them says so.
//
// The plan's shape:
//   1. a fresh wallet, funded with gas on the protocol's first chain
//   2. the category's main action, sized to a capital tier from the protocol's TVL
//   3. a second qualifying action, on a second chain when the protocol runs on one
//   4. a weekly cadence, so the activity spans more than one snapshot
//   5. the hold period, from the protocol's age
//   6. claim safety and the farm log
//
// Step text stays inside the gate's 20..600 characters: planSteps clamps every step, and the board
// check in lib/model.ts refuses a board with a step outside it.

/** The fields of a protocol record a farm plan reads. */
export interface FarmProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  listed_at: string | null;
}

/** Rough cost of one ordinary transaction on a chain, in US dollars. Approximate on purpose. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4,
  Bitcoin: 2,
  Tron: 1,
  Arbitrum: 0.3,
  Avalanche: 0.3,
  Optimism: 0.25,
  Binance: 0.2,
  Base: 0.15,
  Linea: 0.1,
  'Hyperliquid L1': 0.1,
  Polygon: 0.05,
  Solana: 0.05,
  Monad: 0.05,
  Sei: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  Sonic: 0.05,
  Unichain: 0.05,
  'World Chain': 0.05,
  Abstract: 0.05,
  Plasma: 0.1,
  Berachain: 0.1,
  Scroll: 0.1,
  'zkSync Era': 0.15,
  Starknet: 0.2,
  Mantle: 0.1,
  Blast: 0.1,
  Mode: 0.1,
  Fantom: 0.1,
  Cronos: 0.1,
  Gnosis: 0.05,
  Celo: 0.05,
  Moonbeam: 0.1,
  Kava: 0.1,
  TON: 0.1,
  'Robinhood Chain': 0.1,
  Cosmos: 0.1,
  Osmosis: 0.1,
  Cardano: 0.2,
  HyperEVM: 0.1,
};

/** The gas figure for a chain, as a sentence fragment that says it is approximate. */
function gasText(chain: string): string {
  const g = GAS_USD[chain] ?? 0.5;
  return g >= 1 ? `about $${Math.round(g)} of gas` : `about $${g.toFixed(2)} of gas`;
}

/** The gas figure as a number, for weekly totals. */
function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

/** A deterministic pick from a list, so two protocols with the same shape read differently. */
function pick<T>(items: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return items[h % items.length]!;
}

/** The capital tier for one farm position, from the protocol's own TVL. */
export function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 500;
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  return 75;
}

/** The hold period in days, from the protocol's age: younger protocols get a longer window. */
export function holdDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 90;
  if (ageDays < 365) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function mainAction(p: FarmProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaking') || c.includes('staking pool')) {
    return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the wallet.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow a small amount against it and repay half, so the position shows both sides.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and route one swap through the pool the same day.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside the destination app instead of bridging straight back.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position, then close it after a day.`;
  }
  if (c.includes('prediction')) {
    return `Fund the wallet with $${capital} and take one small position in an active market on ${n}, holding it to resolution.`;
  }
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${n} vault on ${chain} and leave the vault shares untouched for the full hold period.`;
  }
  if (c.includes('basis trading')) {
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet for the full window.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${capital} of ${n}'s tokenised real-world asset on ${chain} and hold it; keep the purchase receipt in the farm log.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Deposit $${capital} of stablecoins into ${n}'s highest-TVL vault on ${chain} and let the yield compound in the position.`;
  }
  if (c.includes('leveraged farm') || c.includes('farm')) {
    return `Open a $${capital} leveraged farming position on ${n} on ${chain} at the lowest leverage the app offers, and set a stop point before you confirm.`;
  }
  if (c.includes('stablecoin') || c.includes('algo-stables')) {
    return `Mint $${capital} of ${n}'s stable asset on ${chain} against over-collateralised backing and hold the minted balance.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${n} on ${chain} for a protocol you already use, and keep the policy active for the hold period.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${n}'s index token on ${chain} and hold it; the index itself is the position.`;
  }
  if (c.includes('liquidity manager')) {
    return `Deposit $${capital} into a ${n} managed range on ${chain} and leave rebalancing to the manager for the full window.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} of the launchpad's required asset on ${n} on ${chain} and join one sale allocation while the stake is live.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Route $${capital} of everyday spending through ${n} on ${chain} across the month, keeping each payment in the farming wallet.`;
  }
  if (c.includes('privacy') || c.includes('synthetic')) {
    return `Deposit $${capital} through ${n}'s private pool on ${chain} and withdraw it to the same wallet after the hold period.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} to ${n}'s chain, stake or delegate a share of it, and run one transaction a week from the farming wallet.`;
  }
  if (c.includes('token locker') || c.includes('governance') || c.includes('locker')) {
    return `Lock $${capital} of tokens through ${n} on ${chain} for the shortest lock it offers and vote once while the lock is live.`;
  }
  if (c.includes('otc') || c.includes('nft') || c.includes('ai') || c.includes('decentralized')) {
    return `Use $${capital} through ${n}'s main product on ${chain} — one real trade or listing — and keep the receipt in the farming wallet.`;
  }
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open for the full hold period.`;
}

/** The second qualifying action: a second chain when there is one, else a complementary move. */
function secondAction(p: FarmProtocol, capital: number, chain: string): string {
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  if (second !== null) {
    return `Repeat the position on ${second} with $${Math.round(capital / 2)} so the wallet is active on two of the protocol's chains, not one.`;
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount against the supply, swap it, and repay it within the week so the wallet shows borrow activity too.`;
  if (c.includes('dex')) return `Swap a small amount through a second pool on ${chain} so the wallet's volume is not all in one pair.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back the other way a week later, keeping both directions on the same wallet.`;
  return `Do one more qualifying action in the same app — a deposit, a swap, a vote or a claim — from the same wallet within the first week.`;
}

/** Clamp one step to the gate's 20..600 characters, cutting at a word boundary where possible. */
function clampStep(text: string): string {
  const t = text.trim();
  if (t.length <= 600) return t.length >= 20 ? t : `${t} Keep the position open and check the protocol's own page before changing it.`;
  const cut = t.slice(0, 590);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 400 ? at : 590).trimEnd()}...`;
}

/**
 * A protocol's six-step farm plan. `ageDays` is the protocol's age in days from its listed date, or
 * null when the snapshot records none.
 */
export function planSteps(p: FarmProtocol, ageDays: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(ageDays);
  const weeklyGas = Math.max(0.05, gasUsd(chain) * 2);
  const weeklyGasText = weeklyGas >= 1 ? `about $${Math.round(weeklyGas)}` : `about $${weeklyGas.toFixed(2)}`;
  const walletStep = pick(
    [
      `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper and keep it offline, then fund it with gas on ${chain}.`,
      `Use a wallet you keep only for farming, back up its seed phrase offline, and load it with gas money on ${chain} before the first transaction.`,
    ],
    p.slug,
  );
  const cadenceStep = pick(
    [
      `Do one qualifying action every week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots.`,
      `Return once a week and do one real action in the app, so the wallet's history shows steady use rather than a single day.`,
    ],
    `${p.slug}:cadence`,
  );
  const holdStep = pick(
    [
      `Hold the position for at least ${hold} days, through more than one snapshot, before you unwind any of it.`,
      `Leave the position untouched for at least ${hold} days; withdrawing early is the usual way a farm ends up counting for nothing.`,
    ],
    `${p.slug}:hold`,
  );
  const claimStep = pick(
    [
      `Claim only from the link the protocol itself publishes, never from a reply or a direct message, and record the wallet, the dates and every transaction in a farm log.`,
      `When a claim opens, use only the protocol's own page, check the contract address twice, and write the wallet, the dates and every transaction into a farm log.`,
    ],
    `${p.slug}:claim`,
  );
  return [
    clampStep(`${walletStep} Cost: ${gasText(chain)} for the first transactions. Time: 10 minutes.`),
    clampStep(`${mainAction(p, capital, chain)} Cost: $${capital} of capital plus ${gasText(chain)}. Time: 20 minutes to set up.`),
    clampStep(`${secondAction(p, capital, chain)} Cost: ${gasText(chain)} and the second position's capital. Time: 15 minutes.`),
    clampStep(`${cadenceStep} Cost: ${weeklyGasText} of gas a week. Time: 10 minutes a week.`),
    clampStep(`${holdStep} Cost: the $${capital} stays in the position. Time: ${hold} days.`),
    clampStep(`${claimStep} Cost: nothing to check, and never pay anyone to claim. Time: 10 minutes.`),
  ];
}
