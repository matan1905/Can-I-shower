## Risk Model Quiet-Period Decay - Design

**Goal:** Introduce a simple, static decay factor based on long quiet periods (no alerts) so that risk gradually shrinks when there has been no activity for many hours, without changing the core hunger/barrage dynamics.

### Behavior

- Define `elapsedMin` as minutes since the last salvo *for the series of salvos used in the prediction*:
  - For global `/api/predict` (no `location` param), this is since the last salvo anywhere.
  - For `/api/predict?location=...`, this is since the last salvo that included any of the selected locations (because we already filter `salvos` by location before calling `computeRisk`).
- Compute a quiet-period factor:
  - `quietBlocks = floor(elapsedMin / 720)` where 720 minutes = 12 hours.
  - `quietFactor = 0.5 ** quietBlocks`.
- Apply this factor:
  - `riskFinal = riskBase * quietFactor`.
  - `expectedNextAlertFinal = expectedNextAlertBase / quietFactor` (when `expectedNextAlertBase` is not `null`).
    - Intuition: if the model thinks “high risk” would normally arrive in ~X minutes, but we are N·12h into a very long quiet period, we push the “high risk” point out roughly by the same factor that we suppressed current risk with.
- Apply the same logic even in degenerate cases (`salvos.length < 2`) whenever we have a well-defined `elapsedMin`.

### API Impact

- `computeRisk` in `shared.js` continues to expose:
  - `risk` (now after quiet-period decay).
  - `expectedNextAlert` (now stretched by the inverse quiet factor).
  - `minutesSinceLastAlert` (unchanged, still based on the actual elapsed time).
- The frontend already uses:
  - `risk` for the gauge and textual risk level.
  - `expectedNextAlert` via `fmtHighRisk` for the “High risk in … / סיכון גבוה בעוד” card.
- No changes are required to the `/api/predict` or `/api/locations` endpoints; they simply receive the adjusted values from `computeRisk`.

### Edge Cases

- When `elapsedMin < 12h` → `quietBlocks = 0`, `quietFactor = 1` (no change).
- For very long quiet periods (`quietBlocks` large), `risk` can become extremely small and `expectedNextAlert` very large:
  - This is acceptable for now and matches the user’s explicit “divide by 2^(number of 12 hours with no alert)” request.
  - If needed later, we can cap `quietBlocks` or clamp `expectedNextAlert` to a maximum horizon, but that is out of scope for this change.

