## Escalation Risk Mixture Model - Design

**Goal:** Replace the old monotone decay-based risk formula with a two-state mixture model that better matches real conflict dynamics and yields more calibrated probabilities.

### Current Behavior (Simplified)

- Build `salvos` from raw alerts using `SALVO_WINDOW_SEC`.
- Use `getActiveSalvos` with a 7-day `clusterGap` and 48-hour `activeWindow` to find an "active cluster".
- Within that cluster:
  - Compute gaps between salvos (minutes).
  - Fit a Weibull distribution (`fitWeibull`) to recent gaps.
  - Compute conditional shower safety `pSafe = weibullCondSurv(elapsed, duration, k, lambda)` where `elapsed` is since the last salvo.
  - Compute `expectedNextAlert` as a blend of Weibull residual and empirical remaining gap.
  - Apply a heuristic "bathtub" `timeFactor` that boosts risk when we are overdue relative to `expectedNextAlert`.
  - Final `risk = min(1, (1 - pSafe) * timeFactor)`.

### Problems

- Single-state model: assumes escalation is always ongoing; does not represent the possibility that the escalation may have ended.
- Time handling conflates:
  - "How long since the last alert?" (gap scale), and
  - "How long since the escalation started?" (cluster scale).
- Old `decay` version suppressed long-elapsed risk incorrectly; current `timeFactor` helps but is still a heuristic.

### Target Behavior

We want behavior consistent with these intuitions:

1. Just after an alert, risk of another during a typical shower is moderate.
2. Around the typical gap, risk is high.
3. When we are overdue relative to typical gaps, risk is very high *if the escalation is still active*.
4. As the time since escalation start becomes very large compared to historical cluster durations, the probability that the escalation is still active should shrink toward zero and so should the risk.

This implies two distinct latent questions:

- Q1: Given that the escalation is still active, what is the chance another salvo hits during the shower window? (Weibull hazard on inter-salvo gaps.)
- Q2: What is the chance that the escalation is still active at all? (Survival on *cluster duration* from first to last salvo.)

### New Model Overview

- Keep the existing Weibull modelling for inter-salvo gaps within the active cluster.
- Add an explicit "cluster active" probability based on historical cluster durations.
- Combine them into a mixture:

- `weibullRisk = 1 - pSafe` (probability of at least one salvo in the shower window assuming the cluster is active).
- `P_active(t)` = probability the cluster is still ongoing at time \( t \) since cluster start.
- `baselineRisk` ≈ 0 for inactive periods.
- Final risk: `risk = P_active(t) * weibullRisk + (1 - P_active(t)) * baselineRisk`.

This decouples "how late we are within a cluster" (handled by Weibull) from "whether the cluster is over" (handled by cluster-duration survival).

### Cluster Duration Model

**Inputs:**

- Full `salvos` array across history, each with `timestamp` and `locations`.
- `clusterGap` (currently 7 days in seconds), defining when a new escalation cluster starts.

**Procedure:**

1. Sort `salvos` by timestamp (already done in `buildSalvos`).
2. Segment into clusters:
   - Start a new cluster whenever the gap between consecutive salvos exceeds `clusterGap`.
3. For each cluster with at least two salvos:
   - Compute `durationSec = last.timestamp - first.timestamp`.
   - Collect all such durations into `clusterDurations`.

**Model choice (data-driven, calibration-focused):**

Given that you prefer calibration over simplicity, we will:

- Compute the empirical survival function \( \hat{S}(t) \) of cluster durations, backed by optional exponential smoothing for very long tails.
- Implementation:
  - Sort `clusterDurations` ascending.
  - For any `t`, define:
    - `numActive = count(d >= t)` (clusters that lasted at least t).
    - `P_active_emp(t) = numActive / N`, where `N` is number of clusters.
  - For `t` beyond the maximum observed duration, fall back to a simple exponential tail:
    - Compute `meanDurationSec`.
    - For `t > maxDurationSec`, define:
      - `P_tail(t) = P_active_emp(maxDurationSec) * exp(-(t - maxDurationSec) / meanDurationSec)`.
  - Final `P_active(t)`:
    - `P_active(t) = P_active_emp(t)` for `t <= maxDurationSec`.
    - `P_active(t) = P_tail(t)` for `t > maxDurationSec`.

