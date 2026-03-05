const fs = require('fs');
const {
    buildSalvos, computeRisk,
    hasAlertInWindow, parseIsraelTimestamp, DEFAULT_PARAMS,
} = require('./shared');

const REDALERT_BASE = process.env.REDALERT_BASE || 'https://redalert.orielhaim.com';
const REDALERT_API_KEY = process.env.REDALERT_API_KEY || '';
const HTTP_TIMEOUT_MS = 30000;

const POP_SIZE = 150;
const GENERATIONS = 30;
const MUTATION_RATE = 0.35;
const ELITE_COUNT = 15;
const LOCATION_SAMPLES_PER_WINDOW = 5;
const LOCATION_WEIGHT = 0.4;

const PARAM_RANGES = {
    growth_rate:      { min: 0.001,  max: 0.05 },
    drop_per_salvo:   { min: 0.05,   max: 0.95 },
    satiation_boost:  { min: 0.1,    max: 8 },
    satiation_decay:  { min: 0.01,   max: 1.5 },
    base_duration:    { min: 2,      max: 20 },
    barrage_halflife: { min: 2,      max: 200 },
};

const CEASEFIRE_GAP_MIN = 720;

function isoDate(d) { return d.toISOString().slice(0, 10); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

function splitConflictWindows(salvos) {
    const sorted = [...salvos].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) return [];
    const windows = [];
    let start = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gapMin = (sorted[i].timestamp - sorted[i - 1].timestamp) / 60;
        if (gapMin > CEASEFIRE_GAP_MIN) {
            if (i - start >= 3) windows.push(sorted.slice(start, i));
            start = i;
        }
    }
    if (sorted.length - start >= 3) windows.push(sorted.slice(start));
    return windows;
}

