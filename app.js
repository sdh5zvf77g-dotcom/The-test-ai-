(function () {
  "use strict";

  function showError(msg) {
    var b = document.getElementById("errBanner");
    if (!b) return;
    b.style.display = "block";
    b.textContent = "AI Council error: " + msg + " (tap to dismiss)";
    b.onclick = function () { b.style.display = "none"; };
  }

  window.onerror = function (msg, src, line, col, error) {
    // Safari can report cross-origin failures as the unhelpful "Script error.".
    // Do not let that generic report cover the app controls or imply a known line.
    var message = String(msg || "Unexpected script error");
    if (message === "Script error." && !(src || line || col || error)) {
      console.warn("AI Council: browser reported an opaque script error; check network/extension errors.");
      return false;
    }
    showError(message + (line ? " (line " + line + (col ? ", column " + col : "") + ")" : ""));
    return false;
  };
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    showError("Promise: " + (r && r.message ? r.message : r));
  });

  var KEY = "aicouncil.v2";
  var TEMPLATES = {
    build: "Build a clean, mobile-first single-file web app that ",
    research: "Research deeply and report findings on ",
    improve: "Improve the AI Council app itself. Redesign for clarity, deeper reasoning, and better UX while keeping all core features.",
    debug: "Debug and fix the following code / behaviour: "
  };
  var ROLE_COLORS = {
    Strategist: "#7c8cff",
    Skeptic: "#f87171",
    Builder: "#4ade80",
    Researcher: "#3dd9c5",
    Creative: "#fbbf24"
  };
  var ROLE_PROMPTS = {
    Strategist: "You are the Tech Lead / Architect. Clarify goals and success criteria. Design architecture for a single-file mobile web app. Sequence highest-risk work first. Produce a concrete shared plan. Be specific.",
    Researcher: "You are the deep research engineer. You MUST use any TEAM TOOLS / WEB RESEARCH block in the prompt. First section MUST be Findings from tools: with 3-8 concrete bullets drawn from the research. Never invent citations. Cover APIs, mobile/Safari constraints, storage, edge cases. Prefer vanilla JS + CSS offline on iPhone Safari.",
    Skeptic: "You are the senior QA / Risk Lead. Surface real failure modes, missing edge cases, mobile/Safari bugs. Challenge vague plans. Demand acceptance criteria. Be constructive but ruthless.",
    Builder: "You are a senior full-stack engineer for single-file mobile web apps. Translate the plan into complete working code - never placeholders. Prefer vanilla JS and CSS variables. Dark theme by default. When delivering, return the FULL HTML document.",
    Creative: "You are the product / UX lead. Improve clarity, flow, visual hierarchy while staying practical for a single-file mobile web app."
  };

  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultState() {
    return {
      id: uid(),
      title: "Untitled",
      created: Date.now(),
      updated: Date.now(),
      problem: "",
      messages: [],
      members: [
        { name: "Ava", role: "Strategist", on: true },
        { name: "Ben", role: "Skeptic", on: true },
        { name: "Cleo", role: "Builder", on: true },
        { name: "Dev", role: "Researcher", on: true },
        { name: "Eli", role: "Creative", on: false }
      ],
      board: { points: [], concerns: [], steps: [] },
      research: "",
      researchItems: [],
      buildHistory: [],
      refs: "",
      docs: [],
      files: [],
      phase: "idle",
      stage: "idle",
      rounds: { research: 0, plan: 0 },
      votes: {},
      researchDone: false,
      researchSummary: "",
      plan: ""
    };
  }

  function defaultSettings() {
    return {
      v: 4,
      engine: "free",
      url: "",
      model: "",
      key: "",
      provider: "openai",
      buildMode: true,
      webResearch: true,
      autopilot: false,
      planRounds: 3,
      buildIters: 4,
      perMember: false,
      autoBuild: false,
      autosave: true,
      showContinue: true,
      speakTeam: false
    };
  }

  var state = defaultState();
  var settings = defaultSettings();
  var busy = false;
  var building = false;
  var stopBuild = false;
  var liveStream = null;
  var pendingImage = null;

  function $(id) { return document.getElementById(id); }

  function sGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function sSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  function loadAll() {
    try {
      var s = JSON.parse(sGet(KEY + ".settings") || "null");
      if (s) {
        settings = Object.assign(defaultSettings(), s);
        if (!s.v) { settings.planRounds = 3; settings.buildIters = 4; settings.v = 3; }
        // Migrate older installs that defaulted to silent local/demo mode.
        // Preserve explicit custom endpoints and configured keys.
        if (!s.v && s.engine === "local" && !String(s.url || "").trim() && !String(s.key || "").trim()) {
          settings.engine = "free";
        }
      }
    } catch (e) {}
    try {
      var p = JSON.parse(sGet(KEY + ".current") || "null");
      if (p && Array.isArray(p.messages)) {
        state = Object.assign(defaultState(), p);
        if (!Array.isArray(state.members)) state.members = defaultState().members;
        if (!state.board || typeof state.board !== "object") state.board = { points: [], concerns: [], steps: [] };
        ["points", "concerns", "steps"].forEach(function (k) { if (!Array.isArray(state.board[k])) state.board[k] = []; });
        if (!Array.isArray(state.buildHistory)) state.buildHistory = [];
        if (!Array.isArray(state.docs)) state.docs = [];
        if (!Array.isArray(state.files)) state.files = [];
        if (!state.rounds || typeof state.rounds !== "object") state.rounds = { research: 0, plan: 0 };
        if (!state.votes || typeof state.votes !== "object") state.votes = {};
        if (!p.stage) state.stage = state.problem ? (state.buildHistory.length ? "done" : "research") : "idle";
        if (state.stage === "building") state.stage = state.buildHistory.length ? "done" : "ready";
      }
    } catch (e) {}
  }

  function slimState(st, keep) {
    var c = JSON.parse(JSON.stringify(st));
    c.buildHistory = (c.buildHistory || []).slice(-(keep || 2));
    var last = -1;
    c.messages.forEach(function (m, i) { if (m.image) last = i; });
    c.messages.forEach(function (m, i) { if (m.image && i !== last) delete m.image; });
    return c;
  }
  function saveCurrent() {
    state.updated = Date.now();
    if (sSet(KEY + ".current", JSON.stringify(state))) return true;
    if (sSet(KEY + ".current", JSON.stringify(slimState(state, 1)))) return true;
    toast("Storage is full. Use Projects → Export to back up.");
    return false;
  }
  function saveSettings() {
    sSet(KEY + ".settings", JSON.stringify(settings));
  }
  function projects() {
    try { return JSON.parse(sGet(KEY + ".projects") || "[]"); } catch (e) { return []; }
  }
  function writeProjects(list) {
    return sSet(KEY + ".projects", JSON.stringify(list.slice(0, 40)));
  }
  function saveProject(manual) {
    if (!state.messages.length && !state.problem) {
      if (manual) toast("Nothing to save yet");
      return;
    }
    saveCurrent();
    var list = projects();
    var i = list.findIndex(function (p) { return p.id === state.id; });
    var copy = slimState(state, 2);
    if (i >= 0) list[i] = copy;
    else list.unshift(copy);
    var ok = writeProjects(list);
    if (manual) toast(ok ? "Project saved" : "Storage full - use Export");
  }
  function autosave() {
    saveCurrent();
    if (settings.autosave) saveProject(false);
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function setStatus(text) {
    var bar = $("statusBar");
    if (!text) { bar.classList.remove("show"); return; }
    $("statusText").textContent = text;
    bar.classList.add("show");
  }

  function openDialog(id) {
    var d = $(id);
    if (d && !d.open) d.showModal();
  }
  function closeDialog(el) {
    var d = typeof el === "string" ? $(el) : el;
    if (d && d.open) d.close();
  }

  function uiConfirm(message, title) {
    return new Promise(function (res) {
      $("tConfirm").textContent = title || "Confirm";
      $("confirmMsg").textContent = message || "";
      function done(v) {
        $("confirmYes").onclick = null;
        $("confirmNo").onclick = null;
        closeDialog("dConfirm");
        res(v);
      }
      $("confirmYes").onclick = function () { done(true); };
      $("confirmNo").onclick = function () { done(false); };
      openDialog("dConfirm");
    });
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scrollBottom() {
    var chat = $("chat");
    requestAnimationFrame(function () { chat.scrollTop = chat.scrollHeight; });
  }

  /* ================= stage bar, controls, rendering ================= */
  function stageIndex() {
    var s = state.stage;
    if (s === "research") return 0;
    if (s === "plan") return 1;
    if (s === "ready" || s === "building") return 2;
    if (s === "done") return 3;
    return -1;
  }

  function updatePhaseChip() {
    var map = { idle: "Idle", research: "1 · Research", plan: "2 · Plan", ready: "3 · Ready to build", building: "3 · Building", done: "Done" };
    $("phaseChip").textContent = map[state.stage] || "Idle";
    var bar = $("stageBar");
    if (!state.problem) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    var idx = stageIndex(), labels = ["Research", "Plan", "Build"], keys = ["research", "plan", "build"];
    for (var i = 0; i < 3; i++) {
      var el = $("st_" + keys[i]);
      el.className = "stage" + (idx > i ? " done" : (idx === i ? " active" : ""));
      el.textContent = (idx > i ? "✓ " : "") + labels[i];
    }
  }

  function syncControls() {
    var has = !!state.problem;
    var canBuild = state.stage === "ready" || state.stage === "done" || state.stage === "building";
    var bb = $("bBuild");
    bb.classList.toggle("hidden", !canBuild);
    bb.textContent = building ? "■ Stop build" : (state.stage === "done" ? "↻ Rebuild" : "🛠 Build & Preview");
    bb.disabled = running && !building;
    $("bStop").classList.toggle("hidden", !(running && !building));
    $("bContinue").classList.toggle("hidden", !(has && (state.stage === "research" || state.stage === "plan") && !running));
    $("bPreview").classList.toggle("hidden", !state.buildHistory.length);
    $("bDownload").classList.toggle("hidden", !state.buildHistory.length);
    $("sendBtn").disabled = false;
    $("sendBtn").setAttribute("aria-busy", busy ? "true" : "false");
  }

  function board() {
    if (!state.board) state.board = { points: [], concerns: [], steps: [] };
    return state.board;
  }

  function updateBoard(m) {
    if (!m.claim || m.who === "You" || m.who === "System") return;
    var b = board();
    var agree = !m.vote || m.vote.agree;
    if (!agree) b.concerns.push({ by: m.who, to: m.to, text: (m.vote && m.vote.note) || m.claim });
    else {
      if (m.to) {
        for (var i = b.points.length - 1; i >= 0; i--) {
          if (b.points[i].by === m.to) { if (b.points[i].support.indexOf(m.who) < 0) b.points[i].support.push(m.who); break; }
        }
      }
      b.points.push({ by: m.who, text: m.claim, support: [] });
    }
    ["points", "concerns", "steps"].forEach(function (k) {
      if (b[k].length > 14) b[k] = b[k].slice(-14);
    });
  }

  function boardSummary() {
    var b = board(), parts = [];
    var agreed = b.points.filter(function (p) { return p.support.length; }).map(function (p) {
      return p.text + " (" + p.by + " + " + p.support.join(", ") + ")";
    });
    if (agreed.length) parts.push("Backed by several members: " + agreed.slice(-4).join("; "));
    if (b.concerns.length) parts.push("Open concerns: " + b.concerns.slice(-3).map(function (c) { return c.by + ": " + c.text; }).join("; "));
    return parts.join("\n");
  }

  function renderMsg(m) {
    var div = document.createElement("div");
    div.className = "msg " + (m.who === "You" ? "you" : m.who === "System" ? "system" : "");
    var color = ROLE_COLORS[m.role] || "#8b92b8";
    var whoHtml = "";
    if (m.who !== "You" && m.who !== "System") {
      whoHtml = '<div class="who"><span class="dot" style="background:' + color + '"></span>' +
        esc(m.who) + " " + esc(m.role || "") +
        (m.to ? ' <span class="to">↪ ' + esc(m.to) + "</span>" : "") +
        (m.via === "offline" ? ' <span class="to">· offline voice</span>' : "") + "</div>";
    }
    var body = esc(m.text);
    if (m.image && m.image.dataUrl) {
      body += '<img src="' + m.image.dataUrl + '" alt="attached" style="max-width:100%;border-radius:8px;margin-top:6px">';
    }
    if (m.kind === "deliverable") {
      div.innerHTML = whoHtml +
        '<div class="deliv"><div class="dh">' + esc(m.title || ("Version " + m.version)) + "</div><div>" + body +
        '</div><div class="actions">' +
        '<button type="button" class="btn primary" data-act="preview">▶ Preview</button>' +
        '<button type="button" class="btn" data-act="dl">Download</button></div></div>';
      div.querySelector('[data-act="preview"]').onclick = function () { previewBuild(m.version); };
      div.querySelector('[data-act="dl"]').onclick = function () { downloadBuild(m.version); };
    } else if (m.kind === "summary") {
      div.innerHTML = '<details class="card" open><summary>' + esc(m.title || "Summary") + "</summary>" +
        '<div class="sumtxt">' + body + "</div></details>";
    } else {
      div.innerHTML = whoHtml + '<div class="bubble">' + body + "</div>";
    }
    return div;
  }

  function render() {
    try {
      var chat = $("chat");
      if (!chat) return;
      var hasMsgs = state.messages && state.messages.length > 0;
      var frag = document.createDocumentFragment();

      if (!hasMsgs) {
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.id = "emptyState";
        empty.innerHTML =
          "<h3>AI Council</h3>" +
          "<p>Your team researches, agrees, plans, agrees again, and only then builds and previews your app.</p>" +
          '<div class="tpl-grid">' +
          '<button type="button" class="tpl-btn" data-tpl="build">Build an app</button>' +
          '<button type="button" class="tpl-btn" data-tpl="research">Research a topic</button>' +
          '<button type="button" class="tpl-btn" data-tpl="improve">Improve this app</button>' +
          '<button type="button" class="tpl-btn" data-tpl="debug">Debug / fix code</button></div>';
        frag.appendChild(empty);
        var btns = empty.querySelectorAll("[data-tpl]");
        for (var i = 0; i < btns.length; i++) {
          (function (btn) {
            btn.onclick = function () {
              var t = TEMPLATES[btn.getAttribute("data-tpl")] || "";
              var inp = $("userInput");
              if (inp) { inp.value = t; inp.focus(); }
            };
          })(btns[i]);
        }
      } else {
        if (state.research && !/^No useful/.test(state.research)) {
          var c = document.createElement("details");
          c.className = "card";
          c.open = true;
          var nItems = (state.researchItems && state.researchItems.length) || state.research.split("\n\n").length;
          var bodyHtml = "";
          if (state.researchItems && state.researchItems.length) {
            bodyHtml = state.researchItems.slice(0, 14).map(function (it) {
              if (typeof it === "string") return "<div style='margin:8px 0;padding-bottom:8px;border-bottom:1px solid #2a3055'>" + esc(it) + "</div>";
              var link = it.url ? ' <a href="' + esc(it.url) + '" target="_blank" rel="noopener" style="color:#3dd9c5;font-size:.8rem">Open source ↗</a>' : "";
              return "<div style='margin:8px 0;padding-bottom:8px;border-bottom:1px solid #2a3055'>" +
                "<div style='font-weight:600;color:#3dd9c5;font-size:.82rem'>" + esc(it.source || "Source") + " · " + esc(it.title || "") + link + "</div>" +
                "<div style='margin-top:3px'>" + esc(it.text || "") + "</div></div>";
            }).join("");
          } else {
            bodyHtml = "<div class='sumtxt'>" + esc(state.research).slice(0, 3500) + "</div>";
          }
          c.innerHTML = "<summary>🔎 Research notes (" + nItems + " sources)</summary>" +
            "<div style='margin-top:8px'>" + bodyHtml + "</div>" +
            "<div class='actions' style='margin-top:10px;display:flex;flex-wrap:wrap;gap:6px'>" +
            '<button type="button" class="btn" data-research-act="refresh">↻ Refresh</button>' +
            '<button type="button" class="btn" data-research-act="custom">+ Custom query</button>' +
            '<button type="button" class="btn" data-research-act="copy">Copy</button>' +
            '<button type="button" class="btn" data-research-act="pin">Pin to Notes</button>' +
            '<button type="button" class="btn" data-research-act="clear">Clear</button></div>';
          frag.appendChild(c);
        }
        for (var j = 0; j < state.messages.length; j++) {
          frag.appendChild(renderMsg(state.messages[j]));
        }
        if (typing) {
          var t = document.createElement("div");
          t.className = "msg";
          t.innerHTML = '<div class="who"><span class="dot" style="background:' + (ROLE_COLORS[typing.role] || "#8b92b8") + '"></span>' +
            esc(typing.name) + " " + esc(typing.role || "") + '</div><div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>';
          frag.appendChild(t);
        }
        if (state.stage === "ready" && !building && !running) {
          var cta = document.createElement("div");
          cta.className = "cta";
          cta.innerHTML = "<div><b>Everyone agrees on the plan.</b><br><small>Next: the Builder writes the app, the sandbox tests it, the Skeptic reviews it, then it opens in Preview.</small></div>" +
            '<button type="button" class="btn primary" id="ctaBuild">🛠 Build &amp; Preview</button>';
          frag.appendChild(cta);
          cta.querySelector("#ctaBuild").onclick = startBuild;
        }
      }

      chat.innerHTML = "";
      chat.appendChild(frag);
      updatePhaseChip();
      syncControls();
      scrollBottom();
    } catch (err) {
      showError("render: " + (err && err.message ? err.message : err));
    }
  }

  /* ================= team engine: helpers and model access ================= */
  var running = false, stopReq = false, typing = null, offlineNoticed = false;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function snip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function activeMembers() { return state.members.filter(function (m) { return m.on; }); }
  function memberByRole(role) {
    return state.members.filter(function (m) { return m.on && m.role === role; })[0] ||
      state.members.filter(function (m) { return m.on; })[0] || state.members[0];
  }
  function setTyping(m) { typing = m ? { name: m.name, role: m.role } : null; render(); }

  function isRemote() {
    return settings.engine === "free" || (settings.engine === "custom" && !!settings.url);
  }

  function friendlyErr(e) {
    var m = (e && e.message) || String(e);
    if (/429|quota|rate.?limit|too many|busy/i.test(m)) return "The AI service is busy or its quota is used up (" + snip(m, 80) + ").";
    if (/401|403|unauthor|api key|permission/i.test(m)) return "The API key was rejected (" + snip(m, 80) + ").";
    if (/unavailable for free|paid version/i.test(m)) return "That model is no longer free (" + snip(m, 60) + "). Tap Load available models, or use openrouter/free.";
    if (/404|not found/i.test(m)) return "The endpoint or model wasn't found (" + snip(m, 80) + ").";
    return snip(m, 150);
  }

  /* ---- free AI (Pollinations, no key). POST first, tiny GET as a fallback. ---- */
  var freeChain = Promise.resolve(), freeLast = 0, freeDownUntil = 0;
  function cleanFree(t) {
    t = String(t || "").trim();
    if (t.length < 2) throw new Error("The free AI service returned an empty reply");
    return t;
  }
  function callFree(system, user, o) {
    if (Date.now() < freeDownUntil) return Promise.reject(new Error("The free AI service is busy (cooling down for a moment)"));
    var p = freeChain.then(function () {
      return sleep(Math.max(0, freeLast + (o.gap || 2500) - Date.now()));
    }).then(function () {
      freeLast = Date.now();
      return freeRequest(system, user, o, 0);
    }).catch(function (e) {
      freeDownUntil = Date.now() + 90000;
      throw e;
    });
    freeChain = p.catch(function () {});
    return p;
  }
  function freeRequest(system, user, o, attempt) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, o.ms || 75000);
    return fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctl.signal,
      body: JSON.stringify({
        model: "openai",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.7,
        private: true
      })
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) {
        if (attempt < 2) {
          var w = (attempt + 1) * 6;
          setStatus("The free AI is busy. Retrying in " + w + "s…");
          return sleep(w * 1000).then(function () { return freeRequest(system, user, o, attempt + 1); });
        }
        throw new Error("The free AI service is busy (HTTP " + r.status + ")");
      }
      if (!r.ok) return r.text().then(function (x) { throw new Error("Free AI error HTTP " + r.status + " " + snip(x, 100)); });
      return r.json().then(function (j) {
        var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!txt && j && j.error) throw new Error("Free AI: " + snip(JSON.stringify(j.error), 120));
        return cleanFree(txt);
      });
    }, function (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error("The free AI service timed out");
      if (attempt === 0) return freeGet(system, user);
      throw new Error("Could not reach the free AI service (" + ((e && e.message) || e) + ")");
    });
  }
  function freeGet(system, user) {
    var prompt = system + "\n\n" + user;
    if (prompt.length > 1700) prompt = prompt.slice(0, 500) + "\n…\n" + prompt.slice(prompt.length - 1200);
    return fetch("https://text.pollinations.ai/" + encodeURIComponent(prompt) + "?model=openai&private=true")
      .then(function (r) {
        if (!r.ok) throw new Error("Free AI error HTTP " + r.status);
        return r.text();
      }).then(cleanFree).catch(function (e) {
        throw new Error("Could not reach the free AI service (" + ((e && e.message) || e) + ")");
      });
  }

  /* ---- custom endpoint (OpenAI-compatible or Anthropic) ---- */
  function callCustom(system, user, o) {
    if (!settings.url) return Promise.reject(new Error("No API endpoint configured. Open Settings and choose Custom API endpoint."));
    if (!settings.model) return Promise.reject(new Error("No model configured. Choose a provider preset or enter a model name."));
    if (!settings.key && settings.provider !== "local") return Promise.reject(new Error("No API key configured. Enter your provider key in Settings."));
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, o.ms || 90000);
    var headers = { "Content-Type": "application/json" };
    var provider = settings.provider || "openai", body;
    if (provider === "anthropic") {
      headers["x-api-key"] = settings.key;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      body = { model: settings.model, max_tokens: o.max || 4096, system: system, messages: [{ role: "user", content: user }] };
    } else {
      if (settings.key) headers["Authorization"] = "Bearer " + settings.key;
      var uContent = user;
      if (o.image && o.image.dataUrl) {
        uContent = [{ type: "text", text: String(user) }, { type: "image_url", image_url: { url: o.image.dataUrl } }];
      }
      body = { model: settings.model, messages: [{ role: "system", content: system }, { role: "user", content: uContent }], temperature: 0.55, max_tokens: o.max || 4096 };
    }
    return fetch(settings.url, { method: "POST", headers: headers, signal: ctl.signal, body: JSON.stringify(body) })
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error("HTTP " + r.status + " " + String(t).replace(/\s+/g, " ").slice(0, 180));
          });
        }
        return r.json();
      }).then(function (j) {
        var text = provider === "anthropic"
          ? (j.content || []).map(function (c) { return c.text || ""; }).join("")
          : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
        if (!text) throw new Error("Empty reply from model");
        return String(text).trim();
      }).catch(function (e) {
        clearTimeout(to);
        if (e && e.name === "AbortError") throw new Error("Timed out waiting for the model");
        if (e && e instanceof TypeError) throw new Error("Network/CORS error. Check the endpoint, your internet, and whether the provider allows browser requests.");
        throw e;
      });
  }

  function callModel(system, user, o) {
    o = o || {};
    if (settings.engine === "free") return callFree(system, user, o);
    return callCustom(system, user, o).catch(function (e) {
      var m = (e && e.message) || "";
      if (/openrouter\.ai/.test(settings.url || "") && settings.model !== "openrouter/free" &&
          /404|unavailable for free|No endpoints|not a valid model|paid version/i.test(m)) {
        settings.model = "openrouter/free";
        saveSettings();
        toast("That model isn't free any more. Switched to openrouter/free.");
        return callCustom(system, user, o);
      }
      throw e;
    });
  }

  /* Ask the model; on any failure return {text:null} so the team keeps talking with built-in voices. */
  function askModel(system, user, o) {
    if (!isRemote()) return Promise.resolve({ text: null, via: "offline" });
    return callModel(system, user, o).then(function (t) { return { text: t, via: "model" }; }, function (e) {
      if (!offlineNoticed) {
        offlineNoticed = true;
        add("System", "⚠ " + friendlyErr(e) + " The team keeps working with its built-in voices (marked “offline voice”). Open Settings → Test to check your AI connection.");
        render();
      }
      return { text: null, via: "offline", error: e };
    });
  }

  /* ---- research (Wikipedia + DuckDuckGo + news-oriented queries, with source links) ---- */
  function timedFetch(url, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 9000);
    return fetch(url, { signal: ctl.signal }).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  function searchWiki(q) {
    return timedFetch("https://en.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(q) + "&limit=5&namespace=0&format=json&origin=*")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j[1] || !j[1].length) return [];
        return Promise.all(j[1].slice(0, 4).map(function (t, idx) {
          var pageUrl = (j[3] && j[3][idx]) || ("https://en.wikipedia.org/wiki/" + encodeURIComponent(t.replace(/ /g, "_")));
          return timedFetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t))
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (p) {
              if (!p || !p.extract) return null;
              var url = (p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page) || pageUrl;
              return { source: "Wikipedia", title: p.title || t, text: String(p.extract).slice(0, 480), url: url };
            });
        })).then(function (pages) { return pages.filter(Boolean); });
      }).catch(function () { return []; });
  }
  function searchDdg(q) {
    return timedFetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_redirect=1&no_html=1&skip_disambig=1")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return [];
        var bits = [];
        if (j.AbstractText) {
          bits.push({ source: "DuckDuckGo", title: j.Heading || "Summary", text: String(j.AbstractText).slice(0, 480), url: j.AbstractURL || ("https://duckduckgo.com/?q=" + encodeURIComponent(q)) });
        }
        if (j.Answer) {
          bits.push({ source: "DuckDuckGo Answer", title: "Direct answer", text: String(j.Answer).slice(0, 280), url: j.AbstractURL || ("https://duckduckgo.com/?q=" + encodeURIComponent(q)) });
        }
        (j.RelatedTopics || []).slice(0, 5).forEach(function (t) {
          if (t.Text) {
            bits.push({ source: "Related", title: (t.FirstURL || "").replace(/^https?:\/\/[^/]+\//, "").slice(0, 40) || "Topic", text: String(t.Text).slice(0, 220), url: t.FirstURL || ("https://duckduckgo.com/?q=" + encodeURIComponent(q)) });
          }
        });
        return bits;
      }).catch(function () { return []; });
  }
  function formatResearchItem(item) {
    if (typeof item === "string") return item;
    var line = (item.source || "Source") + " — " + (item.title || "") + ": " + (item.text || "");
    if (item.url) line += "\n🔗 " + item.url;
    return line;
  }
  function doResearch(topic, extraQueries) {
    var base = String(topic || "").trim() || "web app";
    var queries = [base, base + " best practices", base + " mobile web OR Safari OR iPhone", "latest OR news OR current " + base];
    if (Array.isArray(extraQueries)) {
      extraQueries.forEach(function (q) { if (q && String(q).trim()) queries.push(String(q).trim()); });
    } else if (extraQueries && String(extraQueries).trim()) {
      queries.push(String(extraQueries).trim());
    }
    var seenQ = {};
    queries = queries.filter(function (q) {
      var k = q.toLowerCase().slice(0, 60);
      if (seenQ[k]) return false;
      seenQ[k] = true;
      return true;
    }).slice(0, 6);
    var chain = Promise.resolve([]);
    queries.forEach(function (q) {
      chain = chain.then(function (acc) {
        return Promise.all([searchWiki(q), searchDdg(q)]).then(function (pair) {
          return acc.concat(pair[0] || []).concat(pair[1] || []);
        });
      });
    });
    return chain.then(function (results) {
      var seen = {}, unique = [];
      results.forEach(function (r) {
        var key = (typeof r === "string" ? r : (r.title || "") + (r.text || "")).slice(0, 90);
        if (!seen[key]) { seen[key] = true; unique.push(r); }
      });
      var formatted = unique.slice(0, 16).map(formatResearchItem);
      state.research = formatted.join("\n\n") || "No useful public research results returned.";
      state.researchItems = unique.slice(0, 16);
      return state.research;
    });
  }

  function add(who, text, extra) {
    var m = Object.assign({ who: who, text: text, ts: Date.now() }, extra || {});
    state.messages.push(m);
    updateBoard(m);
    autosave();
    return m;
  }

  /* ================= offline team voices (no AI model needed) ================= */
  var STOPW = /\b(a|an|the|and|or|to|of|for|in|on|with|that|this|my|me|i|we|you|it|is|are|be|can|will|build|make|create|app|application|web|simple|small|please|want|need|new|clean|mobile|first|single|file|html|which|so|how|what|who|about|using|use|like|just|some|any|called|named)\b/g;
  function topicWords() {
    var w = String(state.problem || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(STOPW, " ").split(/\s+/).filter(function (x) { return x.length > 2; });
    var out = [];
    w.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out.slice(0, 3);
  }
  function topic() { return topicWords().join(" ") || "this app"; }
  function appTitle() {
    var w = topicWords();
    if (!w.length) return "My App";
    return w.slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }).join(" ").slice(0, 36);
  }
  function pickTemplate() {
    var p = String(state.problem || "").toLowerCase();
    if (/timer|stopwatch|pomodoro|countdown|clock/.test(p)) return "timer";
    if (/\btip\b|split|\bbill\b/.test(p)) return "tip";
    if (/note|journal|diary|memo|jot/.test(p)) return "notes";
    if (/budget|expense|spend|habit|track|\blog\b|workout|water|mood|money|financ/.test(p)) return "tracker";
    if (/\b(to-?do|task|checklist|list|reminder|shopping|chores?)\b/.test(p)) return "tasks";
    return null;
  }
  function tplFeatures() { var t = pickTemplate(); return t ? TPL_FEATURES[t] : ["the features you described"]; }

  /* ---- improving an existing app: inspect the real code instead of inventing a new one ---- */
  function improveFiles() {
    var out = [];
    (state.files || []).forEach(function (f) { if (/\.(html?|js)$/i.test(f.name)) out.push({ name: f.name, code: f.text || "" }); });
    if (!out.length && state.buildHistory.length) out.push({ name: "current build", code: state.buildHistory[state.buildHistory.length - 1].code });
    return out;
  }
  function isImprove() {
    var p = state.problem || "";
    if ((state.files || []).some(function (x) { return /\.html?$/i.test(x.name); })) return true;
    return /\b(improve|fix|debug|harden|upgrade|refactor|redesign|audit)\b/i.test(p) && /\b(app|code|page|site|this|itself|uploaded|file)\b/i.test(p);
  }
  function inspectCode(name, c, anyStorage) {
    var out = [], isHtml = /\.html?$/i.test(name) || (!/\.\w+$/.test(name) && /<html|<!doctype/i.test(c));
    if (isHtml && !/<meta[^>]+viewport/i.test(c)) out.push("No viewport meta tag, so the page will not scale properly on iPhone.");
    var nat = (c.match(/(^|[^\w.$])(alert|prompt|confirm)\s*\(/g) || []).length;
    if (nat) out.push(nat + " use(s) of alert/prompt/confirm. Replace them with in-page dialogs.");
    if (isHtml && /\bsrc\s*=\s*["']https?:/i.test(c)) out.push("Loads external scripts or images, so it will not work offline.");
    if (!anyStorage) out.push("Nothing is saved on the device (no localStorage).");
    var todo = (c.match(/(?:\/\/|\/\*)\s*(?:TODO|FIXME)\b/g) || []).length;
    if (todo) out.push(todo + " TODO/FIXME comment(s) left in the code.");
    if (isHtml && !/aria-label|<label/i.test(c)) out.push("No labels or aria-labels, so screen readers cannot describe the controls.");
    if (c.length > 80000) out.push("Very large file (" + (c.length / 1024).toFixed(0) + " KB). Consider splitting it into modules.");
    if (isHtml) staticCheck(c).forEach(function (x) { out.push(x); });
    else { try { new Function(c); } catch (e) { out.push("JavaScript syntax error: " + e.message); } }
    return out;
  }
  function inspectReport() {
    var fs = improveFiles();
    if (!fs.length) return "";
    var anyStorage = fs.some(function (f) { return /localStorage/.test(f.code); });
    return fs.slice(0, 4).map(function (f) {
      var r = inspectCode(f.name, f.code, anyStorage);
      return f.name + " (" + (f.code.length / 1024).toFixed(1) + " KB): " + (r.length ? "\n- " + r.join("\n- ") : "no obvious problems found by the automatic checks.");
    }).join("\n");
  }
  function loadSelfSource() {
    var names = ["index.html", "app.js"];
    return Promise.all(names.map(function (n) {
      return timedFetch(n + "?t=" + Date.now(), 10000).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    })).then(function (texts) {
      var n = 0;
      texts.forEach(function (t, i) { if (t) { state.files.push({ name: names[i], text: t, ts: Date.now() }); n++; } });
      add("System", n ? "📂 Loaded this app's own files (" + names.filter(function (x, i) { return texts[i]; }).join(", ") + ") so the team can inspect the real code."
                      : "I could not read this app's own files from here. Tap Upload and choose index.html and app.js.");
      render();
    });
  }
  var TPL_FEATURES = {
    tasks: ["Add an item with the keyboard or the Add button", "Tick items off and see how many are done", "Delete an item or clear everything that is done", "Everything is saved on the device and survives a reload"],
    tracker: ["Add an entry with a label and an amount", "See the total, the count and the average", "Delete a wrong entry", "Everything is saved on the device and survives a reload"],
    timer: ["Start, pause and reset a stopwatch", "Optional countdown in minutes with a time-is-up message", "Record laps and see them listed", "Large, readable numbers that work one-handed"],
    tip: ["Enter the bill amount", "Pick a tip percentage with quick buttons", "Split between any number of people", "Show tip, total and amount per person; remember the last inputs"],
    notes: ["Write a note and save it", "See all notes, newest first", "Delete a note", "Everything is saved on the device and survives a reload"]
  };

  var LOCAL_CLAIMS = {
    research: {
      Strategist: ["pin down who {t} is for and what done looks like in one sentence", "list the three things {t} must do on day one and cut the rest", "keep the scope to one screen and one main action"],
      Skeptic: ["test the assumption that people need every feature of {t}; one core job is enough", "ask what happens with empty data, no internet, or a cleared browser", "confirm this really fits in one HTML file on iPhone Safari"],
      Builder: ["estimate what is realistic as one HTML file: plain JavaScript, CSS variables and localStorage", "plan a tiny first version that already runs and can grow", "note that storage and camera need https and permission"],
      Researcher: ["compare how existing {t} apps work and which features people rely on", "check Safari limits for storage, offline use and viewport height", "separate known facts from guesses before we design anything"],
      Creative: ["make the first screen obvious with one big action", "use clear empty-state text and friendly wording", "keep the look calm, dark and thumb-friendly"]
    },
    plan: {
      Strategist: ["set the feature list for {t}: {features}", "order the work: data and storage first, then the main screen, then polish", "define the screens: the main view and a friendly empty state"],
      Skeptic: ["write the acceptance test: it must survive a reload and never show a blank screen", "cover edge cases: empty input, duplicates, very long text and rapid taps", "define done: every listed feature works through a visible control"],
      Builder: ["structure it as header, main list and add form with state in one object saved to localStorage", "build in this order: data model, render function, event handlers, then styling", "stay with vanilla JavaScript and no libraries so it works offline"],
      Researcher: ["use only well-supported APIs: localStorage, flexbox and input events", "avoid anything that needs a server or special permissions", "keep text at 16px so iPhone does not zoom on inputs"],
      Creative: ["give the empty state a helpful hint and one big primary button", "use 44px tap targets and clear colors for done versus pending", "show small feedback after every action"]
    }
  };
  var AGREE_FROM = {
    research: { Strategist: 2, Skeptic: 2, Builder: 2, Researcher: 1, Creative: 1 },
    plan: { Strategist: 2, Skeptic: 3, Builder: 3, Researcher: 2, Creative: 2 }
  };

  function localSpeech(m, stage, round) {
    var cm = state.messages.filter(function (x) { return x.who !== "You" && x.who !== "System"; });
    var mine = cm.filter(function (x) { return x.who === m.name && x.stage === stage; }).length;
    var set = LOCAL_CLAIMS[stage] || LOCAL_CLAIMS.research;
    var pool = set[m.role] || set.Strategist;
    var claim = pool[mine % pool.length].replace(/\{t\}/g, topic()).replace(/\{features\}/g, tplFeatures().slice(0, 3).join("; ").toLowerCase());
    var target = null;
    for (var i = cm.length - 1; i >= 0 && !target; i--) {
      if (cm[i].who !== m.name && cm[i].stage === stage) target = cm[i];
    }
    var last = state.messages[state.messages.length - 1];
    var pre = (last && last.who === "You" && state.messages.length > 1) ? 'On your note "' + snip(last.text, 60) + '": ' : "";
    var from = (AGREE_FROM[stage] && AGREE_FROM[stage][m.role]) || 2;
    var agree = round >= from;
    var n = target ? target.who : "", c = target ? snip(target.claim || target.text, 60) : "";
    var role = m.role, text;
    if (!target) {
      var open = {
        Strategist: "Let's get started" + (stage === "plan" ? " on the plan, using what we agreed in research" : "") + ". I think we should " + claim + ".",
        Skeptic: "Before we move fast, I'd " + claim + ".",
        Builder: "From a build point of view, " + claim + ".",
        Researcher: "To ground this, let's " + claim + ".",
        Creative: "Here's a friendlier angle: " + claim + "."
      };
      text = pre + (open[role] || open.Strategist);
    } else if (role === "Skeptic") {
      text = agree
        ? pre + n + ", that answers my worry about \"" + c + "\". My one condition: " + claim + ". I'm on board."
        : pre + n + ", I like \"" + c + "\" but I'm not convinced yet. First we should " + claim + ".";
    } else if (role === "Builder") {
      text = pre + (agree ? n + ", \"" + c + "\" works for me. I'd " + claim + ", and then I'm ready to build." : "Practically, " + n + ", to make \"" + c + "\" real we should " + claim + ".");
    } else if (role === "Researcher") {
      text = pre + (agree ? "That matches what I found, " + n + ". We should still " + claim + ", then I'm happy." : "Adding evidence to " + n + "'s point on \"" + c + "\": we should " + claim + ".");
    } else if (role === "Creative") {
      text = pre + (agree ? "Love it, " + n + ". Let's " + claim + " and keep it simple." : n + ", riffing on \"" + c + "\": let's " + claim + ".");
    } else {
      text = pre + (agree ? n + "'s point on \"" + c + "\" fits. I'd also " + claim + ", and then I'm ready to sign off." : n + ", I like where \"" + c + "\" is going. Building on it, I'd " + claim + ".");
    }
    if (!agree && (role === "Skeptic" || role === "Builder")) text += " One more round on this, please.";
    var sp = mkSpeech(m, text, { agree: agree, note: agree ? "" : "needs: " + snip(claim, 60) }, "offline", round);
    sp.claim = snip(claim, 120);
    return sp;
  }

  function offlineSummary(stage) {
    var b = board();
    if (stage === "research") {
      var pts = b.points.slice(-5).map(function (p) { return "• " + p.text + " (" + p.by + ")"; });
      return "What we learned about " + topic() + ":\n" + (pts.join("\n") || "• Keep the scope small") +
        "\nConstraints: one HTML file, iPhone Safari, data saved on the device with localStorage, no server.\nDecision: build a small, focused first version.";
    }
    if (isImprove()) {
      var rep = inspectReport();
      return "Goal: improve the existing app.\n" +
        (rep ? "Findings from automatic inspection:\n" + rep + "\n" : "No code has been loaded yet. Tap Upload and choose the app's files so the team can inspect the real code.\n") +
        "Plan: fix the findings in order, keep every existing feature working, and re-test after each change.\n" +
        "Note: the built-in team can inspect code but cannot rewrite it. Choose Free AI or add your key in Settings to apply the changes.";
    }
    if (!pickTemplate()) {
      return "Goal: " + snip(state.problem, 120) + "\nThe built-in team only knows five starter apps (task list, tracker, timer, tip calculator, notes), and this idea is not one of them.\n" +
        "To get a real plan and build for it, choose Free AI or add your key in Settings, then tap Continue.";
    }
    var f = TPL_FEATURES[pickTemplate()];
    return "App name: " + appTitle() + "\nFeatures:\n" + f.map(function (x, i) { return (i + 1) + ". " + x; }).join("\n") +
      "\nScreens: one main screen with a clear primary action, plus a friendly empty state.\nData: stored in localStorage on this device.\n" +
      "Acceptance: every feature above works through a visible control; the app survives a reload; no blank screen on first open.";
  }

  /* ================= offline starter apps (used when no AI model is reachable) ================= */
  var TPL_HEAD = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>__TITLE__</title><style>' +
    ':root{--bg:#0b0d17;--panel:#161a32;--line:#2a3055;--tx:#eef0ff;--mut:#8b92b8;--ac:#7c8cff;--ok:#4ade80}*{box-sizing:border-box}' +
    'body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 -apple-system,system-ui,sans-serif;padding:max(18px,env(safe-area-inset-top)) 16px 40px;max-width:560px;margin:0 auto}' +
    'h1{font-size:1.45rem;margin:0 0 2px}.sub{color:var(--mut);margin:0 0 14px;font-size:.9rem}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}' +
    'input,select,textarea,button{font:inherit;color:inherit}input,select,textarea{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px}' +
    'button{background:var(--ac);border:0;border-radius:10px;padding:11px 16px;min-height:44px;font-weight:600;color:#fff;cursor:pointer}button.ghost{background:transparent;border:1px solid var(--line)}' +
    '.row{display:flex;gap:8px}.row>*{flex:1}.row>button{flex:0 0 auto}.big{font-size:2.6rem;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}' +
    'ul{list-style:none;margin:0;padding:0}li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}li:last-child{border:0}' +
    'li.done span{text-decoration:line-through;color:var(--mut)}.x{margin-left:auto;background:transparent;color:var(--mut);padding:4px 10px;min-height:36px}' +
    '.empty{color:var(--mut);text-align:center;padding:14px}.stat{display:flex;justify-content:space-between;padding:6px 0}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}' +
    '.chips button{background:var(--bg);border:1px solid var(--line)}.chips button.on{background:var(--ac)}</style></head><body>';
  var TPL_JS_STORE = 'var K="council:__KEY__";function load(d){try{var v=JSON.parse(localStorage.getItem(K));return v==null?d:v}catch(e){return d}}function save(v){try{localStorage.setItem(K,JSON.stringify(v))}catch(e){}}function $(i){return document.getElementById(i)}';
  var TPL_BODY = {
    tasks: '<h1>__TITLE__</h1><p class="sub" id="sub"></p><div class="card"><div class="row"><input id="t" placeholder="Add an item…" enterkeyhint="done"><button id="add">Add</button></div></div>' +
      '<div class="card"><ul id="l"></ul><div class="empty" id="e">Nothing here yet. Add your first item above.</div></div><button class="ghost" id="clr" style="width:100%">Clear completed</button>' +
      '<script>' + TPL_JS_STORE + 'var items=load([]);function paint(){var l=$("l");l.innerHTML="";items.forEach(function(it,i){var li=document.createElement("li");if(it.d)li.className="done";' +
      'var c=document.createElement("input");c.type="checkbox";c.style.width="22px";c.checked=!!it.d;c.onchange=function(){it.d=c.checked;save(items);paint()};var s=document.createElement("span");s.textContent=it.t;' +
      'var x=document.createElement("button");x.className="x";x.textContent="✕";x.setAttribute("aria-label","Delete");x.onclick=function(){items.splice(i,1);save(items);paint()};li.appendChild(c);li.appendChild(s);li.appendChild(x);l.appendChild(li)});' +
      '$("e").style.display=items.length?"none":"block";var d=items.filter(function(i){return i.d}).length;$("sub").textContent=items.length?d+" of "+items.length+" done":"Your list is empty"}' +
      'function add(){var v=$("t").value.trim();if(!v)return;items.push({t:v,d:false});$("t").value="";save(items);paint()}$("add").onclick=add;$("t").addEventListener("keydown",function(e){if(e.key==="Enter")add()});' +
      '$("clr").onclick=function(){items=items.filter(function(i){return !i.d});save(items);paint()};paint();<\/script>',
    tracker: '<h1>__TITLE__</h1><p class="sub">Add entries and watch the totals.</p><div class="card"><div class="row"><input id="n" placeholder="Label"><input id="a" type="number" inputmode="decimal" placeholder="Amount"></div>' +
      '<button id="add" style="width:100%;margin-top:8px">Add entry</button></div><div class="card"><div class="stat"><span>Total</span><b id="tot">0</b></div><div class="stat"><span>Entries</span><b id="cnt">0</b></div><div class="stat"><span>Average</span><b id="avg">0</b></div></div>' +
      '<div class="card"><ul id="l"></ul><div class="empty" id="e">No entries yet. Add your first one above.</div></div>' +
      '<script>' + TPL_JS_STORE + 'var items=load([]);function paint(){var l=$("l");l.innerHTML="";var t=0;items.forEach(function(it,i){t+=it.a;var li=document.createElement("li");var s=document.createElement("span");s.textContent=it.n+" — "+it.a.toFixed(2);' +
      'var x=document.createElement("button");x.className="x";x.textContent="✕";x.setAttribute("aria-label","Delete");x.onclick=function(){items.splice(i,1);save(items);paint()};li.appendChild(s);li.appendChild(x);l.appendChild(li)});' +
      '$("e").style.display=items.length?"none":"block";$("tot").textContent=t.toFixed(2);$("cnt").textContent=items.length;$("avg").textContent=items.length?(t/items.length).toFixed(2):"0"}' +
      '$("add").onclick=function(){var n=$("n").value.trim(),a=parseFloat($("a").value);if(!n||isNaN(a))return;items.push({n:n,a:a});$("n").value="";$("a").value="";save(items);paint()};paint();<\/script>',
    timer: '<h1>__TITLE__</h1><p class="sub" id="msg">Stopwatch, or set minutes for a countdown.</p><div class="card"><div class="big" id="d">00:00.0</div></div>' +
      '<div class="card"><input id="m" type="number" inputmode="numeric" placeholder="Countdown minutes (optional)"><div class="row" style="margin-top:8px"><button id="go">Start</button><button class="ghost" id="lap">Lap</button><button class="ghost" id="rs">Reset</button></div></div>' +
      '<div class="card"><ul id="l"></ul><div class="empty" id="e">No laps yet.</div></div>' +
      '<script>function $(i){return document.getElementById(i)}var t=0,run=false,last=0,iv=null,target=0,laps=[];function fmt(ms){var s=Math.floor(ms/1000),m=Math.floor(s/60),x=Math.floor((ms%1000)/100);return (m<10?"0":"")+m+":"+((s%60)<10?"0":"")+(s%60)+"."+x}' +
      'function paint(){var v=target?Math.max(0,target-t):t;$("d").textContent=fmt(v);if(target&&t>=target){stop();$("msg").textContent="Time is up!"}}function tick(){var n=Date.now();t+=n-last;last=n;paint()}' +
      'function stop(){run=false;clearInterval(iv);$("go").textContent="Start"}$("go").onclick=function(){if(run){stop();return}var m=parseFloat($("m").value);target=m>0?m*60000:0;if(target&&t>=target)t=0;last=Date.now();run=true;iv=setInterval(tick,100);$("go").textContent="Pause";$("msg").textContent=target?"Counting down…":"Running…"};' +
      '$("rs").onclick=function(){stop();t=0;laps=[];target=0;$("msg").textContent="Stopwatch, or set minutes for a countdown.";paint();lp()};$("lap").onclick=function(){if(!run&&t===0)return;laps.unshift(fmt(t));lp()};' +
      'function lp(){var l=$("l");l.innerHTML="";laps.forEach(function(x,i){var li=document.createElement("li");li.textContent="Lap "+(laps.length-i)+" — "+x;l.appendChild(li)});$("e").style.display=laps.length?"none":"block"}paint();lp();<\/script>',
    tip: '<h1>__TITLE__</h1><p class="sub">Tip and split the bill.</p><div class="card"><label>Bill amount</label><input id="b" type="number" inputmode="decimal" placeholder="0.00"><label style="display:block;margin-top:10px">Tip</label>' +
      '<div class="chips" id="chips"></div><label style="display:block;margin-top:6px">People</label><input id="p" type="number" inputmode="numeric" value="1" min="1"></div>' +
      '<div class="card"><div class="stat"><span>Tip</span><b id="tip">0.00</b></div><div class="stat"><span>Total</span><b id="tot">0.00</b></div><div class="stat"><span>Per person</span><b id="per">0.00</b></div></div>' +
      '<script>' + TPL_JS_STORE + 'var S=load({b:"",p:1,t:15});var tips=[10,15,18,20,25];function paint(){var b=parseFloat($("b").value)||0,p=Math.max(1,parseInt($("p").value,10)||1),tip=b*S.t/100;$("tip").textContent=tip.toFixed(2);$("tot").textContent=(b+tip).toFixed(2);$("per").textContent=((b+tip)/p).toFixed(2);' +
      'var c=$("chips");c.innerHTML="";tips.forEach(function(v){var x=document.createElement("button");x.textContent=v+"%";if(v===S.t)x.className="on";x.onclick=function(){S.t=v;S.b=$("b").value;S.p=$("p").value;save(S);paint()};c.appendChild(x)})}' +
      '$("b").value=S.b;$("p").value=S.p;["b","p"].forEach(function(i){$(i).addEventListener("input",function(){S.b=$("b").value;S.p=$("p").value;save(S);paint()})});paint();<\/script>',
    notes: '<h1>__TITLE__</h1><p class="sub" id="sub"></p><div class="card"><textarea id="t" rows="4" placeholder="Write a note…"></textarea><button id="add" style="width:100%;margin-top:8px">Save note</button></div>' +
      '<div class="card"><ul id="l"></ul><div class="empty" id="e">No notes yet. Write your first one above.</div></div>' +
      '<script>' + TPL_JS_STORE + 'var items=load([]);function paint(){var l=$("l");l.innerHTML="";items.forEach(function(it,i){var li=document.createElement("li");li.style.alignItems="flex-start";var s=document.createElement("span");s.style.whiteSpace="pre-wrap";s.textContent=it.t;' +
      'var x=document.createElement("button");x.className="x";x.textContent="✕";x.setAttribute("aria-label","Delete");x.onclick=function(){items.splice(i,1);save(items);paint()};li.appendChild(s);li.appendChild(x);l.appendChild(li)});' +
      '$("e").style.display=items.length?"none":"block";$("sub").textContent=items.length+" saved"}$("add").onclick=function(){var v=$("t").value.trim();if(!v)return;items.unshift({t:v,ts:Date.now()});$("t").value="";save(items);paint()};paint();<\/script>'
  };
  function offlineApp() {
    var tpl = pickTemplate(), title = appTitle();
    var key = (tpl + ":" + title).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return (TPL_HEAD + TPL_BODY[tpl] + "</body></html>").replace(/__TITLE__/g, esc(title)).replace(/__KEY__/g, key);
  }

  /* ================= the staged team: research -> agree -> plan -> agree -> build ================= */
  function inferVote(text, round) {
    if (/\b(not yet|i object|still missing|disagree|blocker|not convinced|not ready)\b/i.test(text)) return { agree: false, note: "" };
    return { agree: round >= 2, note: "" };
  }
  function mkSpeech(m, text, vote, via, round) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    var to = null;
    state.members.forEach(function (x) {
      if (!to && x.name !== m.name && new RegExp("\\b" + escRe(x.name) + "\\b", "i").test(text)) to = x.name;
    });
    var first = (text.match(/^[\s\S]*?[.!?](\s|$)/) || [text])[0];
    return { member: m, text: text, claim: snip(first, 120), to: to, vote: vote || inferVote(text, round), via: via, round: round };
  }
  function splitVote(t) {
    var m = String(t).match(/\n?\s*[*_>\-]*\s*VOTE\s*[:：]\s*(AGREE|NOT YET)\b[\s:\-–]*([^\n]*)\s*$/i);
    if (!m) return { text: String(t), vote: null };
    return { text: String(t).slice(0, m.index).trim(), vote: { agree: /^agree/i.test(m[1]), note: snip(m[2], 140) } };
  }

  var STAGE_BRIEF = {
    research: "STAGE 1 - RESEARCH. Goal: agree on what the app must do, who it is for, what similar apps do, and the limits of a single-file iPhone Safari web app. No code. Use the WEB RESEARCH notes when present.",
    plan: "STAGE 2 - PLAN. Goal: agree on the exact feature list, screens and UI states, data and storage, build order, and acceptance criteria. No full code."
  };

  /* digest of uploaded / current code so the team discusses the REAL file */
  function digestFile(name, c) {
    var o = [];
    o.push("### " + name + " - " + (c.length / 1024).toFixed(1) + " KB, " + c.split("\n").length + " lines");
    var t = c.match(/<title>([^<]*)<\/title>/i); if (t) o.push("Title: " + t[1].trim());
    var btn = [];
    c.replace(/<button\b[^>]*>([\s\S]*?)<\/button>/gi, function (m, x) { x = x.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); if (x && btn.length < 30 && btn.indexOf(x) < 0) btn.push(x); return m; });
    if (btn.length) o.push("Buttons: " + btn.join(", "));
    var fns = [];
    c.replace(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g, function (m, n) { if (fns.length < 60 && fns.indexOf(n) < 0) fns.push(n); return m; });
    if (fns.length) o.push("Functions: " + fns.join(", "));
    var ids = [];
    c.replace(/\bid="([^"]+)"/g, function (m, n) { if (ids.length < 40 && ids.indexOf(n) < 0) ids.push(n); return m; });
    if (ids.length) o.push("Element ids: " + ids.join(", "));
    o.push("Opening lines:\n" + c.slice(0, 400).replace(/\n{2,}/g, "\n"));
    return o.join("\n");
  }
  function codeDigest() {
    var items = [];
    (state.files || []).forEach(function (f) { if (/\.(html?|js|css)$/i.test(f.name)) items.push({ name: f.name, c: f.text || "" }); });
    if (!items.length && state.buildHistory.length) items.push({ name: "current build", c: state.buildHistory[state.buildHistory.length - 1].code });
    if (!items.length) return "";
    return "ACTUAL CODE UNDER DISCUSSION (structural digest of the real file; discuss THIS app):\n" + items.slice(0, 3).map(function (i) { return digestFile(i.name, i.c); }).join("\n\n");
  }

  function transcriptText(n) {
    return state.messages.slice(-(n || 14)).map(function (m) {
      var who = m.who === "You" ? "USER" : (m.who === "System" ? "NOTE" : m.who + (m.role ? " (" + m.role + ")" : ""));
      return who + ": " + snip(m.text, 420);
    }).join("\n");
  }
  function pendingObjections(stage) {
    var out = [];
    Object.keys(state.votes || {}).forEach(function (k) {
      var v = state.votes[k];
      if (v.stage === stage && !v.agree) out.push(k + ": " + (v.note || "not convinced yet"));
    });
    return out.join("\n");
  }
  function contextBlock(stage) {
    var parts = ["PROBLEM / GOAL:\n" + state.problem];
    if (state.refs) parts.push("REFERENCE NOTES:\n" + snip(state.refs, 1200));
    if (state.docs && state.docs.length) parts.push("KNOWLEDGE DOCS:\n" + state.docs.map(function (d) { return d.name + ":\n" + String(d.text).slice(0, 700); }).join("\n---\n").slice(0, 1600));
    if (state.research && !/^No useful/.test(state.research)) parts.push("WEB RESEARCH NOTES:\n" + state.research.slice(0, 2500));
    if (stage === "plan" && state.researchSummary) parts.push("AGREED RESEARCH SUMMARY:\n" + state.researchSummary);
    var cd = codeDigest(); if (cd) parts.push(cd);
    var ir = isImprove() ? inspectReport() : ""; if (ir) parts.push("AUTOMATIC INSPECTION FINDINGS (real, from the code):\n" + ir);
    var bs = boardSummary(); if (bs) parts.push("TEAM BOARD:\n" + bs);
    var po = pendingObjections(stage); if (po) parts.push("OPEN OBJECTIONS FROM THE LAST VOTE (address them):\n" + po);
    parts.push("MEETING SO FAR:\n" + transcriptText(14));
    return parts.join("\n\n");
  }
  function roleBrief(r) { return String(ROLE_PROMPTS[r] || "").split(". ")[0]; }

  function roundtableCall(stage, round, members) {
    var names = members.map(function (m) { return m.name; });
    var roster = members.map(function (m) { return m.name + " (" + m.role + "): " + roleBrief(m.role); }).join("\n");
    var system = "You write the next round of a short team meeting. The team:\n" + roster + "\n\n" + STAGE_BRIEF[stage] +
      "\n\nRules: each person speaks exactly once, in this order: " + names.join(", ") + ". 2-4 sentences each, concrete, no filler. Each must respond to a colleague BY NAME (agree, build on, or challenge a specific point) and add one new useful point. Be honest: if something important is missing, vote NOT YET. After each person's message add a line VOTE: AGREE or VOTE: NOT YET - <what is missing>. Output ONLY lines in exactly this format, with no markdown and no extra text:\nNAME: message\nVOTE: ...";
    var user = contextBlock(stage) + "\n\nThis is round " + round + " of the " + stage + " stage. " +
      (round === 1 ? "Open the discussion." : "Respond to the previous round's objections and move toward agreement.") + " Write the round now.";
    return askModel(system, user, { ms: 100000, max: 1500 });
  }
  function memberCall(m, stage, round) {
    var system = (ROLE_PROMPTS[m.role] || ROLE_PROMPTS.Strategist) + "\n\nYou are " + m.name + " in a team meeting. " + STAGE_BRIEF[stage] +
      "\nReply in 2-5 sentences. Respond to a colleague BY NAME (agree, build on or challenge a specific point) and add one new concrete point. Be honest. End with exactly one line: VOTE: AGREE or VOTE: NOT YET - <what is missing>. No markdown headings.";
    var user = contextBlock(stage) + "\n\nRound " + round + ". Your turn, " + m.name + ".";
    var img = pendingImage || null; pendingImage = null;
    return askModel(system, user, { ms: 90000, image: img });
  }
  function parseRound(text, members) {
    var out = {}, cur = null;
    var alt = members.map(function (m) { return escRe(m.name); }).join("|");
    var re = new RegExp("^\\s*[*_#>\\-\\s]*(" + alt + ")\\s*(?:\\([^)]*\\))?[*_\\s]*[:：\\-–][*_\\s]*(.*)$", "i");
    String(text).replace(/\r/g, "").split("\n").forEach(function (ln) {
      var vm = ln.match(/^\s*[*_>\-\s]*VOTE\s*[:：]\s*(AGREE|NOT YET)\b[\s:\-–]*(.*)$/i);
      if (vm && cur) { cur.vote = { agree: /^agree/i.test(vm[1]), note: snip(vm[2], 140) }; return; }
      var m = ln.match(re);
      if (m) {
        var mem = members.filter(function (x) { return x.name.toLowerCase() === m[1].toLowerCase(); })[0];
        if (mem && !out[mem.name]) { cur = { member: mem, text: m[2], vote: null }; out[mem.name] = cur; }
        else if (mem) cur = out[mem.name];
        return;
      }
      if (cur && ln.trim()) cur.text += " " + ln.trim();
    });
    Object.keys(out).forEach(function (k) {
      var o = out[k], im = o.text.match(/\bVOTE\s*:\s*(AGREE|NOT YET)\b[\s:\-–]*(.*)$/i);
      if (im) { if (!o.vote) o.vote = { agree: /^agree/i.test(im[1]), note: snip(im[2], 140) }; o.text = o.text.slice(0, im.index).trim(); }
    });
    return out;
  }

  function speakText(text, who) {
    if (!settings.speakTeam || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text || "").slice(0, 400));
      u.rate = 1.05;
      u.pitch = 1;
      u.volume = 0.9;
      // Prefer a reasonably natural voice if available
      var voices = window.speechSynthesis.getVoices();
      var preferred = voices.find(function (v) { return /en(-|_)US|en(-|_)GB/i.test(v.lang) && /Google|Samantha|Daniel|Karen|Moira/i.test(v.name); }) ||
                     voices.find(function (v) { return /^en/i.test(v.lang); });
      if (preferred) u.voice = preferred;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function commitSpeech(stage, sp) {
    typing = null;
    add(sp.member.name, sp.text, { role: sp.member.role, claim: sp.claim, to: sp.to, vote: sp.vote, via: sp.via, stage: stage, round: sp.round });
    state.votes[sp.member.name] = { agree: !!sp.vote.agree, note: sp.vote.note || "", round: sp.round, stage: stage };
    render();
    if (settings.speakTeam) speakText(sp.member.name + " says: " + sp.text, sp.member.name);
  }

  function playRound(stage, round) {
    var members = activeMembers();
    var useModel = isRemote(), roundtable = null;
    if (useModel && !settings.perMember) {
      setStatus("The team is meeting (round " + round + ")…");
      roundtable = roundtableCall(stage, round, members).then(function (r) {
        if (r.text == null) return null;
        var parsed = parseRound(r.text, members);
        return Object.keys(parsed).length ? parsed : null;
      });
    }
    var chain = Promise.resolve();
    members.forEach(function (m) {
      chain = chain.then(function () {
        if (stopReq) return;
        setTyping(m);
        setStatus(m.name + " (" + m.role + ") is thinking…");
        var get;
        if (roundtable) {
          get = roundtable.then(function (parsed) {
            var p = parsed && parsed[m.name];
            return (p && p.text) ? mkSpeech(m, p.text, p.vote, "model", round) : localSpeech(m, stage, round);
          });
        } else if (useModel) {
          get = memberCall(m, stage, round).then(function (r) {
            if (r.text == null) return localSpeech(m, stage, round);
            var v = splitVote(r.text);
            return mkSpeech(m, v.text, v.vote, "model", round);
          });
        } else {
          get = Promise.resolve(localSpeech(m, stage, round));
        }
        return get.then(function (sp) {
          if (stopReq) { typing = null; return; }
          var live = !useModel || !!roundtable;
          var ms = live ? Math.min(900 + sp.text.length * 8, 2400) : 300;
          return sleep(ms).then(function () { if (!stopReq) commitSpeech(stage, sp); else typing = null; });
        });
      });
    });
    return chain;
  }

  function checkAgreement(stage, round) {
    var ms = activeMembers(), pend = [];
    function voted(m) { var v = state.votes[m.name]; return v && v.stage === stage && v.round === round && v.agree; }
    ms.forEach(function (m) {
      var v = state.votes[m.name];
      if (!voted(m)) pend.push(m.name + (v && v.note ? " (" + v.note + ")" : ""));
    });
    var min = stage === "research" ? 2 : Math.max(2, settings.planRounds || 3);
    var max = stage === "research" ? 5 : 7;
    var line = ms.map(function (m) { return (voted(m) ? "✅ " : "⏳ ") + m.name; }).join("   ");
    var head = "🗳 Vote after round " + round + "\n" + line + "\n";
    if (!pend.length && round >= min) {
      add("System", head + "Everyone agrees.", { kind: "votes" }); render();
      return Promise.resolve({ done: true, forced: false });
    }
    if (!pend.length) {
      add("System", head + "Everyone agrees so far. One more round to test the idea before it is locked.", { kind: "votes" });
    } else if (round >= max) {
      add("System", head + "Round limit reached. Closing with these open points noted: " + pend.join("; "), { kind: "votes" }); render();
      return Promise.resolve({ done: true, forced: true });
    } else {
      add("System", head + "Still unsure: " + pend.join("; "), { kind: "votes" });
    }
    render();
    return Promise.resolve({ done: false });
  }

  function summarize(stage) {
    if (!isRemote()) return Promise.resolve(offlineSummary(stage));
    var lead = memberByRole("Strategist");
    setTyping(lead); setStatus(lead.name + " is writing the agreed " + stage + " summary…");
    var system = "You are " + lead.name + ", the Strategist, writing the minutes of what the whole team just agreed. Plain text, no markdown symbols." +
      (stage === "research"
        ? " In at most 140 words: key findings, constraints, and the decisions made."
        : " In at most 230 words use these labelled lines: App name; Features (numbered, 4-8, concrete); Screens and states; Data and storage; Acceptance criteria (4-6 testable statements). Honor every concern the Skeptic raised.");
    return askModel(system, contextBlock(stage), { ms: 90000, max: 1200 }).then(function (r) {
      typing = null;
      return r.text ? r.text : offlineSummary(stage);
    });
  }

  function closeStage(stage, forced) {
    return summarize(stage).then(function (text) {
      typing = null;
      if (stage === "research") {
        state.researchSummary = text;
        add("System", text, { kind: "summary", title: "✅ Research agreed" + (forced ? " (with open points)" : " by everyone") });
        state.stage = "plan"; state.rounds.plan = 0; state.votes = {};
        add("System", "Moving on to the plan.");
      } else {
        state.plan = text;
        add("System", text, { kind: "summary", title: "✅ Plan agreed" + (forced ? " (with open points)" : " by everyone") });
        state.stage = "ready";
        add("System", "The plan is locked. Tap 🛠 Build & Preview when you are ready.");
      }
      render(); autosave();
    });
  }

  function researchStep() {
    if (!settings.webResearch) { state.researchDone = true; return Promise.resolve(); }
    var dev = memberByRole("Researcher");
    setTyping(dev); setStatus(dev.name + " is searching the web (Wikipedia, DuckDuckGo, news-oriented)…");
    return doResearch(state.problem).then(function () {
      state.researchDone = true; typing = null;
      var n = (state.researchItems && state.researchItems.length) || (/^No useful/.test(state.research) ? 0 : state.research.split("\n\n").length);
      add("System", n ? "🔎 " + dev.name + " found " + n + " public sources (Wikipedia + DuckDuckGo, including news-oriented queries). Sources are linked in the research card."
                      : "🔎 No public search results came back (offline, blocked, or very specific topic). The team will use built-in knowledge.");
      render();
    }).catch(function () { state.researchDone = true; typing = null; });
  }

  function teamLoop() {
    function step() {
      if (stopReq) { add("System", "⏸ Paused. Tap Continue to resume."); render(); return Promise.resolve(); }
      var st = state.stage;
      if (st !== "research" && st !== "plan") return Promise.resolve();
      if (!activeMembers().length) { add("System", "No active members. Turn at least one on in the Team menu."); render(); return Promise.resolve(); }
      var pre = (st === "research" && !state.researchDone) ? researchStep() : Promise.resolve();
      return pre.then(function () {
        state.rounds[st] = (state.rounds[st] || 0) + 1;
        var round = state.rounds[st];
        return playRound(st, round).then(function () {
          if (stopReq) return;
          return checkAgreement(st, round).then(function (res) { if (res.done) return closeStage(st, res.forced); });
        });
      }).then(function () { autosave(); return step(); });
    }
    return step();
  }

  function startTeam() {
    if (running || building) return;
    running = true; stopReq = false; busy = true; offlineNoticed = false;
    syncControls(); render();
    teamLoop().catch(function (e) { add("System", "⚠ " + ((e && e.message) || e)); }).then(function () {
      running = false; busy = false; typing = null; setStatus("");
      syncControls(); render(); autosave();
      if (state.stage === "ready" && settings.autoBuild && !stopReq) startBuild();
    });
  }

  /* ================= build, test, review, preview ================= */
  function extractHtml(text) {
    var fence = String(text).match(/```(?:html)?\s*\n?([\s\S]*?)(?:```|$)/i);
    var c = fence ? fence[1] : String(text);
    var i = c.search(/<!doctype html|<html/i);
    if (i < 0) return null;
    return c.slice(i).trim();
  }
  function parseEdits(t) {
    var edits = [], re = /<<<<<<<\s*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n?=======[ \t]*\r?\n([\s\S]*?)\r?\n?>>>>>>>\s*REPLACE/g, m;
    while ((m = re.exec(t))) edits.push({ s: m[1].replace(/\r/g, ""), r: m[2].replace(/\r/g, "") });
    return edits;
  }
  function countOcc(hay, needle) { var n = 0, p = hay.indexOf(needle); while (p >= 0) { n++; p = hay.indexOf(needle, p + needle.length); } return n; }
  function applyEdits(code, edits) {
    var out = code, fails = [], ok = 0;
    edits.forEach(function (e, i) {
      var s = e.s;
      if (!s.trim()) { fails.push("Edit " + (i + 1) + ": empty SEARCH block"); return; }
      var n = countOcc(out, s);
      if (n === 0) { var s2 = s.replace(/^\n+|\n+$/g, ""); if (s2 && s2 !== s && countOcc(out, s2) > 0) { s = s2; n = countOcc(out, s2); } }
      if (n === 0) { fails.push("Edit " + (i + 1) + ": SEARCH text not found: " + snip(s, 80)); return; }
      if (n > 1) { fails.push("Edit " + (i + 1) + ": SEARCH text matches " + n + " places; add more surrounding lines: " + snip(s, 80)); return; }
      var idx = out.indexOf(s);
      out = out.slice(0, idx) + e.r + out.slice(idx + s.length);
      ok++;
    });
    return { code: out, fails: fails, ok: ok };
  }

  var BUILDER_SYS = "You are the Builder on a team of experts. Write ONE complete, self-contained HTML file (inline CSS and JavaScript, no external libraries, no network requests) that fully implements the AGREED PLAN, including every feature and acceptance criterion. It must work on an iPhone in Safari: responsive, dark theme, 44px tap targets, viewport meta tag, 16px inputs. Never use alert/prompt/confirm. If data must persist, use localStorage inside try/catch. Keep it focused (under about 700 lines) and make every feature really work. Output ONLY the HTML, starting with <!DOCTYPE html>, no explanation, no markdown fences.";
  var EDIT_SYS = "You are the senior Builder editing an EXISTING large single-file web app. Do NOT rewrite the whole file. Output ONLY edit blocks in exactly this format, one per change:\n<<<<<<< SEARCH\n(exact text copied from the current file, enough lines to be unique)\n=======\n(replacement text)\n>>>>>>> REPLACE\n\nRules: the SEARCH text must match the file character for character and appear exactly once. Keep every existing feature working. To insert code, SEARCH a nearby unique line and REPLACE it with that line plus the new code. No commentary and no markdown fences.";
  var REVIEW_SYS = "You are the Skeptic, a strict code reviewer. You get the problem, the agreed plan with acceptance criteria, automatic test findings, and the app. Check for JavaScript errors, missing or non-working features versus the plan, broken logic, and poor mobile usability. If it fully works and meets the plan, reply with exactly APPROVED on the first line, then one short sentence. Otherwise reply with ISSUES: and a numbered list (max 8) of concrete problems and how to fix each.";

  function withShim(code, id) {
    var shim = '<script>(function(){var id=' + JSON.stringify(id) + ';function s(m){try{parent.postMessage({__chk:id,err:String(m).slice(0,300)},"*")}catch(e){}}' +
      'window.addEventListener("error",function(e){s((e.message||"error")+(e.lineno?" (line "+e.lineno+")":""))});' +
      'window.addEventListener("unhandledrejection",function(e){s("Unhandled promise rejection: "+(e.reason&&e.reason.message||e.reason))});' +
      'var ce=console.error;console.error=function(){s("console.error: "+[].slice.call(arguments).join(" "));try{ce.apply(console,arguments)}catch(x){}};' +
      'function mk(){var st={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(st,k)?st[k]:null},setItem:function(k,v){st[k]=String(v)},removeItem:function(k){delete st[k]},clear:function(){st={}},key:function(i){return Object.keys(st)[i]||null},get length(){return Object.keys(st).length}}}' +
      'try{Object.defineProperty(window,"localStorage",{value:mk(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:mk(),configurable:true})}catch(e){}' +
      'setTimeout(function(){try{var b=document.body;parent.postMessage({__chk:id,info:{len:(b&&b.innerText||"").trim().length,els:document.querySelectorAll("button,input,select,textarea,canvas,svg,a").length}},"*")}catch(e){}},1800);' +
      '})();<\/script>';
    return /<head[^>]*>/i.test(code) ? code.replace(/<head[^>]*>/i, function (m) { return m + shim; }) : shim + code;
  }
  function staticCheck(code) {
    var p = [];
    if (!/<\/html>\s*$/i.test(code)) p.push("The file looks cut off: it does not end with </html>. Make the app shorter and complete.");
    if (!/<meta[^>]+viewport/i.test(code)) p.push("Missing viewport meta tag (needed for iPhone Safari).");
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(code))) {
      if (/\bsrc\s*=/i.test(m[1]) || /type\s*=\s*["']?(module|application\/json|text\/template)/i.test(m[1])) continue;
      try { new Function(m[2]); } catch (e) { p.push("JavaScript syntax error: " + e.message); }
    }
    return p;
  }
  function runtimeCheck(code) {
    return new Promise(function (res) {
      var f = document.createElement("iframe"), errs = [], id = "t" + Date.now();
      f.setAttribute("sandbox", "allow-scripts");
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;left:-9999px;top:0;width:390px;height:700px;border:0;visibility:hidden";
      function onMsg(e) {
        if (e.source !== f.contentWindow) return;
        var d = e.data || {};
        if (d.__chk !== id) return;
        if (d.err) errs.push("Runtime error: " + d.err);
        if (d.info && d.info.len < 3 && d.info.els === 0) errs.push("The page renders blank: nothing visible and no controls.");
      }
      window.addEventListener("message", onMsg);
      f.srcdoc = withShim(code, id);
      document.body.appendChild(f);
      setTimeout(function () {
        window.removeEventListener("message", onMsg);
        if (f.parentNode) f.parentNode.removeChild(f);
        res(errs.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 6));
      }, 2600);
    });
  }

  function startBuild() {
    if (building) return;
    if (running) { toast("Wait for the team to finish, or tap Stop."); return; }
    if (state.stage !== "ready" && state.stage !== "done") { toast("The team has to agree on the plan first."); return; }
    if (isImprove() && !state.buildHistory.length && (state.files || []).length) {
      add("System", "ℹ Build writes a single HTML file, but this app has several files. The agreed plan above is your change list. To let the Builder edit one file, upload just that single HTML file.");
      render(); return;
    }
    runBuild("");
  }

  function runBuild(changeReq) {
    building = true; stopBuild = false; busy = true; offlineNoticed = false;
    state.stage = "building";
    var builder = memberByRole("Builder"), skeptic = memberByRole("Skeptic");
    var maxIt = Math.max(1, Math.min(8, settings.buildIters || 4)), attempt = 0;
    var last = state.buildHistory.length ? state.buildHistory[state.buildHistory.length - 1].code : null;
    var feedback = changeReq || "";
    syncControls(); render();

    function finish(msg, openPreview) {
      building = false; busy = false; stopBuild = false; typing = null; setStatus("");
      state.stage = state.buildHistory.length ? "done" : "ready";
      if (msg) add("System", msg);
      syncControls(); render(); autosave();
      if (openPreview && state.buildHistory.length) previewBuild();
    }

    function writeCode() {
      if (!isRemote()) {
        if (isImprove()) return Promise.resolve({ blocked: "The built-in team can inspect code but cannot rewrite it. The agreed plan above is your change list. Choose Free AI or add your key in Settings to have the Builder apply it." });
        if (!pickTemplate()) return Promise.resolve({ blocked: "The built-in builder only makes five starter apps and this idea is not one of them. Choose Free AI or add your key in Settings, then tap Build again." });
        if (feedback && last) add("System", "The built-in builder makes starter apps from templates and can't apply custom changes. Connect an AI model for that.");
        return Promise.resolve({ code: offlineApp(), via: "offline" });
      }
      var edit = !!(last && last.length > 30000);
      var user = "GOAL:\n" + state.problem + "\n\nAGREED PLAN:\n" + (state.plan || boardSummary() || "Use best judgement.") +
        (state.researchSummary ? "\n\nAGREED RESEARCH:\n" + state.researchSummary : "") +
        (state.refs ? "\n\nREFERENCE NOTES:\n" + snip(state.refs, 1200) : "") +
        (last ? "\n\nCURRENT FILE:\n```html\n" + last + "\n```" : "") +
        (feedback ? "\n\nFIX / CHANGE REQUEST:\n" + feedback : (last ? "\n\nImprove it where the plan is not fully met." : "\n\nWrite the complete app.")) +
        (edit ? "\n\nReturn ONLY SEARCH/REPLACE edit blocks." : "\n\nReturn the COMPLETE HTML file.");
      return askModel(edit ? EDIT_SYS : BUILDER_SYS, user, { ms: 180000, max: edit ? 8000 : 16000, gap: 1500 }).then(function (r) {
        if (r.text == null) return last ? { failed: true } : (pickTemplate() && !isImprove() ? { code: offlineApp(), via: "offline", failedModel: true } : { blocked: "The AI service isn't answering, and the built-in builder can't make this one. Try again in a minute." });
        var edits = edit ? parseEdits(r.text) : [];
        if (edits.length) {
          var res = applyEdits(last, edits);
          if (!res.ok) return { retry: "Your edit blocks did not apply:\n" + res.fails.join("\n") + "\nCopy the SEARCH text exactly from the current file; it must appear exactly once." };
          return { code: res.code, via: "model", note: res.fails.length ? res.fails.length + " edit(s) could not be applied." : "" };
        }
        var code = extractHtml(r.text);
        if (!code) return { retry: "Return a complete HTML document starting with <!DOCTYPE html>." };
        return { code: code, via: "model" };
      });
    }

    function review(code, problems, v, res) {
      var auto = {
        ok: !problems.length, via: "offline",
        text: problems.length ? "Automatic checks failed:\n- " + problems.join("\n- ")
          : "Automatic checks passed: it loads, shows content, has working controls and no script errors."
      };
      if (!isRemote() || res.via === "offline") return Promise.resolve(auto);
      var user = "GOAL: " + state.problem + "\n\nAGREED PLAN (acceptance criteria):\n" + (state.plan || "") +
        "\n\nAUTOMATIC TEST FINDINGS:\n" + (problems.length ? problems.join("\n") : "No syntax or runtime errors; the page is not blank.") +
        "\n\nTHE APP (version " + v + "):\n```html\n" + (code.length > 14000 ? code.slice(0, 7000) + "\n…[middle omitted]…\n" + code.slice(-5000) : code) + "\n```";
      return askModel(REVIEW_SYS, user, { ms: 90000, max: 900 }).then(function (r) {
        if (r.text == null) return auto;
        var ok = /^\s*APPROVED/i.test(r.text) && !problems.length;
        return {
          ok: ok, via: "model",
          text: ok ? r.text.replace(/^\s*APPROVED[:.\s-]*/i, "").slice(0, 240)
            : (problems.length ? "Test findings:\n- " + problems.join("\n- ") + "\n\n" : "") + r.text.replace(/^\s*ISSUES:?\s*/i, "")
        };
      });
    }

    function attemptOnce() {
      if (stopBuild) return finish("⏹ Build stopped.", false);
      if (attempt >= maxIt) return finish("⚠ Reached " + maxIt + " attempts without full approval. The latest version opens in Preview. Tap Rebuild to keep fixing.", true);
      if (attempt >= 1 && !isRemote()) return finish("The built-in builder can't repair this automatically. The latest version opens in Preview.", true);
      attempt++;
      var v = state.buildHistory.length + 1;
      setTyping(builder); setStatus(builder.name + " is writing version " + v + "…");
      return writeCode().then(function (res) {
        typing = null;
        if (res.retry) { feedback = res.retry; add(builder.name, "My edit didn't apply cleanly, retrying with exact text…", { role: "Builder" }); render(); return attemptOnce(); }
        if (res.blocked) return finish("ℹ " + res.blocked, false);
        if (res.failed) return finish("⚠ The AI service isn't answering, so the app couldn't be changed this time. Try again in a minute.", false);
        var code = res.code;
        state.buildHistory.push({ version: v, code: code, ts: Date.now(), attempt: attempt, via: res.via });
        if (state.buildHistory.length > 12) state.buildHistory = state.buildHistory.slice(-12);
        add(builder.name, "Built version " + v + " (" + (code.length / 1024).toFixed(1) + " KB" + (res.via === "offline" ? ", a starter app from built-in templates" : "") + "). Testing it in the sandbox…",
          { role: "Builder", via: res.via === "offline" ? "offline" : undefined });
        render();
        setTyping(skeptic); setStatus("Testing version " + v + " in a sandbox…");
        return runtimeCheck(code).then(function (rt) {
          var problems = staticCheck(code).concat(rt);
          setStatus(skeptic.name + " is reviewing version " + v + "…");
          return review(code, problems, v, res).then(function (rv) {
            typing = null;
            last = code;
            if (rv.ok) {
              state.buildHistory[state.buildHistory.length - 1].approved = true;
              add(skeptic.name, "Approved version " + v + ". " + rv.text, { role: "Skeptic", via: rv.via === "offline" ? "offline" : undefined });
              add("System", "Version " + v + " passed the sandbox test and the review.", { kind: "deliverable", version: v, title: "✅ Version " + v + " is ready" });
              return finish("", true);
            }
            feedback = rv.text;
            add(skeptic.name, "Version " + v + " needs work:\n" + snip(rv.text, 500), { role: "Skeptic", via: rv.via === "offline" ? "offline" : undefined });
            render();
            return attemptOnce();
          });
        });
      });
    }
    return attemptOnce().catch(function (e) { finish("⚠ Build stopped: " + ((e && e.message) || e), state.buildHistory.length > 0); });
  }

  function previewBuild(version) {
    var entry = state.buildHistory.filter(function (b) { return b.version === version; })[0] || state.buildHistory[state.buildHistory.length - 1];
    if (!entry) return toast("No build yet");
    $("pvTitle").textContent = "Preview v" + entry.version + (entry.approved ? " ✓ tested" : "");
    $("pvFrame").srcdoc = withShim(entry.code, "pv");
    openDialog("dPreview");
  }
  function downloadBuild(version) {
    var entry = state.buildHistory.filter(function (b) { return b.version === version; })[0] || state.buildHistory[state.buildHistory.length - 1];
    if (!entry) return toast("No build yet");
    var blob = new Blob([entry.code], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "app-v" + entry.version + ".html";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast("Download requested for v" + entry.version);
  }

  function handleChange(text) {
    var s = memberByRole("Strategist"), b = memberByRole("Builder");
    add(s.name, "Got it. We'll apply this to the agreed plan: " + snip(text, 140), { role: s.role, via: isRemote() ? undefined : "offline" });
    add(b.name, "On it. I'll rebuild with that change and run the tests again.", { role: b.role, via: isRemote() ? undefined : "offline" });
    state.plan = (state.plan || "") + "\nCHANGE REQUEST: " + text;
    render();
    runBuild(text);
  }

  function sendUser() {
    var input = $("userInput");
    var text = (input.value || "").trim();
    if (!text) return;
    if (building) { toast("The Builder is working. Tap Stop build first, or wait."); return; }
    input.value = "";
    input.style.height = "auto";
    var first = !state.problem;
    if (first) {
      state.problem = text; state.stage = "research"; state.rounds = { research: 0, plan: 0 };
      state.researchDone = false; state.votes = {}; state.researchSummary = ""; state.plan = "";
    }
    if (state.title === "Untitled") state.title = text.slice(0, 48);
    var extra = {};
    if (pendingImage) extra.image = pendingImage;
    add("You", text, extra);
    render();
    if (running) { toast("Added. The team will read it on their next turn."); return; }
    if (first) {
      if (/\b(ai council|this app|the app itself|itself)\b/i.test(text) && !(state.files || []).length) {
        busy = true; syncControls(); setStatus("Loading this app's own code…");
        loadSelfSource().then(function () { busy = false; setStatus(""); startTeam(); });
      } else startTeam();
      return;
    }
    if (state.stage === "ready") {
      state.stage = "plan"; state.rounds.plan = 0; state.votes = {};
      add("System", "Your note reopens the plan. The team will talk it through again.");
      render(); startTeam(); return;
    }
    if (state.stage === "done") { handleChange(text); return; }
    startTeam();
  }

  function renderMembers() {
    var list = $("membersList");
    list.innerHTML = "";
    state.members.forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "member-row";
      var color = ROLE_COLORS[m.role] || "#888";
      var roleOpts = Object.keys(ROLE_PROMPTS).map(function (r) {
        return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + r + "</option>";
      }).join("");
      row.innerHTML =
        '<span class="dot" style="background:' + color + '"></span>' +
        '<input type="checkbox"' + (m.on ? " checked" : "") + ' data-i="' + i + '" class="m-on">' +
        '<input type="text" value="' + esc(m.name) + '" data-i="' + i + '" class="m-name">' +
        '<select data-i="' + i + '" class="m-role">' + roleOpts + "</select>" +
        '<button type="button" class="btn" data-del="' + i + '">X</button>';
      list.appendChild(row);
    });
    list.querySelectorAll(".m-on").forEach(function (el) {
      el.onchange = function () { state.members[+el.getAttribute("data-i")].on = el.checked; autosave(); };
    });
    list.querySelectorAll(".m-name").forEach(function (el) {
      el.onchange = function () {
        state.members[+el.getAttribute("data-i")].name = el.value.trim() || "Member";
        autosave();
      };
    });
    list.querySelectorAll(".m-role").forEach(function (el) {
      el.onchange = function () {
        state.members[+el.getAttribute("data-i")].role = el.value;
        autosave();
        renderMembers();
      };
    });
    list.querySelectorAll("[data-del]").forEach(function (el) {
      el.onclick = function () {
        if (state.members.length <= 1) return toast("Need at least one member");
        state.members.splice(+el.getAttribute("data-del"), 1);
        renderMembers();
        autosave();
      };
    });
  }

  function renderProjects() {
    var list = $("projectsList");
    var projs = projects();
    if (!projs.length) {
      list.innerHTML = '<p class="hint">No saved projects yet.</p>';
      return;
    }
    list.innerHTML = "";
    projs.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "proj-row";
      var date = new Date(p.updated || p.created).toLocaleDateString();
      row.innerHTML =
        '<div class="info"><b>' + esc(p.title || "Untitled") + "</b><small>" + date +
        " · " + ((p.messages && p.messages.length) || 0) + " msgs</small></div>" +
        '<button type="button" class="btn" data-open="' + p.id + '">Open</button>' +
        '<button type="button" class="btn danger" data-delp="' + p.id + '">X</button>';
      list.appendChild(row);
    });
    list.querySelectorAll("[data-open]").forEach(function (el) {
      el.onclick = function () {
        var p = projs.find(function (x) { return x.id === el.getAttribute("data-open"); });
        if (!p) return;
        if (state.messages.length && state.id !== p.id) saveProject(false);
        state = Object.assign(defaultState(), JSON.parse(JSON.stringify(p)));
        saveCurrent();
        render();
        closeDialog("dProjects");
        toast("Opened");
      };
    });
    list.querySelectorAll("[data-delp]").forEach(function (el) {
      el.onclick = function () {
        uiConfirm("Delete this project?").then(function (ok) {
          if (!ok) return;
          writeProjects(projs.filter(function (x) { return x.id !== el.getAttribute("data-delp"); }));
          renderProjects();
        });
      };
    });
  }

  var PROVIDERS = {
    groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", provider: "openai" },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free", provider: "openai" },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.0-flash", provider: "gemini" },
    nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "meta/llama-3.1-70b-instruct", provider: "openai" }
  };

  function fillSettingsForm() {
    $("sEngine").value = settings.engine;
    $("sUrl").value = settings.url || "";
    $("sModel").value = settings.model || "";
    $("sKey").value = settings.key || "";
    $("sBuildMode").checked = !!settings.buildMode;
    $("sWeb").checked = !!settings.webResearch;
    $("sPerMember").checked = !!settings.perMember;
    $("sAutoBuild").checked = !!settings.autoBuild;
    $("sPlanRounds").value = settings.planRounds || 3;
    $("sBuildIters").value = settings.buildIters || 4;
    $("sAutosave").checked = !!settings.autosave;
    if ($("sSpeak")) $("sSpeak").checked = !!settings.speakTeam;
    $("customBlock").classList.toggle("hidden", settings.engine !== "custom");
    $("freeBlock").classList.toggle("hidden", settings.engine !== "free");
    $("testResult").textContent = "";
  }

  function applySettingsFromForm() {
    settings.engine = $("sEngine").value;
    settings.url = $("sUrl").value.trim();
    settings.model = $("sModel").value.trim();
    settings.key = $("sKey").value.trim();
    settings.buildMode = $("sBuildMode").checked;
    settings.webResearch = $("sWeb").checked;
    settings.perMember = $("sPerMember").checked;
    settings.autoBuild = $("sAutoBuild").checked;
    settings.planRounds = Math.max(2, Math.min(8, +$("sPlanRounds").value || 3));
    settings.buildIters = Math.max(1, Math.min(8, +$("sBuildIters").value || 4));
    settings.autosave = $("sAutosave").checked;
    if ($("sSpeak")) settings.speakTeam = $("sSpeak").checked;
    saveSettings();
    toast("Settings saved");
  }

  function loadModels() {
    var url = $("sUrl").value.trim(), key = $("sKey").value.trim(), msg = $("modelsMsg");
    if (!url) { msg.textContent = "Pick a provider preset or enter the endpoint URL first."; return; }
    var base = url.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
    var isOR = /openrouter\.ai/.test(url), h = {};
    if (key && !isOR) h["Authorization"] = "Bearer " + key;
    msg.textContent = "Loading models…";
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 15000);
    fetch(base + "/models", { headers: h, signal: ctl.signal }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var list = (j.data || j.models || []).filter(function (m) {
        if (!isOR) return true;
        return m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0;
      }).map(function (m) { return String(m.id || m.name || "").replace(/^models\//, ""); }).filter(Boolean);
      if (isOR && list.indexOf("openrouter/free") < 0) list.unshift("openrouter/free");
      list = list.slice(0, 80);
      var dl = $("modelList"); dl.innerHTML = "";
      list.forEach(function (id) { var o = document.createElement("option"); o.value = id; dl.appendChild(o); });
      msg.textContent = list.length ? "✔ " + list.length + (isOR ? " free" : "") + " models loaded. Tap the Model box to choose one." : "No models returned.";
    }).catch(function (e) {
      clearTimeout(t);
      msg.textContent = "✖ Could not load the list (" + ((e && e.message) || e) + "). You can still type a model name.";
    });
  }

  function testEngine() {
    applySettingsFromForm();
    var out = $("testResult");
    if (settings.engine === "local") { out.textContent = "Built-in team selected: no AI model to test. It always works offline."; return; }
    out.textContent = "Testing…";
    offlineNoticed = true;
    callModel("Reply with exactly: OK", "ping", { ms: 30000 })
      .then(function (t) { $("sModel").value = settings.model || ""; out.textContent = "✔ Connected (" + (settings.model || "free AI") + "). The model replied: " + snip(t, 40); })
      .catch(function (e) { out.textContent = "✖ " + friendlyErr(e) + " The team will still work with its built-in voices."; })
      .then(function () { offlineNoticed = false; });
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("Camera requires HTTPS and a supported browser");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        liveStream = stream;
        $("camVideo").srcObject = liveStream;
        openDialog("dCamera");
      })
      .catch(function (e) { toast("Camera unavailable: " + (e.message || e)); });
  }

  function stopCamera() {
    if (liveStream) {
      liveStream.getTracks().forEach(function (t) { t.stop(); });
      liveStream = null;
    }
    $("camVideo").srcObject = null;
    closeDialog("dCamera");
  }

  function snapCamera() {
    var video = $("camVideo");
    var canvas = $("camCanvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    pendingImage = { dataUrl: canvas.toDataURL("image/jpeg", 0.85), mime: "image/jpeg", w: canvas.width, h: canvas.height };
    stopCamera();
    toast("Frame captured - send a message");
  }

  function handleUpload(files) {
    Array.prototype.forEach.call(files, function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = reader.result;
        if (/\.(html|htm)$/i.test(file.name)) {
          state.files.push({ name: file.name, text: String(text), ts: Date.now() });
          var version = (state.buildHistory.length || 0) + 1;
          state.buildHistory.push({ version: version, code: String(text), ts: Date.now(), attempt: 0 });
          add("System", "Loaded " + file.name + " (v" + version + ").");
        } else {
          state.docs.push({ name: file.name, text: String(text).slice(0, 20000), ts: Date.now() });
          add("System", "Added knowledge doc: " + file.name);
        }
        render();
        autosave();
      };
      reader.readAsText(file);
    });
  }

  function initEvents() {
    $("sendBtn").onclick = sendUser;
    $("userInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUser(); }
    });
    $("userInput").addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });

    // Voice input (Web Speech API)
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recog = null, listening = false;
    if (SpeechRec) {
      recog = new SpeechRec();
      recog.continuous = false;
      recog.interimResults = true;
      recog.lang = (navigator.language || "en-US");
      recog.onresult = function (ev) {
        var txt = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
        if (txt) {
          var inp = $("userInput");
          inp.value = (inp.value ? inp.value + " " : "") + txt.trim();
          inp.dispatchEvent(new Event("input"));
        }
      };
      recog.onend = function () {
        listening = false;
        var mb = $("micBtn");
        if (mb) { mb.style.background = "#161a32"; mb.style.color = "#8b92b8"; mb.textContent = "🎤"; }
      };
      recog.onerror = function () {
        listening = false;
        var mb = $("micBtn");
        if (mb) { mb.style.background = "#161a32"; mb.style.color = "#8b92b8"; mb.textContent = "🎤"; }
        toast("Voice input unavailable or permission denied");
      };
    }
    if ($("micBtn")) {
      $("micBtn").onclick = function () {
        if (!recog) return toast("Voice input not supported in this browser");
        if (listening) {
          try { recog.stop(); } catch (e) {}
          listening = false;
          this.style.background = "#161a32"; this.style.color = "#8b92b8"; this.textContent = "🎤";
          return;
        }
        try {
          recog.start();
          listening = true;
          this.style.background = "#7c8cff"; this.style.color = "#fff"; this.textContent = "⏹";
          toast("Listening… speak now");
        } catch (e) { toast("Could not start microphone"); }
      };
    }

    $("bBuild").onclick = function () {
      if (building) { stopBuild = true; toast("Stopping after this step…"); return; }
      startBuild();
    };
    $("bStop").onclick = function () { if (running) { stopReq = true; toast("Pausing after this message…"); } };
    $("bPreview").onclick = function () { previewBuild(); };
    $("dPreview").addEventListener("close", function () { $("pvFrame").srcdoc = ""; });
    $("bResearch").onclick = function () {
      var topic = state.problem || ($("userInput").value || "").trim();
      if (!topic) return toast("Describe a topic first (or type one in the box)");
      var extra = ($("userInput").value || "").trim();
      if (extra && extra === topic) extra = "";
      setStatus("Researching (Wikipedia + DuckDuckGo + news queries)…");
      doResearch(topic, extra || undefined).then(function () {
        var n = (state.researchItems && state.researchItems.length) || 0;
        add("System", n ? "Research updated — " + n + " sources found. Open the research card for links & actions." : "Research finished (no new public results).");
        if (!state.problem) { state.problem = topic; if (state.stage === "idle") state.stage = "research"; }
        render();
      }).catch(function (e) {
        add("System", "Research failed: " + (e.message || e));
        render();
      }).then(function () { setStatus(""); });
    };
    $("bContinue").onclick = function () {
      if (busy || !state.problem) return;
      if (state.stage === "research" || state.stage === "plan") startTeam();
    };
    $("bUpload").onclick = function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".txt,.md,.json,.csv,.html,.htm";
      inp.multiple = true;
      inp.onchange = function () { handleUpload(inp.files); };
      inp.click();
    };
    $("bCamera").onclick = startCamera;
    $("bFiles").onclick = function () {
      var list = $("filesList");
      if (!state.buildHistory.length) {
        list.innerHTML = '<p class="hint">No files yet.</p>';
      } else {
        list.innerHTML = state.buildHistory.map(function (b) {
          return '<div class="proj-row"><div class="info"><b>Build v' + b.version + "</b><small>" +
            (b.code.length / 1024).toFixed(1) + " KB</small></div>" +
            '<button type="button" class="btn" data-pv="' + b.version + '">Preview</button>' +
            '<button type="button" class="btn" data-dlv="' + b.version + '">DL</button></div>';
        }).join("");
        list.querySelectorAll("[data-pv]").forEach(function (el) {
          el.onclick = function () { previewBuild(+el.getAttribute("data-pv")); };
        });
        list.querySelectorAll("[data-dlv]").forEach(function (el) {
          el.onclick = function () { downloadBuild(+el.getAttribute("data-dlv")); };
        });
      }
      openDialog("dFiles");
    };
    $("bRefs").onclick = function () {
      $("refsInput").value = state.refs || "";
      openDialog("dRefs");
    };
    $("bDownload").onclick = function () {
      if (state.buildHistory.length) downloadBuild(state.buildHistory[state.buildHistory.length - 1].version);
    };

    $("bSettings").onclick = function () { fillSettingsForm(); openDialog("dSettings"); };
    $("bMembers").onclick = function () { renderMembers(); openDialog("dMembers"); };
    $("bProjects").onclick = function () { renderProjects(); openDialog("dProjects"); };

    $("sEngine").onchange = function () {
      $("customBlock").classList.toggle("hidden", $("sEngine").value !== "custom");
      $("freeBlock").classList.toggle("hidden", $("sEngine").value !== "free");
    };
    document.querySelectorAll(".pchip").forEach(function (btn) {
      btn.onclick = function () {
        var p = PROVIDERS[btn.getAttribute("data-p")];
        if (!p) return;
        $("sUrl").value = p.url;
        $("sModel").value = p.model;
        settings.provider = p.provider;
        document.querySelectorAll(".pchip").forEach(function (c) { c.classList.remove("active"); });
        btn.classList.add("active");
      };
    });
    $("bSaveSettings").onclick = function () {
      applySettingsFromForm();
      closeDialog("dSettings");
    };
    $("bTestKey").onclick = testEngine;
    $("bLoadModels").onclick = loadModels;
    $("bTestFree").onclick = testEngine;

    $("bAddMember").onclick = function () {
      state.members.push({ name: "Member" + (state.members.length + 1), role: "Creative", on: true });
      renderMembers();
      autosave();
    };

    $("bNewProject").onclick = function () {
      var go = function () {
        stopReq = true; typing = null;
        state = defaultState();
        saveCurrent();
        render();
        closeDialog("dProjects");
      };
      if (state.messages.length) {
        uiConfirm("Save current and start new?").then(function (ok) {
          if (!ok) return;
          saveProject(false);
          go();
        });
      } else go();
    };
    $("bExport").onclick = function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (state.title || "project").replace(/\W+/g, "-") + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    };

    $("bSaveRefs").onclick = function () {
      state.refs = $("refsInput").value.trim();
      autosave();
      closeDialog("dRefs");
      toast("Notes saved");
    };

    $("bCamStop").onclick = stopCamera;
    $("bCamSnap").onclick = snapCamera;

    document.querySelectorAll("[data-tpl]").forEach(function (btn) {
      btn.onclick = function () {
        $("userInput").value = TEMPLATES[btn.getAttribute("data-tpl")] || "";
        $("userInput").focus();
      };
    });

    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.onclick = function () {
        var dlg = btn.closest("dialog");
        if (dlg) closeDialog(dlg);
      };
    });

    document.querySelectorAll("dialog").forEach(function (d) {
      d.addEventListener("click", function (e) {
        if (e.target === d) closeDialog(d);
      });
    });

    // Research card actions (event delegation — survives re-renders)
    $("chat").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-research-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-research-act");
      if (act === "refresh") {
        if (busy || running) return toast("Team is busy — wait or Stop first");
        setStatus("Refreshing research…");
        doResearch(state.problem || state.title || "web app").then(function () {
          add("System", "Research refreshed with latest public notes.");
          setStatus(""); render();
        }).catch(function () { setStatus(""); toast("Research refresh failed"); });
      } else if (act === "custom") {
        if (busy || running) return toast("Team is busy — wait or Stop first");
        openDialog("dPrompt");
        $("tPrompt").textContent = "Custom research query";
        $("promptMsg").textContent = "Extra search terms (e.g. \"2026 Safari PWA limits\" or \"latest news on …\")";
        $("promptVal").value = "";
        $("promptYes").onclick = function () {
          var q = ($("promptVal").value || "").trim();
          closeDialog("dPrompt");
          if (!q) return;
          setStatus("Running custom research…");
          doResearch(state.problem || state.title || "web app", q).then(function () {
            add("System", "Added custom research for: " + snip(q, 60));
            setStatus(""); render();
          }).catch(function () { setStatus(""); toast("Custom research failed"); });
        };
        $("promptNo").onclick = function () { closeDialog("dPrompt"); };
      } else if (act === "copy") {
        var text = state.research || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast("Research copied"); }).catch(function () { toast("Copy failed"); });
        } else {
          toast("Clipboard not available");
        }
      } else if (act === "pin") {
        var pin = "\n\n--- Pinned research ---\n" + (state.research || "").slice(0, 4000);
        state.refs = (state.refs || "") + pin;
        autosave();
        toast("Research pinned to Notes");
      } else if (act === "clear") {
        state.research = "";
        state.researchItems = [];
        render();
        autosave();
        toast("Research notes cleared");
      }
    });
  }

  function boot() {
    try { loadAll(); } catch (e) { showError("loadAll: " + e.message); }
    try { initEvents(); } catch (e) { showError("initEvents: " + e.message); }
    try { render(); } catch (e) { showError("render: " + e.message); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
