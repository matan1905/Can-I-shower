import { describe, it, expect } from 'vitest';
import {
    buildSalvos,
    computeRisk,
    extractGaps,
    salvosForCalculations,
    parseIsraelTimestamp,
    hungerToRisk,
    advanceState,
    simulateHungerState,
    simulateHunger,
    DEFAULT_PARAMS,
} from '../shared.js';

// A fixed epoch in Israel time for deterministic tests
// 2026-02-28 10:00:00 Israel time = 1772265600
const BASE_TS = 1772265600;
const MIN = 60;
const HOUR = 3600;

function makeAlert(location, timestamp) {
    return { location, timestamp, type: 1 };
}

describe('parseIsraelTimestamp', () => {
    it('parses a date string and returns a unix epoch (seconds)', () => {
        const ts = parseIsraelTimestamp('2026-02-28 10:00:00');
        expect(typeof ts).toBe('number');
        expect(ts).toBeGreaterThan(0);
    });

    it('returns the same value for equivalent Israel time strings', () => {
        const ts1 = parseIsraelTimestamp('2026-02-28 10:00:00');
        const ts2 = parseIsraelTimestamp('2026-02-28T10:00:00');
        expect(ts1).toBe(ts2);
    });

    it('produces different values for different times', () => {
        const ts1 = parseIsraelTimestamp('2026-02-28 10:00:00');
        const ts2 = parseIsraelTimestamp('2026-02-28 11:00:00');
        expect(ts2 - ts1).toBe(3600);
    });
});

describe('buildSalvos', () => {
    it('returns empty salvos for empty alerts', () => {
        const { salvos, locations } = buildSalvos([]);
        expect(salvos).toHaveLength(0);
        expect(locations).toHaveLength(0);
    });

    it('groups alerts within 120s into a single salvo', () => {
        const alerts = [
            makeAlert('A', BASE_TS),
            makeAlert('B', BASE_TS + 60),
            makeAlert('C', BASE_TS + 119),
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos).toHaveLength(1);
        expect(salvos[0].locations.has('A')).toBe(true);
        expect(salvos[0].locations.has('B')).toBe(true);
        expect(salvos[0].locations.has('C')).toBe(true);
    });

    it('splits alerts more than 120s apart into separate salvos', () => {
        const alerts = [
            makeAlert('A', BASE_TS),
            makeAlert('B', BASE_TS + 121),
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos).toHaveLength(2);
    });

    it('returns sorted unique locations', () => {
        const alerts = [
            makeAlert('Zion', BASE_TS),
            makeAlert('Acre', BASE_TS + 200),
        ];
        const { locations } = buildSalvos(alerts);
        expect(locations).toEqual(['Acre', 'Zion']);
    });

    it('uses the first alert timestamp as salvo timestamp', () => {
        const alerts = [
            makeAlert('A', BASE_TS),
            makeAlert('B', BASE_TS + 60),
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos[0].timestamp).toBe(BASE_TS);
    });

    it('sets isPreWarning true when all alerts in salvo have type 14', () => {
        const alerts = [
            { location: 'A', timestamp: BASE_TS, type: 14 },
            { location: 'B', timestamp: BASE_TS + 60, type: 14 },
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos).toHaveLength(1);
        expect(salvos[0].isPreWarning).toBe(true);
    });

    it('sets isPreWarning false when salvo has mixed or non-14 types', () => {
        const alerts = [
            { location: 'A', timestamp: BASE_TS, type: 1 },
            { location: 'B', timestamp: BASE_TS + 60, type: 14 },
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos).toHaveLength(1);
        expect(salvos[0].isPreWarning).toBe(false);
    });

    it('sets isPreWarning true when all alerts have type newsFlash (RedAlert)', () => {
        const alerts = [
            { location: 'A', timestamp: BASE_TS, type: 'newsFlash' },
            { location: 'B', timestamp: BASE_TS + 60, type: 'newsFlash' },
        ];
        const { salvos } = buildSalvos(alerts);
        expect(salvos).toHaveLength(1);
        expect(salvos[0].isPreWarning).toBe(true);
    });
});

