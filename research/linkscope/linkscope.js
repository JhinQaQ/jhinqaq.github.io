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
  const fixedAdditionalData = encoder.encode("linkscope-research-draft-v1");

  const allowedTags = new Set([
    "a",
    "aside",
    "button",
    "code",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "header",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "ul",
  ]);
  const methodIds = ["fresh", "stale", "syntax", "linkscope"];
  const snapshotIds = ["s0", "s1", "s2"];
  const notebookCellIds = [
    "define",
    "compare",
    "dependencies",
    "concerns",
    "discover",
    "formal",
  ];
  const dependencyNodeIds = [
    "proxy",
    "link",
    "code",
    "dispatch",
    "slice",
    "summary",
    "vc",
    "outcome",
  ];
  const nodeStateIds = [
    "checked",
    "reused",
    "invalidated",
    "refuted",
    "unjustified",
  ];
  const nodeStates = new Set(nodeStateIds);

  let envelopePromise;
  let payload;
  let selectedSnapshot = "s2";
  let selectedMethod = "linkscope";
  let selectedNode = "slice";
  let selectedConcern = "does_it_solve";
  let selectedConcernStep = "";
  let selectedPrior = 0;
  let discoveryCount = 0;
  let refs = {};

  function make(tag, className, text) {
    if (!allowedTags.has(tag)) throw new Error("Unsupported render node");
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }
    return element;
  }

  function isObject(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  function requireObject(value, label) {
    if (!isObject(value)) throw new Error(`Invalid ${label}`);
    return value;
  }

  function requireArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
    return value;
  }

  function requireString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  function requireInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  function requireExactKeys(value, expected, label) {
    const object = requireObject(value, label);
    const actual = Object.keys(object);
    if (
      actual.length !== expected.length ||
      expected.some((key) => !Object.hasOwn(object, key))
    ) {
      throw new Error(`Invalid ${label} keys`);
    }
    return object;
  }

  function requireAllowedKeys(value, allowed, label) {
    const object = requireObject(value, label);
    if (Object.keys(object).some((key) => !allowed.includes(key))) {
      throw new Error(`Invalid ${label} keys`);
    }
    return object;
  }

  function requireExactIds(items, expected, label) {
    const actual = items.map((item) =>
      requireString(requireObject(item, label).id, `${label} id`),
    );
    if (
      actual.length !== expected.length ||
      expected.some((id, index) => actual[index] !== id) ||
      new Set(actual).size !== actual.length
    ) {
      throw new Error(`Invalid ${label} identifiers`);
    }
  }

  function validatePayload(candidate) {
    requireObject(candidate, "payload");
    if (candidate.schemaVersion !== 2) throw new Error("Unsupported payload");

    const meta = requireObject(candidate.meta, "metadata");
    [
      "pageTitle",
      "pathLabel",
      "title",
      "subtitle",
      "status",
      "oneSentenceClaim",
      "footer",
      "homeLabel",
    ].forEach((field) => requireString(meta[field], `metadata ${field}`));

    const notebook = requireObject(candidate.notebook, "notebook");
    ["kernelLabel", "instructions"].forEach((field) =>
      requireString(notebook[field], `notebook ${field}`),
    );
    const cells = requireArray(notebook.cells, "notebook cells");
    requireExactIds(cells, notebookCellIds, "notebook cells");
    for (const cellValue of cells) {
      const cell = requireObject(cellValue, "notebook cell");
      ["prompt", "title", "purpose"].forEach((field) =>
        requireString(cell[field], `notebook cell ${field}`),
      );
    }

    const problemFirst = requireObject(
      candidate.problemFirst,
      "problem-first section",
    );
    [
      "eyebrow",
      "title",
      "lead",
      "code",
      "baseline",
      "failure",
      "solution",
      "solved",
      "open",
      "failureButton",
      "solutionButton",
    ].forEach((field) =>
      requireString(problemFirst[field], `problem-first ${field}`),
    );

    const model = requireObject(candidate.model, "model");
    const symbols = requireArray(model.symbols, "model symbols");
    if (symbols.length < 4) throw new Error("Missing model symbols");
    for (const symbolValue of symbols) {
      const symbol = requireObject(symbolValue, "model symbol");
      ["symbol", "meaning"].forEach((field) =>
        requireString(symbol[field], `model symbol ${field}`),
      );
    }
    requireString(requireObject(model.proxy, "proxy").code, "proxy code");
    const coreDistinction = requireObject(
      model.coreDistinction,
      "core distinction",
    );
    ["traditional", "unsafeShortcut", "linkscope"].forEach((field) =>
      requireString(coreDistinction[field], `core distinction ${field}`),
    );
    const executionFrame = requireObject(
      model.executionFrame,
      "execution frame",
    );
    ["formula", "whyNotConcatenation", "proofTransport"].forEach((field) =>
      requireString(executionFrame[field], `execution frame ${field}`),
    );
    requireString(requireObject(model.query, "query").code, "query code");

    const nodes = requireArray(candidate.dependencyNodes, "dependency nodes");
    requireExactIds(nodes, dependencyNodeIds, "dependency nodes");
    const nodeIds = new Set();
    for (const nodeValue of nodes) {
      const node = requireObject(nodeValue, "dependency node");
      const id = requireString(node.id, "dependency node id");
      if (nodeIds.has(id)) throw new Error("Duplicate dependency node");
      nodeIds.add(id);
      ["shortLabel", "label", "key", "description", "hardQuestion"].forEach(
        (field) => requireString(node[field], `dependency node ${field}`),
      );
      requireArray(node.dependsOn, "node dependencies").forEach((dependency) =>
        requireString(dependency, "node dependency"),
      );
    }
    for (const nodeValue of nodes) {
      const node = requireObject(nodeValue, "dependency node");
      const dependencies = requireArray(
        node.dependsOn,
        "node dependencies",
      );
      if (
        new Set(dependencies).size !== dependencies.length ||
        dependencies.some(
          (dependency) => dependency === node.id || !nodeIds.has(dependency),
        )
      ) {
        throw new Error(`Invalid dependencies for ${node.id}`);
      }
    }
    const visitState = new Map();
    function visitNode(nodeId) {
      const state = visitState.get(nodeId);
      if (state === "visiting") throw new Error("Dependency graph contains a cycle");
      if (state === "visited") return;
      visitState.set(nodeId, "visiting");
      const node = nodes.find((item) => item.id === nodeId);
      node.dependsOn.forEach(visitNode);
      visitState.set(nodeId, "visited");
    }
    dependencyNodeIds.forEach(visitNode);

    const legend = requireArray(candidate.nodeStatusLegend, "node status legend");
    requireExactIds(legend, nodeStateIds, "node status legend");
    for (const itemValue of legend) {
      const item = requireObject(itemValue, "node status legend item");
      ["label", "meaning"].forEach((field) =>
        requireString(item[field], `node status legend ${field}`),
      );
    }

    const methods = requireArray(candidate.methods, "methods");
    requireExactIds(methods, methodIds, "methods");
    for (const methodValue of methods) {
      const method = requireObject(methodValue, "method");
      ["label", "tabLabel", "call", "short", "soundness", "keyRule"].forEach(
        (field) => requireString(method[field], `method ${field}`),
      );
    }

    const snapshots = requireArray(candidate.snapshots, "snapshots");
    requireExactIds(snapshots, snapshotIds, "snapshots");
    for (const snapshotValue of snapshots) {
      const snapshot = requireObject(snapshotValue, "snapshot");
      [
        "tabLabel",
        "title",
        "selectedImplementation",
        "linkFact",
        "codeTitle",
        "code",
        "diffTitle",
        "diff",
        "relevantChange",
      ].forEach((field) => requireString(snapshot[field], `snapshot ${field}`));
      const reference = requireObject(
        snapshot.referenceOutcome,
        "reference outcome",
      );
      ["verdict", "label", "reason"].forEach((field) =>
        requireString(reference[field], `reference outcome ${field}`),
      );
      const results = requireExactKeys(
        snapshot.methodResults,
        methodIds,
        "method results",
      );
      for (const methodId of methodIds) {
        const result = requireObject(results[methodId], "method result");
        [
          "returned",
          "reference",
          "correctness",
          "tone",
          "badge",
          "headline",
          "explanation",
        ].forEach((field) =>
          requireString(result[field], `method result ${field}`),
        );
        const work = requireObject(result.work, "work accounting");
        const checked = requireInteger(
          work.checkedOrRebuilt,
          "checked work",
        );
        const reused = requireInteger(work.reused, "reused work");
        const unjustified = requireInteger(
          work.unjustifiedReuse,
          "unjustified work",
        );
        if (
          checked + reused + unjustified !==
          dependencyNodeIds.length
        ) {
          throw new Error("Work accounting must total all dependency nodes");
        }
        const states = requireExactKeys(
          result.nodeStates,
          dependencyNodeIds,
          "node states",
        );
        for (const nodeId of nodeIds) {
          if (!nodeStates.has(states[nodeId])) {
            throw new Error("Invalid dependency node state");
          }
        }
        const stateCounts = {
          checkedOrRebuilt: 0,
          reused: 0,
          unjustifiedReuse: 0,
        };
        for (const state of Object.values(states)) {
          if (state === "reused") stateCounts.reused += 1;
          else if (state === "unjustified") stateCounts.unjustifiedReuse += 1;
          else stateCounts.checkedOrRebuilt += 1;
        }
        if (
          stateCounts.checkedOrRebuilt !== checked ||
          stateCounts.reused !== reused ||
          stateCounts.unjustifiedReuse !== unjustified
        ) {
          throw new Error(
            `Work accounting does not match node states for ${snapshot.id}/${methodId}`,
          );
        }
        requireArray(result.trace, "method trace").forEach((line) =>
          requireString(line, "method trace line"),
        );
      }
    }

    const concerns = requireArray(
      candidate.advisorConcerns,
      "questions",
    );
    if (concerns.length < 5) throw new Error("Missing questions");
    const concernIds = new Set();
    for (const concernValue of concerns) {
      const concern = requireObject(concernValue, "question");
      const id = requireString(concern.id, "question id");
      if (concernIds.has(id)) throw new Error("Duplicate question");
      concernIds.add(id);
      [
        "tabLabel",
        "question",
        "shortAnswer",
        "answer",
        "code",
        "bottomLine",
      ].forEach((field) =>
        requireString(concern[field], `question ${field}`),
      );
      const demo = requireObject(concern.clickDemo, "question demo");
      if (
        !snapshotIds.includes(demo.snapshot) ||
        !methodIds.includes(demo.method) ||
        !nodeIds.has(demo.node)
      ) {
        throw new Error("Invalid question demo");
      }
      const demoSteps = requireArray(
        concern.demoSteps,
        "question demo steps",
      );
      if (demoSteps.length === 0) throw new Error("Missing question demo steps");
      for (const stepValue of demoSteps) {
        const step = requireObject(stepValue, "question demo step");
        requireString(step.label, "question demo step label");
        if (
          !snapshotIds.includes(step.snapshot) ||
          !methodIds.includes(step.method) ||
          !nodeIds.has(step.node)
        ) {
          throw new Error("Invalid question demo step");
        }
      }
    }

    const onDemand = requireObject(candidate.onDemand, "on-demand section");
    ["title", "input", "rule"].forEach((field) =>
      requireString(onDemand[field], `on-demand ${field}`),
    );
    const demandSteps = requireArray(onDemand.steps, "on-demand steps");
    if (demandSteps.length < 4) throw new Error("Missing on-demand steps");
    const demandStepIds = new Set();
    for (const [index, stepValue] of demandSteps.entries()) {
      const step = requireObject(stepValue, "on-demand step");
      ["id", "label", "trigger", "fact", "evidence", "node"].forEach((field) =>
        requireString(step[field], `on-demand step ${field}`),
      );
      if (
        requireInteger(step.index, "on-demand step index") !== index + 1 ||
        demandStepIds.has(step.id)
      ) {
        throw new Error("On-demand steps must have unique sequential indices");
      }
      demandStepIds.add(step.id);
      if (!nodeIds.has(step.node)) throw new Error("Invalid demand node");
      if (step.revealsAtS1 !== undefined) {
        requireString(step.revealsAtS1, "on-demand S1 note");
      }
      if (step.snapshotOverrides !== undefined) {
        const overrides = requireAllowedKeys(
          step.snapshotOverrides,
          snapshotIds,
          "on-demand snapshot overrides",
        );
        for (const [snapshotId, overrideValue] of Object.entries(overrides)) {
          const override = requireAllowedKeys(
            overrideValue,
            ["label", "trigger", "fact", "evidence", "note"],
            `on-demand ${snapshotId} override`,
          );
          for (const value of Object.values(override)) {
            requireString(value, `on-demand ${snapshotId} override value`);
          }
        }
      }
    }

    const accounting = requireObject(
      candidate.workAccounting,
      "work accounting metadata",
    );
    requireString(accounting.unit, "work accounting unit");
    requireString(accounting.disclaimer, "work accounting disclaimer");
    if (accounting.totalPerRun !== dependencyNodeIds.length) {
      throw new Error("Work accounting total does not match dependency nodes");
    }

    const formal = requireObject(candidate.formalCore, "formal core");
    const definitions = requireArray(formal.definitions, "formal definitions");
    if (definitions.length < 3) throw new Error("Missing formal definitions");
    const definitionSymbols = new Set();
    for (const definitionValue of definitions) {
      const definition = requireObject(definitionValue, "formal definition");
      ["symbol", "meaning"].forEach((field) =>
        requireString(definition[field], `formal definition ${field}`),
      );
      if (definitionSymbols.has(definition.symbol)) {
        throw new Error("Duplicate formal definition");
      }
      definitionSymbols.add(definition.symbol);
    }
    for (const prefix of ["ResolveCert", "ProofCert", "ResultCert"]) {
      if (![...definitionSymbols].some((symbol) => symbol.startsWith(prefix))) {
        throw new Error(`Missing ${prefix} definition`);
      }
    }
    const theorems = requireArray(formal.theorems, "theorems");
    if (theorems.length < 3) throw new Error("Missing formal claims");
    const theoremIds = new Set();
    for (const theoremValue of theorems) {
      const theorem = requireObject(theoremValue, "theorem");
      ["id", "title", "statement", "meaning"].forEach((field) =>
        requireString(theorem[field], `theorem ${field}`),
      );
      if (theoremIds.has(theorem.id)) throw new Error("Duplicate theorem");
      theoremIds.add(theorem.id);
    }
    for (const id of [
      "incremental_fresh_equivalence",
      "demand_sufficiency",
    ]) {
      if (!theoremIds.has(id)) throw new Error(`Missing ${id} theorem`);
    }
    requireString(formal.hardPart, "formal hard part");

    const novelty = requireObject(
      candidate.noveltyBoundary,
      "novelty boundary",
    );
    [
      "candidateTopic",
      "candidateContribution",
      "reviewerRisk",
      "falsificationQuestion",
    ].forEach((field) =>
      requireString(novelty[field], `novelty ${field}`),
    );
    requireArray(novelty.notClaims, "not-claims");
    for (const field of [
      "whatTheExampleProves",
      "whatTheExampleDoesNotProve",
      "paperThreshold",
    ]) {
      const items = requireArray(novelty[field], `novelty ${field}`);
      if (items.length === 0) throw new Error(`Missing novelty ${field}`);
      items.forEach((item) => requireString(item, `novelty ${field} item`));
    }

    const priorWork = requireArray(candidate.priorWork, "prior work");
    if (priorWork.length < 3) throw new Error("Missing prior work");
    for (const itemValue of priorWork) {
      const item = requireObject(itemValue, "prior work item");
      ["name", "url", "alreadyHas", "boundaryToTest"].forEach((field) =>
        requireString(item[field], `prior work ${field}`),
      );
      safeLink(item.url);
    }

    return candidate;
  }

  function safeLink(value) {
    const raw = requireString(value, "URL");
    if (
      raw !== raw.trim() ||
      /[\u0000-\u001f\u007f\\]/u.test(raw) ||
      raw.startsWith("//")
    ) {
      throw new Error("Unsafe URL");
    }

    let parsed;
    let external = false;
    if (raw.startsWith("#")) {
      parsed = new URL(raw, window.location.href);
      if (
        parsed.origin !== window.location.origin ||
        parsed.pathname !== window.location.pathname ||
        parsed.search !== window.location.search
      ) {
        throw new Error("Unsafe URL");
      }
    } else if (raw.startsWith("/")) {
      parsed = new URL(raw, window.location.origin);
      if (parsed.origin !== window.location.origin) {
        throw new Error("Unsafe URL");
      }
    } else {
      if (!/^https:\/\//iu.test(raw)) throw new Error("Unsafe URL");
      parsed = new URL(raw);
      external = true;
    }

    if (
      (external && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error("Unsafe URL");
    }

    return {
      external,
      href: external
        ? parsed.href
        : `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  }

  function makeLink(label, href, className) {
    const anchor = make("a", className, label);
    const safe = safeLink(href);
    anchor.href = safe.href;
    if (safe.external) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Invalid base64");
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function sameBytes(left, right) {
    return (
      left.byteLength === right.byteLength &&
      left.every((value, index) => value === right[index])
    );
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
      !isObject(candidate) ||
      candidate.version !== 1 ||
      !isObject(candidate.kdf) ||
      !isObject(candidate.cipher) ||
      candidate.kdf.name !== "PBKDF2" ||
      candidate.kdf.hash !== "SHA-256" ||
      candidate.kdf.iterations !== 600000 ||
      candidate.cipher.name !== "AES-GCM" ||
      decodeBase64(candidate.kdf.salt).byteLength !== 16 ||
      decodeBase64(candidate.cipher.iv).byteLength !== 12 ||
      !sameBytes(
        decodeBase64(candidate.cipher.additionalData),
        fixedAdditionalData,
      )
    ) {
      throw new Error("Unsupported encrypted draft");
    }
    return candidate;
  }

  async function getEnvelope() {
    if (!envelopePromise) {
      envelopePromise = loadEnvelope().catch((error) => {
        envelopePromise = undefined;
        throw error;
      });
    }
    return envelopePromise;
  }

  async function decrypt(envelope, password) {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password.normalize("NFKC")),
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
      material,
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

  function setBusy(busy) {
    submitButton.disabled = busy;
    revealButton.disabled = busy;
    phraseInput.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
  }

  function showGateStatus(message, state = "neutral") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function getSnapshot() {
    return payload.snapshots.find((item) => item.id === selectedSnapshot);
  }

  function getMethod() {
    return payload.methods.find((item) => item.id === selectedMethod);
  }

  function getResult() {
    return getSnapshot().methodResults[selectedMethod];
  }

  function getNode(nodeId) {
    return payload.dependencyNodes.find((item) => item.id === nodeId);
  }

  function getConcern() {
    return (
      payload.advisorConcerns.find((item) => item.id === selectedConcern) ||
      payload.advisorConcerns[0]
    );
  }

  function makeRunButton(label, controlsId, onRun) {
    const button = make("button", "run-button");
    button.type = "button";
    button.setAttribute("aria-controls", controlsId);
    const icon = make("span", "run-button__icon", "▶");
    icon.setAttribute("aria-hidden", "true");
    const text = make("span", "", label);
    button.append(icon, text);
    button.addEventListener("click", () => {
      onRun();
      text.textContent = "shown ✓";
      window.setTimeout(() => {
        text.textContent = label;
      }, 850);
    });
    return button;
  }

  function makeCell(prompt, title, id, runButton) {
    const cell = make("section", "cell");
    cell.id = id;
    const rail = make("div", "cell-rail", prompt);
    rail.setAttribute("aria-hidden", "true");
    const panel = make("div", "cell-panel");
    const head = make("header", "cell-head");
    head.append(make("h2", "cell-title", title));
    if (runButton) head.append(runButton);
    panel.append(head);
    cell.append(rail, panel);
    return { cell, panel };
  }

  function makeOutputCell(prompt, id) {
    const cell = make("section", "output-cell");
    cell.id = id;
    const rail = make("div", "cell-rail", prompt);
    rail.setAttribute("aria-hidden", "true");
    const panel = make("div", "output-panel");
    cell.append(rail, panel);
    return { cell, panel };
  }

  function renderCodeBlock(title, context, code) {
    const block = make("div", "code-block");
    const label = make("div", "code-label");
    label.append(
      make("span", "", title),
      make("span", "code-context", context),
    );
    block.append(label, make("pre", "", code));
    return block;
  }

  function configureTablist(buttons, selectedId, onSelect) {
    const selectedIndex = Math.max(
      0,
      buttons.findIndex((button) => button.dataset.value === selectedId),
    );
    buttons.forEach((button, index) => {
      const selected = index === selectedIndex;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener("click", () => onSelect(button.dataset.value));
      button.addEventListener("keydown", (event) => {
        let nextIndex;
        if (event.key === "ArrowRight") {
          nextIndex = (index + 1) % buttons.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (index - 1 + buttons.length) % buttons.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = buttons.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        onSelect(buttons[nextIndex].dataset.value);
        buttons[nextIndex].focus();
      });
    });
  }

  function renderProblemFirst(data) {
    const section = make("section", "problem-first");
    section.id = "problem";

    const framing = make("div", "research-framing");
    const framingLabel = make(
      "p",
      "research-domain",
      "software verification · incremental program analysis",
    );
    const fixedFrame = make("div", "research-frame-card");
    fixedFrame.dataset.kind = "baseline";
    fixedFrame.append(
      make("p", "research-frame-label", "What is already solved"),
      make("h3", "", "One fixed snapshot"),
      make("p", "", data.model.coreDistinction.traditional),
      make("code", "", data.methods.find((item) => item.id === "fresh").call),
    );
    const incrementalFrame = make("div", "research-frame-card");
    incrementalFrame.dataset.kind = "question";
    incrementalFrame.append(
      make("p", "research-frame-label", "Where the research begins"),
      make("h3", "", "The resolved program changes"),
      make("p", "research-claim", data.meta.oneSentenceClaim),
      make(
        "code",
        "",
        data.formalCore.theorems.find(
          (item) => item.id === "incremental_fresh_equivalence",
        ).statement,
      ),
    );
    framing.append(framingLabel, fixedFrame, incrementalFrame);

    const intro = make("div", "problem-intro");
    intro.append(
      make("p", "problem-eyebrow", data.problemFirst.eyebrow),
      make("h2", "", data.problemFirst.title),
      make("p", "problem-lead", data.problemFirst.lead),
      make("pre", "problem-code", data.problemFirst.code),
    );

    const storyHead = make("div", "story-head");
    storyHead.append(
      make("h3", "", "Run the same property through three snapshots"),
      make(
        "p",
        "",
        "Choose a snapshot to load its exact code change, proof work, and verifier result.",
      ),
    );
    const snapshotStory = make("div", "snapshot-story");
    const storyNodes = { s0: "outcome", s1: "summary", s2: "slice" };
    for (const snapshot of data.snapshots) {
      const button = make("button", "snapshot-story-card");
      button.type = "button";
      button.dataset.storySnapshot = snapshot.id;
      button.setAttribute("aria-controls", "verification-output");
      button.setAttribute(
        "aria-pressed",
        String(snapshot.id === selectedSnapshot),
      );
      const verdict = make(
        "strong",
        "story-verdict",
        snapshot.referenceOutcome.label,
      );
      verdict.dataset.verdict = snapshot.referenceOutcome.verdict;
      button.append(
        make("span", "story-step", snapshot.id.toUpperCase()),
        make("h3", "", snapshot.title),
        make("p", "", snapshot.relevantChange),
        verdict,
      );
      button.addEventListener("click", () =>
        applyProblemState(
          snapshot.id,
          "linkscope",
          storyNodes[snapshot.id],
        ),
      );
      snapshotStory.append(button);
      refs.storyButtons.push(button);
    }

    const comparison = make("div", "problem-comparison");
    for (const [kind, label, copy] of [
      ["baseline", "Fresh baseline", data.problemFirst.baseline],
      ["failure", "Unsafe transport", data.problemFirst.failure],
      ["solution", "LinkScope response", data.problemFirst.solution],
    ]) {
      const card = make("div", "problem-card");
      card.dataset.kind = kind;
      card.append(make("strong", "", label), make("p", "", copy));
      comparison.append(card);
    }

    const answer = make("div", "problem-answer");
    const solved = make("p", "problem-solved", data.problemFirst.solved);
    const open = make("p", "problem-open", data.problemFirst.open);
    answer.append(solved, open);

    const guideHead = make("div", "story-head");
    guideHead.append(
      make("h3", "", "Compare the four important verifier runs"),
      make(
        "p",
        "",
        "The first pair shows the reuse opportunity; the second pair shows the stale-proof failure and the sound response.",
      ),
    );
    const controls = make("div", "problem-controls");
    const guideRuns = [
      { snapshot: "s1", method: "fresh", node: "outcome" },
      { snapshot: "s1", method: "linkscope", node: "summary" },
      { snapshot: "s2", method: "stale", node: "outcome" },
      { snapshot: "s2", method: "linkscope", node: "slice" },
    ];
    guideRuns.forEach((run, index) => {
      const snapshot = data.snapshots.find((item) => item.id === run.snapshot);
      const method = data.methods.find((item) => item.id === run.method);
      const result = snapshot.methodResults[run.method];
      const button = make("button", "guide-button");
      button.type = "button";
      button.dataset.problemSnapshot = run.snapshot;
      button.dataset.problemMethod = run.method;
      button.dataset.problemNode = run.node;
      button.setAttribute("aria-controls", "verification-output");
      button.setAttribute("aria-pressed", "false");
      button.append(
        make("span", "guide-number", String(index + 1)),
        make(
          "strong",
          "",
          `${method.label} at ${run.snapshot.toUpperCase()}`,
        ),
        make("span", "guide-result", result.badge),
      );
      button.addEventListener("click", () =>
        applyProblemState(run.snapshot, run.method, run.node),
      );
      controls.append(button);
      refs.problemButtons.push(button);
    });

    section.append(
      framing,
      intro,
      storyHead,
      snapshotStory,
      comparison,
      guideHead,
      controls,
      answer,
    );
    return section;
  }

  function renderNotebook(data) {
    payload = data;
    selectedSnapshot = "s2";
    selectedMethod = "linkscope";
    selectedNode = "slice";
    selectedConcern = "does_it_solve";
    selectedConcernStep = "";
    selectedPrior = 0;
    discoveryCount = 0;
    refs = {
      methodButtons: [],
      snapshotButtons: [],
      proofButtons: new Map(),
      concernButtons: new Map(),
      priorButtons: [],
      problemButtons: [],
      storyButtons: [],
      meterUnits: [],
      discoverySteps: [],
      renderedConcernId: "",
    };

    const root = make("div", "notebook-page");
    const header = make("header", "notebook-header");
    const headingCopy = make("div");
    headingCopy.append(
      make("p", "notebook-path", data.meta.pathLabel),
      make("h1", "", data.meta.title),
      make("p", "notebook-subtitle", data.meta.subtitle),
    );
    const heading = headingCopy.querySelector("h1");
    const badge = make("div", "draft-badge", data.meta.status);
    header.append(headingCopy, badge);

    const problemFirst = renderProblemFirst(data);
    const workspace = make("div", "workspace");
    const notebookMain = make("main", "notebook-main");
    const experiment = renderExperiment(data);

    const definitionOutput = makeOutputCell("Out [1]", "definition-output");
    const definitionMeta = data.notebook.cells.find(
      (item) => item.id === "define",
    );
    const definitionCell = makeCell(
      definitionMeta.prompt,
      definitionMeta.title,
      "definition",
      makeRunButton("show current result", "definition-output", () => {
        refs.definitionOutput.focus({ preventScroll: true });
      }),
    );
    const codePair = make("div", "code-pair");
    refs.implementationBlock = renderCodeBlock("", "", "");
    refs.implementationTitle =
      refs.implementationBlock.querySelector(".code-label span");
    refs.implementationContext =
      refs.implementationBlock.querySelector(".code-context");
    refs.implementationCode = refs.implementationBlock.querySelector("pre");
    codePair.append(
      renderCodeBlock(
        data.model.proxy.title,
        "persistent storage + dynamic entry",
        data.model.proxy.code,
      ),
      refs.implementationBlock,
    );
    refs.propertyCode = make("pre", "property-code");
    refs.propertyCode.append(
      make("span", "property-symbol", "q"),
      document.createTextNode(data.model.query.code),
    );
    const frameProof = make("div", "frame-proof");
    frameProof.append(
      make("code", "", data.model.executionFrame.formula),
      make("p", "", data.model.executionFrame.proofTransport),
    );
    const symbolStrip = make("div", "symbol-strip");
    data.model.symbols.slice(0, 4).forEach((item) => {
      const symbol = make("div", "symbol-card");
      symbol.append(
        make("code", "", item.symbol),
        make("p", "", item.meaning),
      );
      symbolStrip.append(symbol);
    });

    const transportDefinitions = ["ResolveCert", "ProofCert", "ResultCert"].map(
      (prefix) =>
        data.formalCore.definitions.find((item) =>
          item.symbol.startsWith(prefix),
        ),
    );
    const transportCode = [
      `${transportDefinitions[0].symbol}\n  ${transportDefinitions[0].meaning}`,
      "+",
      `${transportDefinitions[1].symbol}\n  ${transportDefinitions[1].meaning}`,
      "↓",
      `${transportDefinitions[2].symbol}\n  ${transportDefinitions[2].meaning}`,
    ].join("\n\n");
    frameProof.replaceChildren();
    const frameMeaning = make("div", "frame-meaning");
    frameMeaning.append(
      make("code", "", data.model.executionFrame.formula),
      make("p", "", data.model.executionFrame.whyNotConcatenation),
    );
    const transport = make("div", "transport");
    transport.append(
      make("pre", "transport-code", transportCode),
      make("p", "", data.model.executionFrame.proofTransport),
    );
    frameProof.append(frameMeaning, transport);

    definitionCell.panel.append(
      symbolStrip,
      codePair,
      refs.propertyCode,
      frameProof,
    );
    refs.definitionOutput = make("div", "output-line");
    refs.definitionOutput.tabIndex = -1;
    refs.definitionOutputLabel = make("strong", "output-label");
    refs.definitionOutputText = make("span");
    refs.definitionOutput.append(
      refs.definitionOutputLabel,
      refs.definitionOutputText,
    );
    definitionOutput.panel.append(refs.definitionOutput);

    const compareMeta = data.notebook.cells.find(
      (item) => item.id === "compare",
    );
    const verifyCell = makeCell(
      compareMeta.prompt,
      compareMeta.title,
      "verify",
      makeRunButton("show selected result", "verification-output", () => {
        updateExperiment();
        refs.verificationOutput.focus({ preventScroll: true });
      }),
    );
    const methodTabs = make("div", "method-tabs");
    methodTabs.setAttribute("role", "tablist");
    methodTabs.setAttribute("aria-label", "Verification design");
    refs.methodButtons = data.methods.map((method) => {
      const button = make("button", "method-tab");
      button.type = "button";
      button.id = `method-${method.id}`;
      button.dataset.method = method.id;
      button.dataset.value = method.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "verification-output");
      button.append(
        document.createTextNode(method.label),
        make("span", "", method.short),
      );
      methodTabs.append(button);
      return button;
    });
    configureTablist(refs.methodButtons, selectedMethod, selectMethod);

    refs.verificationOutput = make("div", "method-output");
    refs.verificationOutput.id = "verification-output";
    refs.verificationOutput.tabIndex = -1;
    refs.verificationOutput.setAttribute("role", "tabpanel");
    refs.verificationOutput.setAttribute("aria-live", "polite");
    refs.verificationOutput.setAttribute("aria-labelledby", "method-linkscope");
    const resultRow = make("div", "result-row");
    const verdictStack = make("div", "verdict-stack");
    refs.verifierStatus = make("p", "verifier-status");
    refs.verifierStatus.dataset.role = "verifier-status";
    refs.resultBadge = make("div", "result-badge");
    refs.resultBadge.dataset.role = "result-badge";
    verdictStack.append(refs.verifierStatus, refs.resultBadge);
    const resultCopy = make("div", "result-copy");
    refs.resultHeadline = make("h3");
    refs.resultExplanation = make("p");
    refs.resultExplanation.dataset.role = "method-explanation";
    resultCopy.append(refs.resultHeadline, refs.resultExplanation);
    resultRow.append(verdictStack, resultCopy);
    refs.methodTrace = make("pre", "discovery-console");
    refs.methodTrace.dataset.role = "method-trace";
    refs.verificationOutput.append(resultRow, refs.methodTrace);
    verifyCell.panel.append(methodTabs, refs.verificationOutput);

    const dependencyMeta = data.notebook.cells.find(
      (item) => item.id === "dependencies",
    );
    const dependencyCell = makeCell(
      dependencyMeta.prompt,
      dependencyMeta.title,
      "dependencies",
    );
    const dependencyBody = make("div", "method-output");
    const proofGrid = make("div", "proof-grid");
    proofGrid.setAttribute("aria-label", "Certificate dependency nodes");
    for (const node of data.dependencyNodes) {
      const button = make("button", "proof-node", node.shortLabel);
      button.type = "button";
      button.dataset.node = node.id;
      button.setAttribute("aria-pressed", String(node.id === selectedNode));
      button.addEventListener("click", () => selectNode(node.id, true));
      proofGrid.append(button);
      refs.proofButtons.set(node.id, button);
    }
    refs.nodeInspector = make("div", "node-inspector");
    refs.nodeInspector.dataset.role = "proof-inspector";
    refs.nodeInspector.setAttribute("role", "status");
    refs.nodeInspector.setAttribute("aria-live", "polite");
    const legend = make("div", "state-legend");
    for (const item of data.nodeStatusLegend) {
      const entry = make("span", "legend-item", item.label);
      entry.dataset.kind = item.id;
      legend.append(entry);
    }
    dependencyBody.append(proofGrid, refs.nodeInspector, legend);
    dependencyCell.panel.append(dependencyBody);

    const questionMeta = data.notebook.cells.find(
      (item) => item.id === "concerns",
    );
    const concernCell = makeCell(
      questionMeta.prompt,
      questionMeta.title,
      "questions",
    );
    concernCell.cell.classList.add("qa-cell");
    const concernBody = make("div", "concern-body");
    const concernTabs = make("div", "concern-tabs");
    for (const concern of data.advisorConcerns) {
      const button = make("button", "concern-tab", concern.tabLabel);
      button.type = "button";
      button.dataset.question = concern.id;
      button.setAttribute("aria-controls", "qa-answer");
      button.setAttribute(
        "aria-pressed",
        String(concern.id === selectedConcern),
      );
      button.addEventListener("click", () => selectConcern(concern.id, true));
      concernTabs.append(button);
      refs.concernButtons.set(concern.id, button);
    }
    refs.advisorAnswer = make("div", "advisor-answer");
    refs.advisorAnswer.id = "qa-answer";
    const advisorQuestion = make("div", "advisor-question");
    advisorQuestion.append(make("p", "qa-marker", "Q"));
    refs.concernQuestion = make("h3");
    refs.concernQuestion.tabIndex = -1;
    refs.concernShort = make("p");
    advisorQuestion.append(refs.concernQuestion, refs.concernShort);
    const advisorResult = make("div", "advisor-result");
    advisorResult.append(make("p", "qa-marker", "A"));
    refs.concernCode = make("code");
    refs.concernAnswer = make("p");
    refs.concernBottom = make("p");
    refs.concernBottom.className = "novelty-warning";
    refs.concernSteps = make("div", "advisor-controls");
    advisorResult.append(
      refs.concernCode,
      refs.concernAnswer,
      refs.concernBottom,
      refs.concernSteps,
    );
    refs.advisorAnswer.append(advisorQuestion, advisorResult);
    concernBody.append(concernTabs, refs.advisorAnswer);
    concernCell.panel.append(concernBody);

    const discoveryMeta = data.notebook.cells.find(
      (item) => item.id === "discover",
    );
    const discoveryCell = makeCell(
      discoveryMeta.prompt,
      discoveryMeta.title,
      "discovery",
      makeRunButton("show next fact", "discovery-output", () => {
        revealNextFact();
        refs.discoveryOutput.focus({ preventScroll: true });
      }),
    );
    const discoveryBody = make("div", "discovery-body");
    discoveryBody.append(
      make(
        "p",
        "discovery-intro",
        `${data.onDemand.input} ${data.onDemand.rule}`,
      ),
    );
    refs.discoverySteps = data.onDemand.steps.map((step) => {
      const item = make("div", "discovery-step", `${step.index}. ${step.label}`);
      item.dataset.discoveryStep = step.id;
      item.dataset.visible = "false";
      item.dataset.current = "false";
      return item;
    });
    const discoverySteps = make("div", "discovery-steps");
    discoverySteps.append(...refs.discoverySteps);
    refs.discoveryOutput = make("pre", "discovery-console");
    refs.discoveryOutput.id = "discovery-output";
    refs.discoveryOutput.dataset.role = "discovery-output";
    refs.discoveryOutput.tabIndex = -1;
    refs.discoveryOutput.setAttribute("role", "status");
    refs.discoveryOutput.setAttribute("aria-live", "polite");
    const discoveryControls = make("div", "discovery-controls");
    refs.nextFactButton = make("button", "run-button", "show next fact");
    refs.nextFactButton.type = "button";
    refs.nextFactButton.addEventListener("click", revealNextFact);
    refs.resetFactsButton = make("button", "secondary-button", "reset");
    refs.resetFactsButton.type = "button";
    refs.resetFactsButton.addEventListener("click", resetDiscovery);
    discoveryControls.append(refs.nextFactButton, refs.resetFactsButton);
    discoveryBody.append(
      discoverySteps,
      refs.discoveryOutput,
      discoveryControls,
    );
    discoveryCell.panel.append(discoveryBody);

    const formalMeta = data.notebook.cells.find(
      (item) => item.id === "formal",
    );
    const formalCell = makeCell(
      formalMeta.prompt,
      formalMeta.title,
      "formal",
    );
    const formalBody = make("div", "formal-body");
    formalBody.id = "novelty";
    const claimGrid = make("div", "claim-grid");
    const primaryClaimIds = [
      "incremental_fresh_equivalence",
      "demand_sufficiency",
    ];
    const orderedClaims = [
      ...primaryClaimIds.map((id) =>
        data.formalCore.theorems.find((item) => item.id === id),
      ),
      ...data.formalCore.theorems.filter(
        (item) => !primaryClaimIds.includes(item.id),
      ),
    ];
    for (const theorem of orderedClaims) {
      const card = make("section", "claim-card");
      card.dataset.priority = primaryClaimIds.includes(theorem.id)
        ? "primary"
        : "supporting";
      card.append(
        make("p", "claim-label", theorem.title),
        make("pre", "formula-code", theorem.statement),
        make("p", "", theorem.meaning),
      );
      if (Array.isArray(theorem.assumptions)) {
        card.append(
          make(
            "p",
            "",
            `Assumptions: ${theorem.assumptions.join("; ")}.`,
          ),
        );
      }
      claimGrid.append(card);
    }
    const boundaryHeading = make("div", "boundary-heading");
    boundaryHeading.append(
      make("p", "advisor-eyebrow", "honest status"),
      make("h3", "", data.noveltyBoundary.candidateTopic),
      make("p", "", data.noveltyBoundary.candidateContribution),
    );
    const boundaryGrid = make("div", "boundary-grid");
    for (const [kind, title, items] of [
      [
        "solved",
        "What the worked example establishes",
        data.noveltyBoundary.whatTheExampleProves,
      ],
      [
        "open",
        "What it does not establish",
        data.noveltyBoundary.whatTheExampleDoesNotProve,
      ],
    ]) {
      const card = make("section", "boundary-card");
      card.dataset.kind = kind;
      const list = make("ul");
      items.forEach((item) => list.append(make("li", "", item)));
      card.append(make("h3", "", title), list);
      boundaryGrid.append(card);
    }
    const threshold = make("section", "paper-threshold");
    const thresholdList = make("ul");
    data.noveltyBoundary.paperThreshold.forEach((item) =>
      thresholdList.append(make("li", "", item)),
    );
    threshold.append(
      make("h3", "", "What would make this a paper"),
      thresholdList,
      make(
        "p",
        "falsification-question",
        data.noveltyBoundary.falsificationQuestion,
      ),
    );
    const noveltyWarning = make(
      "div",
      "novelty-warning",
      `${data.noveltyBoundary.candidateContribution} Risk: ${data.noveltyBoundary.reviewerRisk} Hard part: ${data.formalCore.hardPart}`,
    );

    const priorTabs = make("div", "prior-tabs");
    priorTabs.setAttribute("role", "tablist");
    priorTabs.setAttribute("aria-label", "Closest previous work");
    refs.priorButtons = data.priorWork.map((item, index) => {
      const button = make("button", "prior-tab", item.name);
      button.type = "button";
      button.dataset.prior = String(index);
      button.dataset.value = String(index);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "prior-output");
      priorTabs.append(button);
      return button;
    });
    configureTablist(refs.priorButtons, "0", (value) => {
      selectedPrior = Number(value);
      updatePriorWork();
    });
    refs.priorOutput = make("div", "prior-result");
    refs.priorOutput.id = "prior-output";
    refs.priorOutput.setAttribute("role", "tabpanel");
    const priorCovered = make("div", "prior-card");
    priorCovered.dataset.kind = "covered";
    priorCovered.append(make("strong", "", "already covers"));
    refs.priorCoveredText = make("p");
    priorCovered.append(refs.priorCoveredText);
    const priorMissing = make("div", "prior-card");
    priorMissing.dataset.kind = "missing";
    priorMissing.append(make("strong", "", "candidate boundary to test"));
    refs.priorMissingText = make("p");
    refs.priorLinkSlot = make("div");
    priorMissing.append(refs.priorMissingText, refs.priorLinkSlot);
    refs.priorOutput.append(priorCovered, priorMissing);

    formalBody.append(
      boundaryHeading,
      claimGrid,
      boundaryGrid,
      threshold,
      noveltyWarning,
      make("p", "advisor-eyebrow", "closest work — click to compare"),
      priorTabs,
      refs.priorOutput,
    );
    formalCell.panel.append(formalBody);

    notebookMain.append(
      definitionCell.cell,
      definitionOutput.cell,
      verifyCell.cell,
      concernCell.cell,
      dependencyCell.cell,
      discoveryCell.cell,
      formalCell.cell,
    );

    workspace.append(notebookMain, experiment);
    const footer = make("footer", "notebook-footer");
    footer.append(
      make("p", "", data.meta.footer),
      makeLink(data.meta.homeLabel, "/", ""),
    );
    root.append(header, problemFirst, workspace, footer);

    refs.heading = heading;
    updateAll();
    return root;
  }

  function renderExperiment(data) {
    const aside = make("aside", "experiment");
    aside.setAttribute("aria-label", "Synchronized upgrade experiment");
    const head = make("header", "experiment-head");
    head.append(
      make("h2", "", "Upgrade experiment"),
      make("p", "", data.notebook.instructions),
    );
    const tabs = make("div", "snapshot-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Immutable snapshot");
    refs.snapshotButtons = data.snapshots.map((snapshot) => {
      const button = make("button", "snapshot-tab");
      button.type = "button";
      button.id = `snapshot-${snapshot.id}`;
      button.dataset.snapshot = snapshot.id;
      button.dataset.value = snapshot.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "verification-output");
      const [main, ...rest] = snapshot.tabLabel.split(" · ");
      button.append(
        document.createTextNode(main),
        make("span", "", rest.join(" · ")),
      );
      tabs.append(button);
      return button;
    });
    configureTablist(refs.snapshotButtons, selectedSnapshot, selectSnapshot);

    const diff = make("div", "implementation-diff");
    refs.diffTitle = make("p", "diff-title");
    refs.diffLines = make("div", "diff-lines");
    refs.diffLines.dataset.role = "diff-code";
    diff.append(refs.diffTitle, refs.diffLines);

    const meter = make("div", "work-meter");
    const meterHead = make("div", "meter-head");
    refs.meterLabel = make("span");
    refs.meterValue = make("strong");
    const counts = make("span");
    refs.reuseCount = make("span");
    refs.reuseCount.dataset.role = "reuse-count";
    refs.checkCount = make("span");
    refs.checkCount.dataset.role = "check-count";
    counts.append(refs.reuseCount, document.createTextNode(" · "), refs.checkCount);
    meterHead.append(refs.meterLabel, refs.meterValue);
    const units = make("div", "meter-units");
    for (let index = 0; index < 8; index += 1) {
      const unit = make("span", "meter-unit");
      units.append(unit);
      refs.meterUnits.push(unit);
    }
    meter.append(meterHead, counts, units);
    refs.workDisclaimer = make(
      "p",
      "work-disclaimer",
      data.workAccounting.disclaimer,
    );
    meter.append(refs.workDisclaimer);

    refs.counterexample = make("div", "counterexample");
    refs.counterexample.dataset.role = "counterexample";
    refs.counterexample.hidden = true;
    const takeaway = make("div", "experiment-takeaway");
    takeaway.append(make("strong", "", "current explanation"));
    refs.takeaway = make("p");
    takeaway.append(refs.takeaway);
    aside.append(head, tabs, diff, meter, refs.counterexample, takeaway);
    return aside;
  }

  function selectSnapshot(id) {
    if (!snapshotIds.includes(id)) return;
    selectedSnapshot = id;
    selectedConcernStep = "";
    discoveryCount = 0;
    updateAll();
  }

  function selectMethod(id) {
    if (!methodIds.includes(id)) return;
    selectedMethod = id;
    selectedConcernStep = "";
    updateAll();
  }

  function selectNode(id, announce = false) {
    if (!getNode(id)) return;
    selectedNode = id;
    if (announce) selectedConcernStep = "";
    updateProofNodes();
    updateConcernStepStates();
    if (announce) refs.nodeInspector.focus?.({ preventScroll: true });
  }

  function applyProblemState(snapshotId, methodId, nodeId) {
    selectedSnapshot = snapshotId;
    selectedMethod = methodId;
    selectedNode = nodeId;
    selectedConcernStep = "";
    discoveryCount = 0;
    updateAll();
    refs.verificationOutput.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    refs.verificationOutput.focus({ preventScroll: true });
  }

  function updateProblemControls() {
    for (const button of refs.problemButtons) {
      const active =
        button.dataset.problemSnapshot === selectedSnapshot &&
        button.dataset.problemMethod === selectedMethod;
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of refs.storyButtons) {
      button.setAttribute(
        "aria-pressed",
        String(
          button.dataset.storySnapshot === selectedSnapshot &&
            selectedMethod === "linkscope",
        ),
      );
    }
  }

  function updateAll() {
    updateTabStates();
    updateProblemControls();
    updateDefinition();
    updateExperiment();
    updateProofNodes();
    updateConcern(false);
    updateDiscovery();
    updatePriorWork();
  }

  function updateTabStates() {
    refs.snapshotButtons.forEach((button) => {
      const active = button.dataset.snapshot === selectedSnapshot;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    refs.methodButtons.forEach((button) => {
      const active = button.dataset.method === selectedMethod;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    refs.verificationOutput.setAttribute(
      "aria-labelledby",
      `method-${selectedMethod}`,
    );
  }

  function updateDefinition() {
    const snapshot = getSnapshot();
    const reference = snapshot.referenceOutcome;
    refs.implementationTitle.textContent = snapshot.codeTitle;
    refs.implementationContext.textContent = snapshot.title;
    refs.implementationCode.textContent = snapshot.code;
    refs.definitionOutput.dataset.tone =
      reference.verdict === "refuted" ? "danger" : "success";
    refs.definitionOutputLabel.textContent = reference.label;
    refs.definitionOutputText.textContent = reference.reason;
  }

  function verifierStatusFor(result) {
    if (result.correctness === "correct") {
      return { state: "correct", label: "VERIFIER · MATCHES FRESH ✓" };
    }
    if (result.correctness === "correct_initial_run") {
      return { state: "limited", label: "VERIFIER · VALID AT S0 ONLY" };
    }
    if (
      result.correctness === "accidentally_correct_but_unjustified" ||
      result.correctness === "accidentally_correct_but_policy_unsound"
    ) {
      return {
        state: "unsound",
        label: "VERIFIER · BOOLEAN MATCHES, POLICY UNSOUND",
      };
    }
    return { state: "wrong", label: "VERIFIER · WRONG VS FRESH ✗" };
  }

  function updateExperiment() {
    const snapshot = getSnapshot();
    const method = getMethod();
    const result = getResult();

    refs.resultBadge.textContent = result.badge;
    refs.resultBadge.dataset.tone = result.tone;
    const verifierStatus = verifierStatusFor(result);
    refs.verifierStatus.textContent = verifierStatus.label;
    refs.verifierStatus.dataset.state = verifierStatus.state;
    refs.resultHeadline.textContent = result.headline;
    refs.resultExplanation.textContent = result.explanation;
    refs.methodTrace.textContent = result.trace
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");

    refs.diffTitle.textContent = `${snapshot.diffTitle} · implementation diff`;
    refs.diffLines.replaceChildren();
    for (const lineText of snapshot.diff.split("\n")) {
      const trimmed = lineText.trimStart();
      const kind = trimmed.startsWith("+")
        ? "add"
        : trimmed.startsWith("-")
          ? "remove"
          : trimmed.startsWith("#")
            ? "warning"
            : "context";
      const line = make("p", "diff-line", lineText);
      line.dataset.kind = kind;
      refs.diffLines.append(line);
    }

    const work = result.work;
    refs.meterLabel.textContent = `${method.label} at ${snapshot.id.toUpperCase()}`;
    refs.meterValue.textContent =
      work.unjustifiedReuse > 0
        ? `${work.unjustifiedReuse} unjustified`
        : `${work.reused} reuse / ${work.checkedOrRebuilt} check`;
    refs.reuseCount.textContent = `safe reuse ${work.reused}`;
    refs.checkCount.textContent = `checked ${work.checkedOrRebuilt}`;

    payload.dependencyNodes.forEach((node, index) => {
      refs.meterUnits[index].dataset.state = result.nodeStates[node.id];
    });

    if (result.counterexample) {
      refs.counterexample.hidden = false;
      refs.counterexample.textContent = result.counterexample;
    } else {
      refs.counterexample.hidden = true;
      refs.counterexample.textContent = "";
    }
    refs.takeaway.textContent = `${snapshot.relevantChange} ${result.headline}`;
  }

  function updateProofNodes() {
    const result = getResult();
    const legendById = new Map(
      payload.nodeStatusLegend.map((item) => [item.id, item]),
    );
    for (const node of payload.dependencyNodes) {
      const state = result.nodeStates[node.id];
      const button = refs.proofButtons.get(node.id);
      button.dataset.state = state;
      button.setAttribute("aria-pressed", String(node.id === selectedNode));
      const stateLabel = legendById.get(state)?.label || state;
      button.setAttribute(
        "aria-label",
        `${node.label}: ${stateLabel}. Activate for explanation.`,
      );
    }
    const node = getNode(selectedNode);
    const state = result.nodeStates[selectedNode];
    const meaning = legendById.get(state)?.meaning || state;
    const override = result.nodeReasonOverrides?.[selectedNode];
    refs.nodeInspector.textContent = `${node.label} · ${state}. ${
      override || node.description
    } ${meaning} Key: ${node.key}`;
  }

  function concernSteps() {
    return getConcern().demoSteps;
  }

  function selectConcern(id, applyFirstDemo) {
    if (!payload.advisorConcerns.some((item) => item.id === id)) return;
    selectedConcern = id;
    selectedConcernStep = "";
    for (const [concernId, button] of refs.concernButtons) {
      button.setAttribute("aria-pressed", String(concernId === id));
    }
    updateConcern(applyFirstDemo);
    refs.concernQuestion.focus({ preventScroll: true });
  }

  function concernStepKey(step) {
    return `${step.snapshot}:${step.method}:${step.node}:${step.label}`;
  }

  function updateConcernStepStates() {
    if (!refs.concernSteps) return;
    for (const button of refs.concernSteps.querySelectorAll(
      "[data-concern-step]",
    )) {
      const active = button.dataset.concernStep === selectedConcernStep;
      button.setAttribute("aria-pressed", String(active));
      button.dataset.active = String(active);
    }
  }

  function scrollConcernEvidence() {
    if (!window.matchMedia?.("(max-width: 1080px)").matches) return;
    const target =
      selectedConcern === "on_demand"
        ? refs.discoveryOutput
        : refs.verificationOutput;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function applyConcernStep(step, scrollEvidence = true) {
    selectedConcernStep = concernStepKey(step);
    selectedSnapshot = step.snapshot;
    selectedMethod = step.method;
    selectedNode = step.node;
    discoveryCount = 0;
    updateAll();
    if (scrollEvidence) scrollConcernEvidence();
  }

  function updateConcern(applyFirstDemo) {
    const concern = getConcern();
    refs.concernQuestion.textContent = concern.question;
    refs.concernShort.textContent = concern.shortAnswer;
    refs.concernCode.textContent = concern.code;
    refs.concernAnswer.textContent = concern.answer;
    refs.concernBottom.textContent = concern.bottomLine;
    const steps = concernSteps();
    if (refs.renderedConcernId !== concern.id) {
      refs.concernSteps.replaceChildren();
      for (const step of steps) {
        const button = make("button", "secondary-button", step.label);
        button.type = "button";
        button.dataset.concernStep = concernStepKey(step);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => applyConcernStep(step));
        refs.concernSteps.append(button);
      }
      refs.renderedConcernId = concern.id;
    }
    updateConcernStepStates();
    if (applyFirstDemo && steps[0]) applyConcernStep(steps[0], false);
  }

  function revealNextFact() {
    if (discoveryCount < payload.onDemand.steps.length) {
      discoveryCount += 1;
      updateDiscovery();
    }
  }

  function resetDiscovery() {
    discoveryCount = 0;
    updateDiscovery();
  }

  function demandStepForSnapshot(step, snapshotId) {
    const override = step.snapshotOverrides?.[snapshotId];
    return override ? { ...step, ...override } : step;
  }

  function updateDiscovery() {
    const steps = payload.onDemand.steps;
    const resolvedSteps = steps.map((step) =>
      demandStepForSnapshot(step, selectedSnapshot),
    );
    refs.discoverySteps.forEach((element, index) => {
      element.textContent = `${resolvedSteps[index].index}. ${resolvedSteps[index].label}`;
      element.dataset.visible = String(index < discoveryCount);
      element.dataset.current = String(index === discoveryCount - 1);
    });
    refs.nextFactButton.disabled = discoveryCount >= steps.length;
    refs.resetFactsButton.disabled = discoveryCount === 0;

    const snapshot = getSnapshot();
    const lines = [
      `query> prove(${snapshot.id.toUpperCase()}, P, q_limit)`,
      `facts checked: ${discoveryCount}/${steps.length}`,
    ];
    if (discoveryCount === 0) {
      lines.push("status: unknown · no dynamic facts acquired yet");
    }
    for (const step of resolvedSteps.slice(0, discoveryCount)) {
      lines.push(
        "",
        `[${step.index}] ${step.label}`,
        `fact: ${step.fact}`,
        `evidence: ${step.evidence}`,
      );
      if (
        selectedSnapshot === "s1" &&
        step.revealsAtS1 &&
        !step.snapshotOverrides?.s1
      ) {
        lines.push(`S1: ${step.revealsAtS1}`);
      }
      if (step.note) {
        lines.push(`${snapshot.id.toUpperCase()}: ${step.note}`);
      } else if (
        step.id === "need_slice" &&
        selectedSnapshot !== "s1" &&
        !step.snapshotOverrides?.[selectedSnapshot]
      ) {
        lines.push(`${snapshot.id.toUpperCase()}: ${snapshot.relevantChange}`);
      }
    }
    if (discoveryCount === steps.length) {
      lines.push(
        "",
        `outcome: ${snapshot.referenceOutcome.verdict}`,
        snapshot.referenceOutcome.reason,
      );
    } else {
      lines.push("", `next demand: ${resolvedSteps[discoveryCount].fact}`);
    }
    refs.discoveryOutput.textContent = lines.join("\n");
  }

  function updatePriorWork() {
    const item = payload.priorWork[selectedPrior] || payload.priorWork[0];
    refs.priorButtons.forEach((button, index) => {
      const active = index === selectedPrior;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    refs.priorCoveredText.textContent = item.alreadyHas;
    refs.priorMissingText.textContent = item.boundaryToTest;
    refs.priorLinkSlot.replaceChildren(
      makeLink(`open ${item.name}`, item.url, "prior-link"),
    );
  }

  function consumePasswordFragment(allowDecode) {
    const hash = window.location.hash;
    if (!hash.startsWith("#pwd=")) {
      return { recognized: false, phrase: "", error: "" };
    }

    const encoded = hash.slice(5);
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    } catch {
      return {
        recognized: true,
        phrase: "",
        error: "The password link could not be cleared safely. Enter the phrase manually.",
      };
    }
    if (window.location.hash !== "") {
      return {
        recognized: true,
        phrase: "",
        error: "The password link could not be cleared safely. Enter the phrase manually.",
      };
    }
    if (!allowDecode) {
      return { recognized: true, phrase: "", error: "" };
    }
    if (
      encoded.length === 0 ||
      encoded.length > 1024 ||
      encoded.includes("&")
    ) {
      return {
        recognized: true,
        phrase: "",
        error: "This password link is malformed. Enter the phrase manually.",
      };
    }

    let phrase;
    try {
      phrase = decodeURIComponent(encoded).normalize("NFKC");
    } catch {
      return {
        recognized: true,
        phrase: "",
        error: "This password link is malformed. Enter the phrase manually.",
      };
    }
    if (phrase.length < 16 || phrase.length > 256) {
      return {
        recognized: true,
        phrase: "",
        error: "This password link is malformed. Enter the phrase manually.",
      };
    }
    return { recognized: true, phrase, error: "" };
  }

  let framed = true;
  try {
    framed = window.top !== window.self;
  } catch {
    framed = true;
  }
  let passwordFragment = consumePasswordFragment(!framed);
  if (framed) {
    passwordFragment = undefined;
    phraseInput.value = "";
    phraseInput.disabled = true;
    revealButton.disabled = true;
    submitButton.disabled = true;
    form.setAttribute("aria-disabled", "true");
    showGateStatus(
      "Best-effort framing check: open this private draft directly in a new tab to unlock it.",
      "error",
    );
    return;
  }

  async function unlockWithPhrase(candidatePhrase) {
    if (!window.crypto?.subtle) {
      showGateStatus(
        "This browser cannot decrypt the draft. Use a current browser over HTTPS.",
        "error",
      );
      return;
    }
    phraseInput.value = "";
    setBusy(true);
    showGateStatus("Deriving a local decryption key…");
    try {
      const envelope = await getEnvelope();
      const plaintext = await decrypt(envelope, candidatePhrase);
      const candidate = validatePayload(JSON.parse(plaintext));
      const rendered = renderNotebook(candidate);
      app.replaceChildren(rendered);
      gate.hidden = true;
      app.hidden = false;
      document.title = candidate.meta.pageTitle;
      window.scrollTo({ top: 0, behavior: "instant" });
      refs.heading.tabIndex = -1;
      refs.heading.focus({ preventScroll: true });
    } catch (error) {
      console.error("Research draft unlock failed", error);
      app.replaceChildren();
      app.hidden = true;
      showGateStatus("Could not unlock. Check the phrase and try again.", "error");
      phraseInput.focus();
      phraseInput.select();
    } finally {
      candidatePhrase = "";
      phraseInput.value = "";
      setBusy(false);
    }
  }

  revealButton.addEventListener("click", () => {
    const reveal = phraseInput.type === "password";
    phraseInput.type = reveal ? "text" : "password";
    revealButton.textContent = reveal ? "Hide" : "Show";
    revealButton.setAttribute("aria-pressed", String(reveal));
    revealButton.setAttribute(
      "aria-label",
      reveal ? "Hide access phrase" : "Show access phrase",
    );
    phraseInput.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const manualPhrase = phraseInput.value;
    phraseInput.value = "";
    void unlockWithPhrase(manualPhrase);
  });

  if (passwordFragment.error) {
    const fragmentError = passwordFragment.error;
    passwordFragment = undefined;
    showGateStatus(fragmentError, "error");
  } else if (passwordFragment.phrase) {
    const fragmentPhrase = passwordFragment.phrase;
    passwordFragment.phrase = "";
    passwordFragment = undefined;
    void unlockWithPhrase(fragmentPhrase);
  } else {
    passwordFragment = undefined;
  }

  window.addEventListener("pagehide", () => {
    payload = undefined;
    refs = {};
    app.replaceChildren();
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
})();