async function fetchAlerts(from, to) {
    const startDate = new Date(from).toISOString();
    const endDate = new Date(to + 'T23:59:59').toISOString();
    const alerts = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const url = `${REDALERT_BASE}/api/stats/history?page=${page}&limit=100&category=missiles`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${REDALERT_API_KEY}` },
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`RedAlert API ${res.status}: ${await res.text()}`);
        const json = await res.json();
        totalPages = json.meta.totalPages;

        let reachedCutoff = false;
        for (const entry of json.data) {
            const entryTime = new Date(entry.timestamp).getTime();
            if (entryTime < new Date(startDate).getTime()) { reachedCutoff = true; break; }
            if (entryTime > new Date(endDate).getTime()) continue;
            const ts = parseIsraelTimestamp(entry.timestamp.replace('Z', '').replace('.000', ''));
            for (const city of entry.cities || []) {
                alerts.push({ location: city.name, timestamp: ts, type: entry.type });
            }
        }
        if (reachedCutoff || json.data.length < 100) break;
        page++;
    }
    return alerts;
}

function randomParams() {
    const p = {};
    for (const [key, range] of Object.entries(PARAM_RANGES)) {
        p[key] = range.min + Math.random() * (range.max - range.min);
    }
    return p;
}

function clampParams(p) {
    const c = {};
    for (const [key, range] of Object.entries(PARAM_RANGES)) {
        c[key] = Math.max(range.min, Math.min(range.max, p[key]));
    }
    return c;
}

function crossover(a, b) {
    const child = {};
    for (const key of Object.keys(PARAM_RANGES)) {
        child[key] = Math.random() < 0.5 ? a[key] : b[key];
    }
    return child;
}

function mutate(p) {
    const m = { ...p };
    for (const [key, range] of Object.entries(PARAM_RANGES)) {
        if (Math.random() < MUTATION_RATE) {
            const span = range.max - range.min;
            m[key] += (Math.random() - 0.5) * span * 0.4;
        }
    }
    return clampParams(m);
}

function buildTestPointsForSet(salvos) {
    const timestamps = salvos.map(s => s.timestamp);
    const startSec = salvos[0].timestamp;
    const endSec = salvos[salvos.length - 1].timestamp + 4 * 3600;
    const step = 300;
    const durations = [5, 10, 15, 30, 60];
    const points = [];

    for (let nowSec = startSec; nowSec <= endSec; nowSec += step) {
        const actuals = durations.map(dur =>
            hasAlertInWindow(timestamps, nowSec, nowSec + dur * 60) ? 1 : 0
        );
        points.push({ nowSec, durations, actuals });
    }
    return { salvos, points };
}

function sampleLocationSubsets(salvos, count) {
    const locationMap = new Map();
    for (const s of salvos) {
        if (!s.locations) continue;
        for (const loc of s.locations) {
            if (!locationMap.has(loc)) locationMap.set(loc, []);
            locationMap.get(loc).push(s);
        }
    }

    const viable = [...locationMap.entries()].filter(([, arr]) => arr.length >= 3);
    if (viable.length === 0) return [];

    const subsets = [];
    for (let i = 0; i < count; i++) {
        const [, locSalvos] = viable[Math.floor(Math.random() * viable.length)];
        subsets.push(buildTestPointsForSet(locSalvos));
    }
    return subsets;
}

function evaluateBrier(params, periodData) {
    let brierSum = 0, n = 0;
    for (const { salvos, points } of periodData) {
        for (const { nowSec, durations, actuals } of points) {
            const pastSalvos = [];
            for (const s of salvos) {
                if (s.timestamp > nowSec) break;
                pastSalvos.push(s);
            }
            if (pastSalvos.length < 2) continue;
            for (let d = 0; d < durations.length; d++) {
                const pred = computeRisk(pastSalvos, durations[d], nowSec, params);
                brierSum += (pred.risk - actuals[d]) ** 2;
                n++;
            }
        }
    }
    return n > 0 ? brierSum / n : 1;
}

function evaluateFitness(params, periodData, locationData) {
    const globalBrier = evaluateBrier(params, periodData);
    if (locationData.length === 0) return globalBrier;
    const locationBrier = evaluateBrier(params, locationData);
    return (1 - LOCATION_WEIGHT) * globalBrier + LOCATION_WEIGHT * locationBrier;
}

function loadPreviousBest() {
    try {
        const model = JSON.parse(fs.readFileSync('model.json', 'utf8'));
        if (model.params) return model.params;
    } catch (_) {}
    return null;
}

const SEEDS = [
    { growth_rate: 0.005, drop_per_salvo: 0.3, satiation_boost: 2, satiation_decay: 0.1, base_duration: 10, barrage_halflife: 15 },
    { growth_rate: 0.008, drop_per_salvo: 0.2, satiation_boost: 1, satiation_decay: 0.2, base_duration: 8, barrage_halflife: 30 },
    { growth_rate: 0.015, drop_per_salvo: 0.5, satiation_boost: 3, satiation_decay: 0.08, base_duration: 5, barrage_halflife: 10 },
    { growth_rate: 0.01, drop_per_salvo: 0.15, satiation_boost: 4, satiation_decay: 0.15, base_duration: 12, barrage_halflife: 45 },
    { growth_rate: 0.02, drop_per_salvo: 0.4, satiation_boost: 0.5, satiation_decay: 0.5, base_duration: 7, barrage_halflife: 20 },
];

function geneticSearch(salvoSets) {
    const periodData = salvoSets.map(s => buildTestPointsForSet(s));
    const locationData = salvoSets.flatMap(s => sampleLocationSubsets(s, LOCATION_SAMPLES_PER_WINDOW));
    const totalPoints = periodData.reduce((s, d) => s + d.points.length, 0);
    const locPoints = locationData.reduce((s, d) => s + d.points.length, 0);
    console.log(`  ${periodData.length} periods, ${totalPoints} global test points`);
    console.log(`  ${locationData.length} location subsets, ${locPoints} location test points`);

    const prevBest = loadPreviousBest();
    const seeds = prevBest ? [prevBest, ...SEEDS] : SEEDS;
    const seeded = seeds.map(s => clampParams(s));
    const random = Array.from({ length: POP_SIZE - seeded.length }, () => randomParams());
    let population = [...seeded, ...random];

    let bestEver = null;
    let bestScore = Infinity;

    for (let gen = 0; gen < GENERATIONS; gen++) {
        const scored = population.map(p => ({
            params: p,
            score: evaluateFitness(p, periodData, locationData),
        })).sort((a, b) => a.score - b.score);

        if (scored[0].score < bestScore) {
            bestScore = scored[0].score;
            bestEver = scored[0].params;
        }

        if ((gen + 1) % 5 === 0)
            console.log(`  Gen ${gen + 1}/${GENERATIONS}: best=${scored[0].score.toFixed(4)}, avg=${(scored.reduce((s, x) => s + x.score, 0) / scored.length).toFixed(4)}`);

        const elite = scored.slice(0, ELITE_COUNT).map(s => s.params);
        const newPop = [...elite];

        while (newPop.length < POP_SIZE) {
            const a = elite[Math.floor(Math.random() * elite.length)];
            const b = elite[Math.floor(Math.random() * elite.length)];
            newPop.push(mutate(crossover(a, b)));
        }
        population = newPop;
    }

    console.log(`  Best Brier: ${bestScore.toFixed(4)}`);
    return bestEver;
}

async function main() {
    console.log('=== TRAINING HUNGER MODEL (Genetic Algorithm) ===\n');

    console.log('Fetching historical data...');
    const t0 = Date.now();
    const [alerts1, alerts2] = await Promise.all([
        fetchAlerts(isoDate(new Date(Date.UTC(2025, 5, 15))), isoDate(new Date(Date.UTC(2025, 5, 23)))),
        fetchAlerts(isoDate(new Date(Date.UTC(2026, 1, 28))), isoDate(new Date(Date.UTC(2026, 2, 15)))),
    ]);
    console.log(`  Got ${alerts1.length + alerts2.length} alerts in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const parsed1 = buildSalvos(alerts1);
    const parsed2 = buildSalvos(alerts2);
    console.log(`  Period 1 (Jun 2025): ${parsed1.salvos.length} salvos`);
    console.log(`  Period 2 (Feb 2026+): ${parsed2.salvos.length} salvos`);

    const allSalvoSets = splitConflictWindows([...parsed1.salvos, ...parsed2.salvos]);
    console.log(`  Split into ${allSalvoSets.length} conflict windows:`);
    for (const w of allSalvoSets) {
        const spanH = ((w[w.length - 1].timestamp - w[0].timestamp) / 3600).toFixed(1);
        console.log(`    ${w.length} salvos over ${spanH}h`);
    }

    console.log('\nRunning genetic algorithm...');
    const t1 = Date.now();
    const params = geneticSearch(allSalvoSets);
    console.log(`  Done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    console.log(`  Best params: ${JSON.stringify(params, null, 2)}`);

    const model = {
        params,
        trainedAt: new Date().toISOString(),
        conflictWindows: allSalvoSets.map(s => ({
            from: new Date(s[0].timestamp * 1000).toISOString(),
            to: new Date(s[s.length - 1].timestamp * 1000).toISOString(),
            salvos: s.length,
        })),
    };

    fs.writeFileSync('model.json', JSON.stringify(model, null, 2));
    console.log('\nWrote model.json');

    const lastSet = allSalvoSets[allSalvoSets.length - 1];
    console.log('\nSanity trajectory (duration=10m, last period):');
    const lastSalvo = lastSet[lastSet.length - 1];
    console.log(`  ${'Elapsed'.padEnd(10)} ${'Risk'.padStart(7)} ${'Hunger'.padStart(8)} ${'Barrage'.padStart(9)} ${'BWeight'.padStart(8)}`);
    for (const e of [0, 2, 5, 10, 20, 30, 60, 120, 240, 480, 1440, 4320, 14400]) {
        const fakeNow = lastSalvo.timestamp + e * 60;
        const pastSalvos = lastSet.filter(s => s.timestamp <= fakeNow);
        if (pastSalvos.length < 2) continue;
        const pred = computeRisk(pastSalvos, 10, fakeNow, params);
        const hi = pred.hungerInfo;
        const label = e < 60 ? `${e}m` : e < 1440 ? `${(e / 60).toFixed(0)}h` : `${(e / 1440).toFixed(0)}d`;
        console.log(`  ${label.padEnd(10)} ${pct(pred.risk).padStart(7)} ${hi.hunger.toFixed(4).padStart(8)} ${pct(hi.barrageRisk).padStart(9)} ${hi.barrageWeight.toFixed(3).padStart(8)}`);
    }
}

main().catch(e => { console.error('Training failed:', e); process.exit(1); });
