import { createMarket, findRoutes, poolDefinitions, quote, startToken } from "./model.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  map: $("#pool-map"),
  poolCount: $("#pool-count"),
  note: $("#market-note"),
  buy: $("#user-buy"),
  gas: $("#gas-cost"),
  routes: $("#routes"),
  routeCount: $("#path-count"),
  viewAll: $("#all-routes"),
  toSize: $("#to-size"),
  sizeRoute: $("#size-route"),
  amount: $("#trade-amount"),
  slider: $("#size-slider"),
  sliderMax: $("#slider-max"),
  chart: $("#profit-chart"),
  chartFigure: $(".profit-figure"),
  bestKey: $(".optimum-key"),
  noAmount: $("#no-amount"),
  net: $("#net-value"),
  result: $("#amount-result"),
  useBest: $("#best-size"),
  steps: $("#swap-steps"),
  detail: $("#swap-detail"),
  announcement: $("#announcement"),
};
const poolButtons = [...document.querySelectorAll("[data-pool]")];
const enabled = new Set(Object.keys(poolDefinitions));
let userBuy = 20_000;
let gas = 15;
let amount = 5_000;
let market;
let routes;
let selected;
let expanded = false;
let activeSwap = 0;
let trial;
let limit;

const nodes = { USDC: [16, 65], ETH: [84, 65], DAI: [50, 20] };
const controls = { A: [50, 103], B: [50, 45], C: [67, 38], D: [33, 38] };
const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const axis = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const price = (value) => money.format(value);
const quantity = (value, token) => (token === "ETH" ? units.format(value) : price(value));
const signed = (value) => {
  if (Math.abs(value) < 0.005) return "0.00";
  return (value < 0 ? "−" : "+") + price(Math.abs(value));
};
const pathName = (route) => route.legs.map(({ poolId }) => poolId).join(" → ");
const tokenPath = (route) => [startToken, ...route.legs.map(({ to }) => to)].join(" → ");
const profitable = (route) => (route.best?.net ?? 0) >= 0.005;

function curvePoint(from, control, to, t) {
  return from.map((value, i) => (1 - t) ** 2 * value + 2 * (1 - t) * t * control[i] + t ** 2 * to[i]);
}

function canvasSurface(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);
  return { context, width, height };
}

function drawMap() {
  const surface = canvasSurface(ui.map);
  if (!surface) return;
  const { context, width, height } = surface;
  const scale = ([x, y]) => [width * x / 100, height * y / 100];
  const pathLegs = selected?.legs ?? [];
  const activePools = new Set(pathLegs.map(({ poolId }) => poolId));

  function drawEdge(poolId) {
    const [first, last] = poolDefinitions[poolId].tokens;
    const from = scale(nodes[first]);
    const to = scale(nodes[last]);
    const control = scale(controls[poolId]);
    const leg = pathLegs.find((leg) => leg.poolId === poolId);
    context.beginPath();
    context.moveTo(...from);
    context.quadraticCurveTo(...control, ...to);
    context.setLineDash(enabled.has(poolId) ? [] : [4, 6]);
    context.strokeStyle = leg ? "#ffc078" : enabled.has(poolId) ? "#63637a" : "#3c3d4b";
    context.lineWidth = leg ? 2.5 : 1.4;
    context.shadowBlur = leg ? 12 : 0;
    context.shadowColor = "#ffb3688c";
    context.stroke();
    context.shadowBlur = 0;
    context.setLineDash([]);

    if (leg) {
      const forward = leg.from === first;
      const t = forward ? 0.73 : 0.27;
      const tip = curvePoint(from, control, to, t);
      const tail = curvePoint(from, control, to, t + (forward ? -0.02 : 0.02));
      const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
      context.beginPath();
      context.moveTo(...tip);
      for (const offset of [-0.56, 0.56]) {
        context.lineTo(tip[0] - 11 * Math.cos(angle + offset), tip[1] - 11 * Math.sin(angle + offset));
      }
      context.closePath();
      context.fillStyle = "#ffc078";
      context.fill();
    }
  }

  for (const id of Object.keys(poolDefinitions)) {
    if (!activePools.has(id)) drawEdge(id);
  }
  for (const id of activePools) drawEdge(id);
}

function initMap() {
  for (const button of poolButtons) {
    const id = button.dataset.pool;
    const [from, to] = poolDefinitions[id].tokens;
    const [x, y] = curvePoint(nodes[from], controls[id], nodes[to], 0.5);
    button.style.left = x + "%";
    button.style.top = y + "%";
    button.addEventListener("click", () => {
      if (enabled.has(id)) enabled.delete(id);
      else enabled.add(id);
      refreshMarket();
    });
  }
}

