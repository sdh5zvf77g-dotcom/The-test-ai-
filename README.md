# AI Council v3 (staged team)

## Upload to GitHub Pages
Upload ALL files to the ROOT of your repo (not the zip itself, not inside a folder):
index.html, app.js, sw.js, manifest.webmanifest, apple-touch-icon.png, icon-192.png, icon-512.png.
Settings > Pages > Deploy from branch > main > / (root). Open the https://USERNAME.github.io/REPO/ link in Safari.
If you already installed an older version: delete the Home Screen icon, open the link in Safari, Add to Home Screen again.
Header should show "AI Council" with a stage bar (Research > Plan > Build) once you send a problem.

## How it works
1. Send a problem. The team researches (optional web notes), talks in rounds, and VOTES. Research ends only when everyone agrees.
2. The team then plans (features, screens, data, acceptance criteria) and VOTES again.
3. Only then does Build & Preview appear (toolbar and a green card at the end of the chat).
4. Build: Builder writes the app, a sandbox tests it, the Skeptic reviews, fixes loop, then Preview opens automatically.
- Type a note while the plan is locked: it reopens the plan. Type a change after a build: it rebuilds.
- Stop pauses the team; Continue resumes.

## Engines
- Free AI (default): public text service, no key. Can be busy or change; if it fails the team keeps talking with built-in voices.
- Built-in team (offline): scripted voices + starter apps (task list, tracker, timer, tip calculator, notes). Always works, no internet.
- Custom API: your key (Groq, OpenRouter, Gemini, NVIDIA, OpenAI-compatible, Anthropic). Key stays in this browser.
Messages from built-in voices are tagged "offline voice". Offline builds are templates, not custom AI-written apps.

## Fixed from the zip you sent
- The preview window was always drawn over the page (CSS display bug).
- The build test could never pass (sandbox was unreadable), so every build was rejected.
- Free AI put the whole prompt in the URL and failed; now uses POST, retries, then falls back.
- Team spoke one member per tap with no agreement gates; Build was available from the start.

## Improving an existing app
- Say "Improve this app" (or upload files): the team loads/inspects the REAL code and plans from automatic findings.
- Built-in (offline) team can inspect but not rewrite code. With Free AI or your key, upload ONE html file and the Builder edits it with search/replace blocks.
- The built-in team no longer invents a to-do list for ideas it cannot build; it says so and asks you to connect an AI.