describe('salvosForCalculations', () => {
    it('returns same array when no pre-warnings', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']), isPreWarning: false },
            { timestamp: BASE_TS + 30 * MIN, locations: new Set(['B']), isPreWarning: false },
        ];
        const out = salvosForCalculations(salvos);
        expect(out).toHaveLength(2);
        expect(out[0].timestamp).toBe(BASE_TS);
        expect(out[1].timestamp).toBe(BASE_TS + 30 * MIN);
    });

    it('returns same array when salvos have no isPreWarning (backward compat)', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 30 * MIN, locations: new Set(['B']) },
        ];
        const out = salvosForCalculations(salvos);
        expect(out).toHaveLength(2);
    });

    it('drops pre-warning when actual follows within 10 min', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']), isPreWarning: true },
            { timestamp: BASE_TS + 5 * MIN, locations: new Set(['B']), isPreWarning: false },
        ];
        const out = salvosForCalculations(salvos);
        expect(out).toHaveLength(1);
        expect(out[0].timestamp).toBe(BASE_TS + 5 * MIN);
        expect(out[0].isPreWarning).toBe(false);
    });

    it('keeps pre-warning when actual follows after 10 min', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']), isPreWarning: true },
            { timestamp: BASE_TS + 15 * MIN, locations: new Set(['B']), isPreWarning: false },
        ];
        const out = salvosForCalculations(salvos);
        expect(out).toHaveLength(2);
        expect(out[0].isPreWarning).toBe(true);
        expect(out[1].isPreWarning).toBe(false);
    });

    it('keeps pre-warning when no actual follows', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']), isPreWarning: true },
        ];
        const out = salvosForCalculations(salvos);
        expect(out).toHaveLength(1);
        expect(out[0].isPreWarning).toBe(true);
    });
});

describe('extractGaps', () => {
    it('returns empty array for fewer than 2 salvos', () => {
        expect(extractGaps([])).toHaveLength(0);
        const { salvos } = buildSalvos([makeAlert('A', BASE_TS)]);
        expect(extractGaps(salvos)).toHaveLength(0);
    });

    it('returns gaps in minutes between consecutive salvos', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 10 * MIN, locations: new Set(['B']) },
            { timestamp: BASE_TS + 25 * MIN, locations: new Set(['C']) },
        ];
        const gaps = extractGaps(salvos);
        expect(gaps).toHaveLength(2);
        expect(gaps[0]).toBeCloseTo(10);
        expect(gaps[1]).toBeCloseTo(15);
    });
});

describe('hungerToRisk', () => {
    it('returns 0 for hunger=0', () => {
        expect(hungerToRisk(0, 15, DEFAULT_PARAMS)).toBe(0);
    });

    it('returns close to 1 for hunger near 1', () => {
        const risk = hungerToRisk(0.999, 15, DEFAULT_PARAMS);
        expect(risk).toBeGreaterThan(0.9);
    });

    it('risk increases with duration', () => {
        const r5 = hungerToRisk(0.5, 5, DEFAULT_PARAMS);
        const r15 = hungerToRisk(0.5, 15, DEFAULT_PARAMS);
        const r30 = hungerToRisk(0.5, 30, DEFAULT_PARAMS);
        expect(r15).toBeGreaterThan(r5);
        expect(r30).toBeGreaterThan(r15);
    });

    it('risk is clamped to [0, 0.99]', () => {
        const risk = hungerToRisk(1, 1000, DEFAULT_PARAMS);
        expect(risk).toBeLessThanOrEqual(0.99);
        expect(risk).toBeGreaterThanOrEqual(0);
    });
});

describe('advanceState', () => {
    it('hunger grows over time when satiation is 0', () => {
        const { hunger: h0 } = advanceState(0, 0, 60, DEFAULT_PARAMS.growth_rate, DEFAULT_PARAMS.satiation_decay);
        expect(h0).toBeGreaterThan(0);
    });

    it('hunger does not exceed 1', () => {
        const { hunger } = advanceState(0.99, 0, 1000, DEFAULT_PARAMS.growth_rate, DEFAULT_PARAMS.satiation_decay);
        expect(hunger).toBeLessThanOrEqual(1);
    });

    it('satiation decays over time', () => {
        const { satiation } = advanceState(0, 5, 60, DEFAULT_PARAMS.growth_rate, DEFAULT_PARAMS.satiation_decay);
        expect(satiation).toBeLessThan(5);
        expect(satiation).toBeGreaterThan(0);
    });

    it('high satiation suppresses hunger growth', () => {
        const { hunger: withSatiation } = advanceState(0, 10, 60, DEFAULT_PARAMS.growth_rate, DEFAULT_PARAMS.satiation_decay);
        const { hunger: noSatiation } = advanceState(0, 0, 60, DEFAULT_PARAMS.growth_rate, DEFAULT_PARAMS.satiation_decay);
        expect(withSatiation).toBeLessThan(noSatiation);
    });
});