function updateMap() {
  ui.poolCount.textContent = `${enabled.size} of 4 pools enabled`;
  for (const button of poolButtons) {
    const id = button.dataset.pool;
    const position = selected?.legs.findIndex((leg) => leg.poolId === id) ?? -1;
    button.setAttribute("aria-pressed", String(enabled.has(id)));
    button.classList.toggle("on-route", position >= 0);
    button.innerHTML = position >= 0 ? `<span>${position + 1}</span> Pool ${id}` : `Pool ${id}`;
    const [currency, token] = market.pools[id].tokens;
    const balances = market.pools[id].reserves;
    button.setAttribute("aria-label", `Pool ${id}, ${token} and ${currency}`);
    button.title = `${price(balances[currency] / balances[token])} ${currency} per ${token}`;
  }
  drawMap();
}

function markSelectedRoute() {
  for (const button of ui.routes.querySelectorAll("[data-route]")) {
    button.setAttribute("aria-pressed", String(button.dataset.route === selected?.id));
  }
}

function renderRoutes() {
  const wins = routes.filter(profitable);
  const extra = routes.length - wins.length;
  const shown = expanded || !wins.length
    ? routes
    : routes.filter((route) => profitable(route) || route.id === selected?.id);
  ui.routeCount.textContent = `${routes.length} ${routes.length === 1 ? "loop" : "loops"} · ${wins.length} profitable`;
  ui.viewAll.hidden = extra === 0 || wins.length === 0;
  ui.viewAll.setAttribute("aria-expanded", String(expanded));
  ui.viewAll.textContent = expanded ? "Hide other loops" : `Show ${extra} other ${extra === 1 ? "loop" : "loops"}`;
  ui.toSize.hidden = !routes.length;

  ui.routes.innerHTML = shown.map((route) => `
    <button type="button" class="route-option" data-route="${route.id}">
      <span class="route-main">
        <strong>${tokenPath(route)}</strong>
        <small>Pools ${pathName(route)} · ${route.legs.length} swaps</small>
      </span>
      <span class="route-profit">
        ${profitable(route) ? `<strong class="positive">${signed(route.best.net)}</strong><small>USDC</small>` : '<small>No net profit</small>'}
      </span>
    </button>`).join("");
  if (!shown.length) {
    ui.routes.innerHTML = '<p class="empty-copy">Enable connected pools to form a loop that starts and ends in USDC.</p>';
  }
  markSelectedRoute();
}

function refreshMarket() {
  market = createMarket(userBuy);
  routes = findRoutes(market.pools, enabled, gas);
  selected = routes.find((route) => route.id === selected?.id) ?? routes[0];
  activeSwap = Math.min(activeSwap, (selected?.legs.length ?? 1) - 1);
  if (!market.userSwap && activeSwap === -1) activeSwap = 0;
  const { reserves } = market.pools.A;
  ui.note.textContent = market.userSwap
    ? `The earlier buy raised Pool A from 2,000 to ${price(reserves.USDC / reserves.ETH)} USDC per ETH.`
    : "Pool A and Pool B both start at 2,000 USDC per ETH. The market has no price gap.";
  renderRoutes();
  updateMap();
  renderSteps();
  refreshAmount();
}

