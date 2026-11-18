export const startToken = "USDC";
export const swapFee = 0.003;
const feeMultiplier = 1 - swapFee;

export const poolDefinitions = {
  A: { tokens: ["USDC", "ETH"], reserves: { USDC: 200_000, ETH: 100 } },
  B: { tokens: ["USDC", "ETH"], reserves: { USDC: 250_000, ETH: 125 } },
  C: { tokens: ["DAI", "ETH"], reserves: { DAI: 200_000, ETH: 100 } },
  D: { tokens: ["USDC", "DAI"], reserves: { USDC: 400_000, DAI: 400_000 } },
};

function swap(pool, { poolId, from, to }, input) {
  const { reserves: before } = pool;
  const effective = input * feeMultiplier;
  const output = before[to] * effective / (before[from] + effective);
  const after = { ...before, [from]: before[from] + input, [to]: before[to] - output };
  return { poolId, from, to, input, output, before, after };
}

export function createMarket(userBuy) {
  if (userBuy === 0) return { pools: poolDefinitions, userSwap: null };
  const userSwap = swap(poolDefinitions.A, { poolId: "A", from: "USDC", to: "ETH" }, userBuy);
  const pools = { ...poolDefinitions, A: { ...poolDefinitions.A, reserves: userSwap.after } };
  return { pools, userSwap };
}

export function quote(pools, legs, input, gas) {
  // Every leg uses a distinct pool. Its reserves come from the snapshot at search time.
  let output = input;
  const swaps = legs.map((leg) => {
    const trade = swap(pools[leg.poolId], leg, output);
    output = trade.output;
    return trade;
  });
  return { swaps, input, output, gas, net: output - input - gas };
}

function bestSize(pools, legs) {
  // Each swap is output = gain * input / (1 + curvature * input).
  // Composing distinct-pool swaps preserves that form.
  let gain = 1;
  let curvature = 0;
  for (const { poolId, from, to } of legs) {
    const { reserves } = pools[poolId];
    const stepCurvature = feeMultiplier / reserves[from];
    curvature += stepCurvature * gain;
    gain *= stepCurvature * reserves[to];
  }

  // The best continuous input is where an extra unit in returns exactly one unit out.
  return gain > 1 ? (Math.sqrt(gain) - 1) / curvature : 0;
}

export function findRoutes(pools, enabled, gas) {
  const routes = [];

  function follow(token, visited, legs) {
    if (legs.length === 3) return;

    for (const poolId of enabled) {
      const { tokens } = pools[poolId];
      if (!tokens.includes(token) || legs.some((leg) => leg.poolId === poolId)) continue;
      const to = tokens.find((other) => other !== token);
      const next = [...legs, { poolId, from: token, to }];
      if (to === startToken) {
        const amount = bestSize(pools, next);
        const best = amount > 0 ? quote(pools, next, amount, gas) : null;
        routes.push({ id: next.map((leg) => leg.poolId).join(""), legs: next, best });
      } else if (!visited.includes(to)) {
        follow(to, [...visited, to], next);
      }
    }
  }

  follow(startToken, [startToken], []);
  return routes.sort((left, right) => (right.best?.net ?? -gas) - (left.best?.net ?? -gas));
}
