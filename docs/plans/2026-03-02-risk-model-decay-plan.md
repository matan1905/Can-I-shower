# Risk Model Quiet-Period Decay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply a 12-hour quiet-period decay factor to the hunger+barrage risk model, and ensure the “High risk in…” UI card reflects the adjusted `expectedNextAlert`.

**Architecture:** Keep all core model logic in `shared.js` (`computeRisk`, `estimateExpectedWait`). Introduce a post-processing step inside `computeRisk` that applies the quiet-period factor to both `risk` and `expectedNextAlert` using the elapsed time since the last salvo. The API and frontend bindings remain unchanged; they simply consume the updated values.

**Tech Stack:** Node.js, Express (`server.js`), petite-vue frontend (`public/index.html`).

---

### Task 1: Add quiet-period decay to the main `computeRisk` path

**Files:**
- Modify: `shared.js`

**Step 1: Identify base outputs in `computeRisk`**
- Locate the main branch of `computeRisk` where:
  - `elapsed` is computed from `nowSec - lastTs`.
  - `risk` is computed from the barrage+tension mixture.
  - `expectedWait` is computed using `estimateExpectedWait`.

**Step 2: Introduce quiet-period factor**
- After computing `elapsed`, `risk`, and `expectedWait`, add logic:
  - `quietBlocks = Math.floor(Math.max(0, elapsed) / (12 * 60));`
  - `quietFactor = Math.pow(0.5, quietBlocks);`
  - `risk *= quietFactor;`
  - If `expectedWait != null`, set `expectedWait /= quietFactor;`.

**Step 3: Return adjusted values**
- Ensure the object returned by `computeRisk` uses the adjusted `risk` and `expectedWait` while leaving `minutesSinceLastAlert` and `hungerInfo` unchanged.

### Task 2: Apply quiet-period decay in the degenerate (`salvos.length < 2`) case

**Files:**
- Modify: `shared.js`

**Step 1: Capture `elapsed` when there is a single salvo**
- In the `salvos.length < 2` branch, compute:
  - `elapsed = last ? (nowSec - last.timestamp) / 60 : null;`
  - `risk = last ? 0.5 : 0;`

**Step 2: Apply the same quiet-period factor**
- If `elapsed != null`:
  - Compute `quietBlocks` and `quietFactor` as above.
  - Multiply `risk` by `quietFactor`.
  - Keep `expectedWait` as `null` (no change).

**Step 3: Return adjusted values**
- Return `risk` and `minutesSinceLastAlert: elapsed` so that per-location and global predictions both respect the quiet-period decay when there is only one historical salvo.

### Task 3: Verify frontend “High risk in…” uses adjusted `expectedNextAlert`

**Files:**
- Inspect: `public/index.html`

**Step 1: Confirm data binding**
- Verify that the “High risk in…” / “סיכון גבוה בעוד” card reads:
  - The label from `t.expectedAlert`.
  - The value from `fmtHighRisk(data.expectedNextAlert)`.

**Step 2: Ensure no additional changes needed**
- Since the API will now return an adjusted `expectedNextAlert`, confirm that no extra frontend logic is required for the quiet-period behavior.

### Task 4: Quick manual sanity checks

**Files / Commands:**
- Use: `node` REPL or a small one-off script that requires `./shared.js`.

**Step 1: Construct a simple salvo history**
- Example: two salvos at times `t0` and `t0 + 30 * 60` seconds.

**Step 2: Compare risk at different quiet periods**
- Call `computeRisk` with:
  - `nowSec` = shortly after the last salvo (e.g., +30 minutes).
  - `nowSec` = +24 hours after the last salvo.
- Check that:
  - The second risk is lower than the first by roughly `1 / 4` (modulo model dynamics).
  - `expectedNextAlert` for the later time is larger than for the earlier time.

**Step 3: Run the server and smoke-test the UI**
- Start the server with `node server.js`.
- Open the UI and:
  - Pick a location with known recent alerts.
  - Observe risk and “High risk in…” values.
  - Temporarily simulate a far-future time via `?debug=true` and the debug panel, confirming both risk and “High risk in…” reflect the reduced risk / pushed-out high-risk time after a long quiet period.