function drawProfit() {
  if (!selected) return;
  const surface = canvasSurface(ui.chart);
  if (!surface) return;
  const { context, width, height } = surface;
  const samples = Array.from({ length: 81 }, (_, i) => {
    const input = limit * i / 80;
    return { input, net: quote(market.pools, selected.legs, input, gas).net };
  });
  const best = selected.best;
  const values = samples.map(({ net }) => net);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values, best?.net ?? 0);
  const padding = Math.max((high - low) * 0.055, 3);
  const left = width < 350 ? 43 : 52;
  const right = width - 27;
  const top = 13;
  const bottom = height - 29;
  const x = (value) => left + value / limit * (right - left);
  const y = (value) => top + (high + padding - value) / (high - low + 2 * padding) * (bottom - top);

  const annotation = best
    ? `Best amount ${price(best.input)} USDC, giving ${signed(best.net)} USDC net.`
    : "Every size on this path loses money.";
  ui.chart.setAttribute("aria-label", `Net profit on pools ${pathName(selected)}. Your amount ${price(amount)} USDC gives ${signed(trial.net)} USDC net. ${annotation}`);
  context.font = "11px SFMono-Regular, Consolas, monospace";
  context.textBaseline = "middle";

  function gridLine(from, to, color) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(...from);
    context.lineTo(...to);
    context.stroke();
  }

  context.textAlign = "right";
  context.fillStyle = "#a9aebf";
  const increment = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(increment));
  const tick = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= increment) * magnitude;
  for (let index = Math.ceil((low - padding * 0.85) / tick); index <= Math.floor((high + padding * 0.85) / tick); index++) {
    const mark = index * tick;
    gridLine([left, y(mark)], [right, y(mark)], mark === 0 ? "#696979" : "#32343f");
    context.fillText(axis.format(mark), left - 7, y(mark));
  }

  context.textAlign = "center";
  for (let i = 0; i <= 4; i++) {
    const input = limit * i / 4;
    gridLine([x(input), top], [x(input), bottom], "#2c2e3a");
    context.fillText(axis.format(input), x(input), bottom + 14);
  }

  const zeroStop = (y(0) - top) / (bottom - top);
  const shade = context.createLinearGradient(0, top, 0, bottom);
  shade.addColorStop(0, "#80dfb450");
  shade.addColorStop(zeroStop, "#c3a8bb13");
  shade.addColorStop(1, "#ff9b9f22");
  context.beginPath();
  context.moveTo(x(0), y(0));
  for (const sample of samples) context.lineTo(x(sample.input), y(sample.net));
  context.lineTo(x(limit), y(0));
  context.closePath();
  context.fillStyle = shade;
  context.fill();

  context.beginPath();
  context.moveTo(x(0), y(samples[0].net));
  for (const sample of samples) context.lineTo(x(sample.input), y(sample.net));
  const tone = context.createLinearGradient(0, top, 0, bottom);
  tone.addColorStop(0, "#80dfb4");
  tone.addColorStop(zeroStop, "#80dfb4");
  tone.addColorStop(zeroStop, "#ff9b9f");
  tone.addColorStop(1, "#ff9b9f");
  context.strokeStyle = tone;
  context.lineWidth = 2.4;
  context.stroke();

  function point(input, net, color, radius, filled) {
    context.beginPath();
    context.arc(x(input), y(net), radius, 0, Math.PI * 2);
    context.fillStyle = filled ? color : "#171921";
    context.strokeStyle = color;
    context.lineWidth = 1.6;
    context.fill();
    context.stroke();
  }

  if (best) point(best.input, best.net, "#b4afff", 5, false);
  context.setLineDash([4, 4]);
  gridLine([x(amount), top], [x(amount), bottom], "#ffc07892");
  context.setLineDash([]);
  point(amount, trial.net, "#ffc078", 4, true);
}

function renderResult() {
  ui.net.textContent = trial
    ? signed(trial.net)
    : "—";
  ui.net.classList.toggle("positive", (trial?.net ?? 0) >= 0.005);
  ui.net.classList.toggle("negative", (trial?.net ?? 0) <= -0.005);
  ui.useBest.disabled = !selected?.best || selected.best.input < Number(ui.amount.min);
  if (!trial) {
    ui.result.innerHTML = "<p class=\"result-copy\">Connect pools and pick a route to calculate a quote.</p>";
    return;
  }

  const best = selected.best;
  const memo = best?.net >= 0.005
    ? `This route peaks at ${price(best.input)} USDC in (${signed(best.net)} net).`
    : "This path has no profitable amount at the current prices and network fee.";
  ui.result.innerHTML = `
    <dl class="ledger">
      <div><dt>Starting USDC</dt><dd>${price(trial.input)}</dd></div>
      <div><dt>USDC returned</dt><dd>${price(trial.output)}</dd></div>
      <div><dt>Network fee</dt><dd>${price(trial.gas)}</dd></div>
    </dl>
    <p class="result-copy">${memo}</p>`;
}

function renderSteps() {
  const earlier = market.userSwap
    ? '<button type="button" class="swap-step" data-swap="-1"><span>Earlier</span><strong>User buy in Pool A</strong></button>'
    : "";
  const legs = selected?.legs.map(({ poolId, from, to }, index) => `
    <button type="button" class="swap-step" data-swap="${index}">
      <span>Swap ${index + 1} · Pool ${poolId}</span><strong>${from} → ${to}</strong>
    </button>`).join("") ?? "";
  ui.steps.innerHTML = earlier + legs;
  ui.steps.hidden = !earlier && !legs;
}

