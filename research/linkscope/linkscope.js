(() => {
  "use strict";

  const gate = document.getElementById("access-gate");
  const app = document.getElementById("research-app");
  const form = document.getElementById("unlock-form");
  const phraseInput = document.getElementById("access-phrase");
  const revealButton = document.getElementById("reveal-phrase");
  const status = document.getElementById("gate-status");
  const submitButton = form.querySelector('button[type="submit"]');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let envelopePromise;
  let payload;
  let selectedScenario = "s0";
  let selectedBaseline = "fresh";
  let scenarioButtons = [];
  let baselineButtons = [];

  const safeTags = new Set([
    "a",
    "article",
    "aside",
    "blockquote",
    "button",
    "code",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "i",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ]);

  function make(tag, className, text) {
    if (!safeTags.has(tag)) {
      throw new Error("Unsupported render node");
    }
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }
    return element;
  }

  function isPlainObject(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  function requireString(value, label) {
    if (typeof value !== "string") {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  function requireArray(value, label) {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  function validatePayload(candidate) {
    if (!isPlainObject(candidate)) throw new Error("Invalid payload");
    if (!isPlainObject(candidate.meta)) throw new Error("Invalid metadata");
    requireString(candidate.meta.pageTitle, "page title");
    requireString(candidate.meta.title, "title");
    requireString(candidate.meta.subtitle, "subtitle");
    requireString(candidate.meta.pitch, "pitch");
    requireArray(candidate.nav, "navigation");
    requireArray(candidate.sections, "sections");
    requireArray(candidate.scenarios, "scenarios");
    requireArray(candidate.proofNodes, "proof nodes");
    requireArray(candidate.baselines, "baselines");

    const scenarioIds = new Set();
    for (const scenario of candidate.scenarios) {
      if (!isPlainObject(scenario)) throw new Error("Invalid scenario");
      const id = requireString(scenario.id, "scenario id");
      if (scenarioIds.has(id)) throw new Error("Duplicate scenario");
      scenarioIds.add(id);
      requireString(scenario.implementationCode, "implementation code");
      if (!isPlainObject(scenario.nodeStates)) {
        throw new Error("Invalid node state map");
      }
      if (!isPlainObject(scenario.strategies)) {
        throw new Error("Invalid strategy map");
      }
    }

    return candidate;
  }

  function safeLink(url) {
    const value = requireString(url, "URL");
    if (value.startsWith("/") || value.startsWith("#")) return value;
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol !== "https:") throw new Error("Unsafe URL");
    return parsed.href;
  }

  function link(label, href, className) {
    const anchor = make("a", className, label);
    anchor.href = safeLink(href);
    if (!href.startsWith("/") && !href.startsWith("#")) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Invalid base64 value");
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function loadEnvelope() {
    const response = await fetch("./payload.json", {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Unable to load encrypted draft");
    const candidate = await response.json();
    if (
      !isPlainObject(candidate) ||
      candidate.version !== 1 ||
      !isPlainObject(candidate.kdf) ||
      !isPlainObject(candidate.cipher) ||
      candidate.kdf.name !== "PBKDF2" ||
      candidate.kdf.hash !== "SHA-256" ||
      candidate.kdf.iterations !== 600000 ||
      candidate.cipher.name !== "AES-GCM"
    ) {
      throw new Error("Unsupported encrypted draft");
    }
    return candidate;
  }

  async function decrypt(envelope, password) {
    const normalizedPassword = password.normalize("NFKC");
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(normalizedPassword),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: envelope.kdf.hash,
        salt: decodeBase64(envelope.kdf.salt),
        iterations: envelope.kdf.iterations,
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(envelope.cipher.iv),
        additionalData: decodeBase64(envelope.cipher.additionalData),
        tagLength: 128,
      },
      key,
      decodeBase64(envelope.ciphertext),
    );
    return decoder.decode(plaintext);
  }

  function setBusy(isBusy) {
    submitButton.disabled = isBusy;
    phraseInput.disabled = isBusy;
    revealButton.disabled = isBusy;
    form.setAttribute("aria-busy", String(isBusy));
  }

  function showStatus(message, state = "neutral") {
    status.textContent = message;
    status.dataset.state = state;
  }

  revealButton.addEventListener("click", () => {
    const revealing = phraseInput.type === "password";
    phraseInput.type = revealing ? "text" : "password";
    revealButton.textContent = revealing ? "Hide" : "Show";
    revealButton.setAttribute("aria-pressed", String(revealing));
    revealButton.setAttribute(
      "aria-label",
      revealing ? "Hide access phrase" : "Show access phrase",
    );
    phraseInput.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!window.crypto?.subtle) {
      showStatus(
        "This browser cannot decrypt the draft. Please use a current browser over HTTPS.",
        "error",
      );
      return;
    }

    setBusy(true);
    showStatus("Deriving a local decryption key…");

    try {
      envelopePromise ||= loadEnvelope();
      const envelope = await envelopePromise;
      const plaintext = await decrypt(envelope, phraseInput.value);
      const candidate = validatePayload(JSON.parse(plaintext));
      phraseInput.value = "";
      payload = candidate;
      renderResearch(candidate);
      gate.hidden = true;
      app.hidden = false;
      document.title = candidate.meta.pageTitle;
      window.scrollTo({ top: 0, behavior: "instant" });
      const title = app.querySelector("h1");
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    } catch (error) {
      console.error("Research draft unlock failed", error);
      phraseInput.value = "";
      showStatus(
        "Could not unlock. Check the phrase and try again.",
        "error",
      );
      phraseInput.focus();
      phraseInput.select();
    } finally {
      setBusy(false);
    }
  });

  function renderResearch(data) {
    app.replaceChildren();
    app.className = "research-shell";

    const nav = renderNavigation(data.nav, data.meta.shortTitle);
    const hero = renderHero(data.meta);
    app.append(nav, hero);

    for (const section of data.sections) {
      app.append(renderSection(section));
    }

    app.append(renderFooter(data.meta));
    initializeNavigationObserver();
    updateScenario(data.scenarios[0].id);
  }

  function renderNavigation(items, shortTitle) {
    const nav = make("nav", "research-nav");
    nav.setAttribute("aria-label", "Research draft sections");
    const inner = make("div", "research-nav__inner");
    const brand = link(shortTitle, "#top", "research-brand");
    brand.removeAttribute("target");
    brand.removeAttribute("rel");
    brand.href = "#top";
    brand.prepend(make("span", "research-brand__mark"));

    const links = make("div", "nav-links");
    for (const item of items) {
      const anchor = make("a", "", item.label);
      anchor.href = `#${item.id}`;
      anchor.dataset.sectionLink = item.id;
      links.append(anchor);
    }

    inner.append(brand, links);
    nav.append(inner);
    return nav;
  }

  function renderHero(meta) {
    const hero = make("header", "hero");
    hero.id = "top";
    const inner = make("div", "hero__inner");
    const main = make("div", "hero__main");
    main.append(make("p", "eyebrow", meta.status));
    const heading = make("h1", "", meta.title);
    heading.append(make("span", "", meta.subtitle));
    main.append(heading, make("p", "hero__lede", meta.pitch));

    const actions = make("div", "hero-actions");
    const copyButton = make("button", "action-button", "Copy 45-second pitch");
    copyButton.type = "button";
    copyButton.dataset.action = "copy-pitch";
    copyButton.addEventListener("click", () => copyText(meta.copyPitch));

    const printButton = make(
      "button",
      "action-button action-button--secondary",
      "Print / save PDF",
    );
    printButton.type = "button";
    printButton.addEventListener("click", () => window.print());
    actions.append(copyButton, printButton);
    main.append(actions);

    const aside = make("aside", "hero__aside");
    aside.append(
      make("p", "hero__aside-label", meta.questionLabel),
      make("p", "", meta.question),
    );

    inner.append(main, aside);
    hero.append(inner);
    return hero;
  }

  function renderSection(section) {
    if (!isPlainObject(section)) throw new Error("Invalid section");
    const container = make("section", "content-section");
    container.id = requireString(section.id, "section id");
    const inner = make("div", "content-section__inner");
    inner.append(renderSectionHeading(section));

    for (const block of requireArray(section.blocks, "section blocks")) {
      inner.append(renderBlock(block));
    }

    container.append(inner);
    return container;
  }

  function renderSectionHeading(section) {
    const heading = make("div", "section-heading");
    heading.append(make("div", "section-index", section.index));
    const copy = make("div");
    copy.append(make("h2", "", section.title));
    if (section.lead) copy.append(make("p", "", section.lead));
    heading.append(copy);
    return heading;
  }

  function renderBlock(block) {
    if (!isPlainObject(block)) throw new Error("Invalid content block");
    switch (block.type) {
      case "cards":
        return renderCards(block);
      case "workbench":
        return renderWorkbench(block);
      case "baseline":
        return renderBaseline(block);
      case "callout":
        return renderCallout(block);
      case "theorems":
        return renderTheorems(block);
      case "snapshot":
        return renderSnapshot(block);
      case "priorTable":
        return renderPriorTable(block);
      case "evaluation":
        return renderEvaluation(block);
      case "discussion":
        return renderDiscussion(block);
      case "sources":
        return renderSources(block);
      default:
        throw new Error("Unsupported content block");
    }
  }

  function renderCards(block) {
    const grid = make("div", "problem-grid");
    for (const [index, item] of block.items.entries()) {
      const card = make("article", "problem-card");
      card.append(
        make("span", "card-number", String(index + 1).padStart(2, "0")),
        make("h3", "", item.title),
        make("p", "", item.text),
      );
      grid.append(card);
    }
    return grid;
  }

  function renderWorkbench(block) {
    const wrapper = make("div");
    const definitions = make("div", "definition-strip");
    for (const item of block.definitions) {
      const definition = make("div", "definition-item");
      definition.append(make("code", "", item.symbol), make("span", "", item.text));
      definitions.append(definition);
    }

    const workbench = make("div", "workbench");
    const bar = make("div", "workbench__bar");
    const lights = make("div", "workbench__lights");
    lights.setAttribute("aria-hidden", "true");
    lights.append(make("span"), make("span"), make("span"));
    bar.append(make("span", "", block.title), lights);

    const tabs = make("div", "scenario-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Choose a deployed snapshot");
    scenarioButtons = payload.scenarios.map((scenario) => {
      const button = make("button", "scenario-tab");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.scenario = scenario.id;
      button.append(
        make("strong", "", scenario.label),
        make("span", "", scenario.shortDescription),
      );
      button.addEventListener("click", () => updateScenario(scenario.id));
      tabs.append(button);
      return button;
    });

    const body = make("div", "workbench__body");
    const codeStage = make("div", "code-stage");
    codeStage.append(make("p", "panel-label", block.codeLabel));
    const codeGrid = make("div", "code-grid");
    codeGrid.append(
      renderCodeCard(block.proxyTitle, block.proxyCode, "proxy-code"),
      renderCodeCard("", "", "implementation-code"),
    );
    codeStage.append(codeGrid);

    const propertyStage = make("div", "property-stage");
    propertyStage.append(
      make("p", "panel-label", block.propertyLabel),
      make("div", "property-expression", block.property),
    );
    const result = make("div", "property-result");
    const badge = make("span", "result-badge");
    badge.dataset.role = "result-badge";
    const title = make("h3");
    title.dataset.role = "result-title";
    const explanation = make("p");
    explanation.dataset.role = "result-text";
    const counterexample = make("div", "counterexample");
    counterexample.dataset.role = "counterexample";
    result.append(badge, title, explanation, counterexample);
    propertyStage.append(result);
    body.append(codeStage, propertyStage);

    const proofSection = make("div", "proof-section");
    const proofHeader = make("div", "proof-section__header");
    const proofCopy = make("div");
    proofCopy.append(
      make("p", "panel-label", block.proofLabel),
      make("h3", "", block.proofTitle),
    );
    proofHeader.append(proofCopy, renderLegend(block.legend));
    proofSection.append(proofHeader);

    const flow = make("div", "proof-flow");
    for (const proofNode of payload.proofNodes) {
      const button = make("button", "proof-node");
      button.type = "button";
      button.dataset.node = proofNode.id;
      button.setAttribute("aria-pressed", "false");
      button.append(
        make("span", "proof-node__state"),
        make("strong", "", proofNode.label),
      );
      button.addEventListener("click", () => inspectProofNode(proofNode.id));
      flow.append(button);
    }
    const inspector = make("div", "proof-inspector");
    inspector.dataset.role = "proof-inspector";
    inspector.setAttribute("role", "status");
    proofSection.append(flow, inspector);

    workbench.append(bar, tabs, body, proofSection);
    wrapper.append(definitions, workbench);
    return wrapper;
  }

  function renderCodeCard(title, code, role) {
    const card = make("article", "code-card");
    const heading = make("div", "code-card__title");
    const titleNode = make("span", "", title);
    if (role === "implementation-code") {
      titleNode.dataset.role = "implementation-title";
    }
    heading.append(titleNode, make("span", "", role === "proxy-code" ? "stable" : "dynamic"));
    const pre = make("pre", "", code);
    pre.dataset.role = role;
    card.append(heading, pre);
    return card;
  }

  function renderLegend(items) {
    const legend = make("div", "proof-legend");
    for (const item of items) {
      const entry = make("span");
      entry.append(make("i", `legend-${item.state}`), document.createTextNode(item.label));
      legend.append(entry);
    }
    return legend;
  }

  function renderBaseline(block) {
    const workbench = make("div", "workbench");
    const bar = make("div", "workbench__bar");
    bar.append(make("span", "", block.title), make("span", "", block.note));
    const tabs = make("div", "baseline-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Choose a verification strategy");
    baselineButtons = payload.baselines.map((baseline) => {
      const button = make("button", "baseline-tab");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.baseline = baseline.id;
      button.append(
        make("strong", "", baseline.label),
        make("span", "", baseline.shortDescription),
      );
      button.addEventListener("click", () => updateBaseline(baseline.id));
      tabs.append(button);
      return button;
    });

    const panel = make("div", "baseline-panel");
    const metric = make("div", "baseline-metric");
    const value = make("span", "metric-value");
    value.dataset.role = "baseline-value";
    const metricLabel = make("span", "metric-label");
    metricLabel.dataset.role = "baseline-metric-label";
    metric.append(value, metricLabel);

    const explanation = make("div", "baseline-explanation");
    const badge = make("span", "result-badge");
    badge.dataset.role = "baseline-badge";
    const title = make("h3");
    title.dataset.role = "baseline-title";
    const text = make("p");
    text.dataset.role = "baseline-text";
    explanation.append(badge, title, text);
    panel.append(metric, explanation);
    workbench.append(bar, tabs, panel);

    const wrapper = make("div");
    wrapper.append(workbench, make("p", "baseline-note", block.disclaimer));
    return wrapper;
  }

  function renderCallout(block) {
    const callout = make("div", "callout");
    callout.append(
      make("div", "callout__label", block.label),
      make("blockquote", "", block.text),
    );
    return callout;
  }

  function renderTheorems(block) {
    const grid = make("div", "theorem-grid");
    for (const [index, item] of block.items.entries()) {
      const card = make("article", "theorem-card");
      card.append(
        make("span", "card-number", `T${index + 1}`),
        make("h3", "", item.title),
        make("p", "", item.text),
        make("div", "equation", item.formula),
      );
      grid.append(card);
    }
    return grid;
  }

  function renderSnapshot(block) {
    const layout = make("div", "snapshot-layout");
    layout.append(make("pre", "snapshot-code", block.code));
    const points = make("div", "snapshot-points");
    for (const item of block.points) {
      const point = make("article", "snapshot-point");
      point.append(make("strong", "", item.title), make("p", "", item.text));
      points.append(point);
    }
    layout.append(points);
    return layout;
  }

  function renderPriorTable(block) {
    const wrapper = make("div");
    const tableWrapper = make("div", "prior-table-wrap");
    const table = make("table", "prior-table");
    const head = make("thead");
    const headRow = make("tr");
    for (const heading of block.headings) {
      headRow.append(make("th", "", heading));
    }
    head.append(headRow);

    const body = make("tbody");
    for (const row of block.rows) {
      const tr = make("tr");
      const nameCell = make("td");
      if (row.url) {
        nameCell.append(link(row.name, row.url));
      } else {
        nameCell.textContent = row.name;
      }
      tr.append(
        nameCell,
        make("td", "", row.covers),
        make("td", "", row.gap),
      );
      body.append(tr);
    }

    table.append(head, body);
    tableWrapper.append(table);
    wrapper.append(
      tableWrapper,
      make("div", "novelty-warning", block.warning),
    );
    return wrapper;
  }

  function renderEvaluation(block) {
    const grid = make("div", "evaluation-grid");
    for (const [index, item] of block.items.entries()) {
      const card = make("article", "evaluation-card");
      card.append(
        make("span", "card-number", String(index + 1).padStart(2, "0")),
        make("h3", "", item.title),
        make("p", "", item.text),
      );
      const list = make("ul");
      for (const point of item.points) {
        list.append(make("li", "", point));
      }
      card.append(list);
      grid.append(card);
    }
    return grid;
  }

  function renderDiscussion(block) {
    const box = make("div", "discussion-box");
    box.append(make("h3", "", block.title));
    const list = make("div", "discussion-list");
    for (const question of block.questions) {
      list.append(make("div", "discussion-question", question));
    }
    box.append(list);
    return box;
  }

  function renderSources(block) {
    const list = make("ul", "sources-list");
    for (const source of block.items) {
      const item = make("li");
      item.append(link(source.label, source.url));
      list.append(item);
    }
    return list;
  }

  function renderFooter(meta) {
    const footer = make("footer", "research-footer");
    const inner = make("div", "research-footer__inner");
    const copy = make("div");
    copy.append(
      make("p", "", meta.footerLine1),
      make("p", "", meta.footerLine2),
    );
    inner.append(copy, link(meta.homeLabel, "/", ""));
    footer.append(inner);
    return footer;
  }

  function updateScenario(id) {
    const scenario = payload.scenarios.find((item) => item.id === id);
    if (!scenario) return;
    selectedScenario = id;

    for (const button of scenarioButtons) {
      const active = button.dataset.scenario === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }

    app.querySelector('[data-role="implementation-title"]').textContent =
      scenario.implementationTitle;
    app.querySelector('[data-role="implementation-code"]').textContent =
      scenario.implementationCode;

    const resultBadge = app.querySelector('[data-role="result-badge"]');
    resultBadge.dataset.result = scenario.result;
    resultBadge.textContent = scenario.resultLabel;
    app.querySelector('[data-role="result-title"]').textContent =
      scenario.resultTitle;
    app.querySelector('[data-role="result-text"]').textContent =
      scenario.resultText;

    const counterexample = app.querySelector('[data-role="counterexample"]');
    counterexample.textContent = scenario.counterexample || "";
    counterexample.hidden = !scenario.counterexample;

    for (const proofNode of payload.proofNodes) {
      const element = app.querySelector(`[data-node="${proofNode.id}"]`);
      const nodeState = scenario.nodeStates[proofNode.id];
      if (!["reused", "rechecked", "recomputed", "invalidated"].includes(nodeState)) {
        throw new Error("Invalid proof node state");
      }
      element.dataset.state = nodeState;
      element.querySelector(".proof-node__state").textContent = nodeState;
      element.setAttribute(
        "aria-label",
        `${proofNode.label}: ${nodeState}. Activate for explanation.`,
      );
      element.setAttribute("aria-pressed", "false");
    }

    const firstNode = payload.proofNodes[0];
    inspectProofNode(firstNode.id);
    updateBaseline(selectedBaseline);
  }

  function inspectProofNode(id) {
    const scenario = payload.scenarios.find(
      (item) => item.id === selectedScenario,
    );
    const proofNode = payload.proofNodes.find((item) => item.id === id);
    if (!scenario || !proofNode) return;

    for (const element of app.querySelectorAll(".proof-node")) {
      element.setAttribute("aria-pressed", String(element.dataset.node === id));
    }
    const reason = scenario.nodeReasons[id] || proofNode.description;
    app.querySelector('[data-role="proof-inspector"]').textContent =
      `${proofNode.label}: ${reason}`;
  }

  function updateBaseline(id) {
    const baseline = payload.baselines.find((item) => item.id === id);
    const scenario = payload.scenarios.find(
      (item) => item.id === selectedScenario,
    );
    if (!baseline || !scenario) return;
    selectedBaseline = id;

    for (const button of baselineButtons) {
      const active = button.dataset.baseline === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }

    const strategy = scenario.strategies[id];
    if (!isPlainObject(strategy)) throw new Error("Invalid strategy result");
    app.querySelector('[data-role="baseline-value"]').textContent =
      strategy.nodes;
    app.querySelector('[data-role="baseline-metric-label"]').textContent =
      strategy.metricLabel;

    const badge = app.querySelector('[data-role="baseline-badge"]');
    badge.dataset.result = strategy.result;
    badge.textContent = strategy.resultLabel;
    app.querySelector('[data-role="baseline-title"]').textContent =
      strategy.title;
    app.querySelector('[data-role="baseline-text"]').textContent =
      strategy.text;
  }

  function initializeNavigationObserver() {
    if (!("IntersectionObserver" in window)) return;
    const links = [...app.querySelectorAll("[data-section-link]")];
    const sections = links
      .map((anchor) => app.querySelector(`#${CSS.escape(anchor.dataset.sectionLink)}`))
      .filter(Boolean);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        for (const anchor of links) {
          anchor.setAttribute(
            "aria-current",
            String(anchor.dataset.sectionLink === visible.target.id),
          );
        }
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.25, 0.6] },
    );
    sections.forEach((section) => observer.observe(section));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Pitch copied to clipboard.");
    } catch {
      showToast("Copy was unavailable. Select the pitch text manually.");
    }
  }

  function showToast(message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const toast = make("div", "toast", message);
    toast.setAttribute("role", "status");
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !app.hidden) {
      window.location.reload();
    }
  });

  window.addEventListener("pagehide", () => {
    if (!app.hidden) {
      app.replaceChildren();
      payload = undefined;
    }
  });
})();