We will store:

- `clusterDurationModel = { durations: [...], meanDurationSec, maxDurationSec }`

and a helper:

- `clusterSurvival(t, model)` → `P_active(t)`.

### API / Data Flow Changes

1. **`buildSalvos(alerts)`**
   - After building `salvos`, compute:
     - `clusterDurationModel` from all salvos and `clusterGap`.
   - Return:
     - `{ salvos, locations, clusterDurationModel }`.

2. **`getActiveSalvos(salvos, nowSec)`**
   - Keep existing logic for choosing the active cluster (using `clusterGap` and `activeWindow`).
   - Instead of returning only the array slice, return an object:
     - `{ salvos: activeSalvos, clusterStartTs }`
     - `clusterStartTs` is the timestamp of the first salvo in the chosen cluster (the same index currently used for slicing).

3. **`computePrediction` signature**

- Old:
  - `computePrediction(salvos, duration, now)`
- New:
  - `computePrediction(salvos, duration, now, clusterStartTs, clusterDurationModel)`

**Implementation details:**

- `elapsedGapMin = (now - lastTs) / 60` (as today).
- `gapsMin` still computed as before for Weibull fitting.
- `weibullRisk = 1 - weibullCondSurv(elapsedGapMin, duration, k, lambda)` (no extra timeFactor).
- `tSinceStartSec = now - clusterStartTs`.
- `P_active = clusterSurvival(tSinceStartSec, clusterDurationModel)` (bounded to [0,1]).
- `baselineRisk = 0` initially (we can revisit if we want a non-zero baseline).
- `risk = P_active * weibullRisk + (1 - P_active) * baselineRisk`.

We will still compute `expectedNextAlert` from the Weibull + empirical mix, but interpret it as **conditional** on the escalation being active.

### Expected Next Alert

- Keep the current `computeExpectedNextAlert(recentGaps, elapsed, k, lambda)` which returns a minutes estimate.
- Expose a cluster-aware variant:
  - If `P_active` falls below a small threshold (e.g. 0.05), set `expectedNextAlert = null` in the API response.
  - Otherwise, return the conditional estimate from the gap model.

This makes the UI behavior consistent: during inactive or nearly-inactive times, we no longer show a misleading finite "expected next alert".

### Location-Specific Behavior

For `/api/predict?location=...`:

- Keep the current selection of `filtered` salvos by location.
- For the cluster state:
  - Use the same `clusterStartTs` and `clusterDurationModel` derived from global salvos. This models escalation as a system-wide phenomenon rather than per-location, which matches conflict reality and improves data volume for cluster durations.
  - Optionally (future): we could experiment with per-location cluster durations if needed, but the default will be global.

### Testing and Calibration Plan

We will create a `calibration-test` script (or extend `test.js`) to:

1. Pull historical alerts using the same API and window as the server (e.g. 90 days).
2. Rebuild `salvos` and `clusterDurationModel`.
3. Replay the history in time order for many `(elapsed, duration)` windows:
   - For each salvo time and a given `showerDuration`, record:
     - `now` = that time.
     - Whether at least one salvo occurs within the next `duration` minutes.
     - The model's predicted risk at that moment.
4. Group predictions into bins (e.g. 0–10%, 10–20%, ..., 90–100%) and compute:
   - Actual fraction of windows with at least one alert in each bin.
   - Plot/export a calibration table to check how close predictions are to perfect calibration.
5. Compare:
   - Old model (heuristic `timeFactor`) vs new mixture model on the same replay.
   - Optionally refine `clusterSurvival` (e.g. smoothing) if needed.

### Summary

This design:

- Keeps the successful pieces of the current system (Weibull hazard on gaps, recent-gaps focus).
- Introduces an explicit, data-driven cluster-duration survival model to handle escalation end.
- Produces risk estimates that:
  - Are high both near the typical gap and when overdue *while the escalation remains active*.
  - Naturally decay only as the probability that the escalation itself has ended shrinks toward zero.