function renderSwap() {
  for (const button of ui.steps.querySelectorAll("[data-swap]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.swap) === activeSwap));
  }
  const swap = activeSwap === -1 ? market.userSwap : trial?.swaps[activeSwap];
  if (!swap) {
    ui.detail.innerHTML = '<p class="empty-copy">Choose a route to see its swaps.</p>';
    return;
  }
  const { poolId, from, to, input, output, before, after } = swap;
  const [currency, token] = market.pools[poolId].tokens;
  const reserves = [from, to].map((asset) => {
    const scale = Math.max(before[asset], after[asset]) * 1.05;
    const oldWidth = 100 * before[asset] / scale;
    const newWidth = 100 * after[asset] / scale;
    return `
      <div class="reserve">
        <div><span>${asset} reserve</span><strong>${quantity(before[asset], asset)} → ${quantity(after[asset], asset)}</strong></div>
        <div class="reserve-track" aria-hidden="true">
          <i class="reserve-before" style="width:${oldWidth}%"></i>
          <i class="reserve-after" style="--before:${oldWidth}%; width:${newWidth}%"></i>
          <i class="reserve-mark" style="left:${oldWidth}%"></i>
        </div>
      </div>`;
  }).join("");
  ui.detail.innerHTML = `
    <div class="swap-detail-grid">
      <div class="trade-flow">
        <div><span>Into pool</span><strong>${quantity(input, from)} ${from}</strong></div>
        <span aria-hidden="true">→</span>
        <div><span>Out of pool</span><strong>${quantity(output, to)} ${to}</strong></div>
      </div>
      <div class="reserves">${reserves}</div>
    </div>
    <p class="pool-price">Pool ${poolId} spot price <strong>${price(before[currency] / before[token])} → ${price(after[currency] / after[token])} ${currency} per ${token}</strong></p>`;
}

function refreshAmount() {
  limit = Math.ceil(Math.max(25_000, (selected?.best?.input ?? 0) * 2.5, amount) / 5_000) * 5_000;
  trial = selected ? quote(market.pools, selected.legs, amount, gas) : null;
  ui.slider.max = limit;
  ui.slider.value = amount;
  ui.slider.style.setProperty("--filled", `${100 * amount / limit}%`);
  ui.sliderMax.textContent = units.format(limit) + " USDC";
  ui.sizeRoute.textContent = selected ? "Pools " + pathName(selected) : "";
  ui.bestKey.hidden = !selected?.best;
  ui.amount.disabled = !selected;
  ui.slider.disabled = !selected;
  ui.chartFigure.hidden = !selected;
  ui.noAmount.hidden = Boolean(selected);
  drawProfit();
  renderResult();
  renderSwap();
}

function readNumber(input, current, update) {
  function read(commit) {
    const typed = input.valueAsNumber;
    if (!Number.isFinite(typed)) {
      if (commit) input.value = current();
      return;
    }
    const value = Math.min(Number(input.max), Math.max(Number(input.min), typed));
    if (commit) input.value = value;
    if (value !== current()) update(value);
  }
  input.addEventListener("input", () => read(false));
  input.addEventListener("change", () => read(true));
}

readNumber(ui.buy, () => userBuy, (value) => {
  userBuy = value;
  refreshMarket();
});
readNumber(ui.gas, () => gas, (value) => {
  gas = value;
  refreshMarket();
});
readNumber(ui.amount, () => amount, (value) => {
  amount = value;
  if (activeSwap === -1) activeSwap = 0;
  refreshAmount();
});

function setAmount(value) {
  amount = value;
  ui.amount.value = value;
  if (activeSwap === -1) activeSwap = 0;
  refreshAmount();
}

ui.slider.addEventListener("input", () => setAmount(ui.slider.valueAsNumber));
ui.useBest.addEventListener("click", () => {
  setAmount(Math.round(selected.best.input * 100) / 100);
  ui.announcement.textContent = `Best amount ${price(amount)} USDC. Net profit ${signed(trial.net)} USDC.`;
});
ui.viewAll.addEventListener("click", () => {
  expanded = !expanded;
  renderRoutes();
});
ui.routes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route]");
  if (!button) return;
  selected = routes.find((route) => route.id === button.dataset.route);
  activeSwap = 0;
  markSelectedRoute();
  updateMap();
  renderSteps();
  refreshAmount();
  ui.announcement.textContent = `Selected ${tokenPath(selected)} via pools ${pathName(selected)}.`;
});
ui.steps.addEventListener("click", (event) => {
  const button = event.target.closest("[data-swap]");
  if (!button) return;
  activeSwap = Number(button.dataset.swap);
  renderSwap();
});

initMap();
refreshMarket();
const resize = new ResizeObserver(() => {
  drawMap();
  drawProfit();
});
resize.observe(ui.map);
resize.observe(ui.chart);
