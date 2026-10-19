# AI Council v3.2 — best practical version

Staged multi-agent team that **researches → plans → builds** single-file mobile web apps. Dashboard layout is unchanged from the original.

## Upload to GitHub Pages
Upload **all** of these to the **root** of the repo (not inside a folder):

- index.html
- app.js
- sw.js
- manifest.webmanifest
- icon-192.png
- icon-512.png
- apple-touch-icon.png

Settings → Pages → Deploy from branch → main → / (root).  
Open the `https://USERNAME.github.io/REPO/` link in **Safari**.  
If you already installed an older version: delete the Home Screen icon, open the link, Add to Home Screen again.

## What’s new / more useful

### Stronger live research
- Wikipedia (with real page links) + DuckDuckGo Instant Answer
- Extra query variants: best practices, mobile/Safari/iPhone, **latest / news / current**
- Research card shows **source · title · text + “Open source ↗” links**
- Card actions: **↻ Refresh**, **+ Custom query**, **Copy**, **Pin to Notes**, **Clear**
- Toolbar **Research** button uses whatever is currently typed as an extra query
- Researcher is instructed to ground findings in the real research block (no invented live news)

### Everyday extras
- **🎤 Voice input** (next to Go) — Web Speech API
- **Speak team messages** toggle in Settings (text-to-speech)
- Same header / stage bar / chat / toolbar / input layout

### Engines (unchanged core)
- Free AI (Pollinations, no key) → falls back to built-in voices
- Built-in offline team + starter templates
- Custom API (Groq, OpenRouter, Gemini, NVIDIA, OpenAI-compatible, Anthropic)

### Workflow
1. Describe a problem / app.
2. Team researches (optional web notes) → discusses → votes until agreement.
3. Plans features, screens, data, acceptance criteria → votes again.
4. Only then **Build & Preview** appears. Builder writes code → sandbox tests → Skeptic reviews → Preview opens.
- Notes while plan is locked reopen the plan.
- Changes after a build trigger a rebuild.
- Stop / Continue work as before.

### Improving an existing app
Say “Improve this app” or upload an HTML file. The team inspects real code. With Free AI or your key the Builder uses SEARCH/REPLACE edit blocks.

## Tips
- Keep “One AI call per member” off and plan rounds at 3 to stay within free-tier limits.
- For pure research topics use the Research template or the Research button; the team still runs the full staged flow unless you stop it.
- Research is public-source only (Wikipedia + DDG). It is useful for facts and current abstracts, not a full news crawler.