describe('simulateHungerState', () => {
    it('returns hunger=0 and satiation=0 for empty salvos at start', () => {
        const { hunger, satiation } = simulateHungerState([], BASE_TS, DEFAULT_PARAMS);
        expect(hunger).toBe(0);
        expect(satiation).toBe(0);
    });

    it('hunger is higher after a long quiet period', () => {
        const salvos = [{ timestamp: BASE_TS, locations: new Set(['A']) }];
        const { hunger: h1 } = simulateHungerState(salvos, BASE_TS + HOUR, DEFAULT_PARAMS);
        const { hunger: h24 } = simulateHungerState(salvos, BASE_TS + 24 * HOUR, DEFAULT_PARAMS);
        expect(h24).toBeGreaterThan(h1);
    });

    it('hunger drops right after a salvo', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 2 * HOUR, locations: new Set(['B']) },
        ];
        const { hunger: beforeSalvo } = simulateHungerState(salvos, BASE_TS + 2 * HOUR - 1, DEFAULT_PARAMS);
        const { hunger: afterSalvo } = simulateHungerState(salvos, BASE_TS + 2 * HOUR + 1, DEFAULT_PARAMS);
        expect(afterSalvo).toBeLessThan(beforeSalvo);
    });

    it('ignores salvos after nowSec', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 10 * HOUR, locations: new Set(['B']) },
        ];
        const { hunger: h1 } = simulateHungerState(salvos, BASE_TS + HOUR, DEFAULT_PARAMS);
        const salvosOnlyFirst = [salvos[0]];
        const { hunger: h2 } = simulateHungerState(salvosOnlyFirst, BASE_TS + HOUR, DEFAULT_PARAMS);
        expect(h1).toBeCloseTo(h2, 5);
    });
});

describe('computeRisk', () => {
    it('returns risk=0 for no salvos', () => {
        const result = computeRisk([], 15, BASE_TS, DEFAULT_PARAMS);
        expect(result.risk).toBe(0);
        expect(result.salvoCount).toBe(0);
    });

    it('returns risk for single salvo (quiet period discount)', () => {
        const salvos = [{ timestamp: BASE_TS, locations: new Set(['A']) }];
        const result = computeRisk(salvos, 15, BASE_TS + HOUR, DEFAULT_PARAMS);
        expect(result.risk).toBeGreaterThanOrEqual(0);
        expect(result.risk).toBeLessThanOrEqual(0.99);
    });

    it('applies quiet period discount after 12h+ blocks of silence', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + MIN, locations: new Set(['B']) },
        ];
        // At 13h elapsed: 1 quiet block (0.6x discount applied)
        const r13h = computeRisk(salvos, 15, BASE_TS + 13 * HOUR, DEFAULT_PARAMS);
        // At 25h elapsed: 2 quiet blocks (0.6^2 discount applied)
        const r25h = computeRisk(salvos, 15, BASE_TS + 25 * HOUR, DEFAULT_PARAMS);
        // The quiet discount compounds, so 25h should be lower than 13h
        expect(r25h.risk).toBeLessThan(r13h.risk);
    });

    it('returns gapStats for 2+ salvos', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 30 * MIN, locations: new Set(['B']) },
        ];
        const result = computeRisk(salvos, 15, BASE_TS + HOUR, DEFAULT_PARAMS);
        expect(result.gapStats).not.toBeNull();
        expect(result.gapStats.count).toBe(1);
        expect(result.gapStats.mean).toBeCloseTo(30);
    });

    it('returns lastAlertLocations from the most recent salvo', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 30 * MIN, locations: new Set(['B', 'C']) },
        ];
        const result = computeRisk(salvos, 15, BASE_TS + HOUR, DEFAULT_PARAMS);
        expect(result.lastAlertLocations).toContain('B');
        expect(result.lastAlertLocations).toContain('C');
    });

    it('hungerInfo is populated', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']) },
            { timestamp: BASE_TS + 30 * MIN, locations: new Set(['B']) },
        ];
        const result = computeRisk(salvos, 15, BASE_TS + HOUR, DEFAULT_PARAMS);
        expect(result.hungerInfo).not.toBeNull();
        expect(typeof result.hungerInfo.hunger).toBe('number');
    });

    it('uses full salvos for lastAlert and calc salvos for gapStats when pre-warning followed by actual', () => {
        const salvos = [
            { timestamp: BASE_TS, locations: new Set(['A']), isPreWarning: true },
            { timestamp: BASE_TS + 5 * MIN, locations: new Set(['B']), isPreWarning: false },
            { timestamp: BASE_TS + 65 * MIN, locations: new Set(['C']), isPreWarning: false },
        ];
        const nowSec = BASE_TS + 2 * HOUR;
        const result = computeRisk(salvos, 15, nowSec, DEFAULT_PARAMS);
        expect(result.lastAlertTime).toBe(BASE_TS + 65 * MIN);
        expect(result.minutesSinceLastAlert).toBeCloseTo((2 * HOUR - 65 * MIN) / 60);
        expect(result.salvoCount).toBe(2);
        expect(result.gapStats).not.toBeNull();
        expect(result.gapStats.count).toBe(1);
        expect(result.gapStats.mean).toBeCloseTo(60);
    });
});
