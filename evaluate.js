const fs = require('fs');
const {
    buildSalvos, computeRisk, hasAlertInWindow, parseIsraelTimestamp,
    extractGaps, salvosForCalculations, DEFAULT_PARAMS,
} = require('./shared');

const REDALERT_BASE = process.env.REDALERT_BASE || 'https://redalert.orielhaim.com';
const REDALERT_API_KEY = process.env.REDALERT_API_KEY || '';
const HTTP_TIMEOUT_MS = 30000;

function loadModelParams() {
    try {
        const model = JSON.parse(fs.readFileSync('model.json', 'utf8'));
        return model.params || DEFAULT_PARAMS;
    } catch (_) {
        return DEFAULT_PARAMS;
    }
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

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

async function fetchDateRange(fromDate, toDate) {
    console.log(`  Fetching ${isoDate(fromDate)} \u2192 ${isoDate(toDate)}...`);
    const alerts = await fetchAlerts(isoDate(fromDate), isoDate(toDate));
    console.log(`  Got ${alerts.length} alerts`);
    return alerts;
}

function logUniformSample(min, max) {
    return Math.exp(Math.log(min) + Math.random() * (Math.log(max) - Math.log(min)));
}

function evaluatePeriod(allSalvos, timestamps, params, label) {
    const warmup = 2 * 3600;
    const extraAfter = 12 * 3600;
    const minNow = allSalvos[0].timestamp + warmup;
    const maxNow = allSalvos[allSalvos.length - 1].timestamp + extraAfter;
    const durationsPerPoint = 5;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${'='.repeat(60)}`);

    const preds = [], actuals = [];

    const elBuckets = [
        { label: '0-5m',   lo: 0,   hi: 5,        preds: [], actuals: [] },
        { label: '5-15m',  lo: 5,   hi: 15,       preds: [], actuals: [] },
        { label: '15-60m', lo: 15,  hi: 60,       preds: [], actuals: [] },
        { label: '1-4h',   lo: 60,  hi: 240,      preds: [], actuals: [] },
        { label: '4h+',    lo: 240, hi: Infinity,  preds: [], actuals: [] },
    ];

    const durBuckets = [
        { label: '1-10m',   lo: 1,   hi: 10,       preds: [], actuals: [] },
        { label: '10-30m',  lo: 10,  hi: 30,       preds: [], actuals: [] },
        { label: '30-120m', lo: 30,  hi: 120,      preds: [], actuals: [] },
        { label: '120m+',   lo: 120, hi: Infinity,  preds: [], actuals: [] },
    ];

    for (let nowSec = minNow; nowSec <= maxNow; nowSec += 60) {
        const pastSalvos = allSalvos.filter(s => s.timestamp <= nowSec);
        if (pastSalvos.length < 2) continue;

        const lastTs = pastSalvos[pastSalvos.length - 1].timestamp;
        const elapsed = (nowSec - lastTs) / 60;

        for (let d = 0; d < durationsPerPoint; d++) {
            const duration = logUniformSample(1, 1440);
            const occurred = hasAlertInWindow(timestamps, nowSec, nowSec + duration * 60) ? 1 : 0;

            const pred = computeRisk(pastSalvos, duration, nowSec, params);
            preds.push(pred.risk);
            actuals.push(occurred);

            for (const eb of elBuckets) {
                if (elapsed >= eb.lo && elapsed < eb.hi) { eb.preds.push(pred.risk); eb.actuals.push(occurred); break; }
            }
            for (const db of durBuckets) {
                if (duration >= db.lo && duration < db.hi) { db.preds.push(pred.risk); db.actuals.push(occurred); break; }
            }
        }
    }

    printCalibration('hunger', preds, actuals);

    console.log(`\n  By elapsed time:`);
    console.log(`  ${'Elapsed'.padEnd(10)} ${'N'.padStart(6)} ${'Pred'.padStart(7)} ${'Actual'.padStart(7)} ${'Brier'.padStart(7)}`);
    for (const eb of elBuckets) {
        if (eb.preds.length === 0) continue;
        const avgPred = eb.preds.reduce((a, b) => a + b, 0) / eb.preds.length;
        const avgActual = eb.actuals.reduce((a, b) => a + b, 0) / eb.actuals.length;
        const brier = eb.preds.reduce((s, p, i) => s + (p - eb.actuals[i]) ** 2, 0) / eb.preds.length;
        console.log(`  ${eb.label.padEnd(10)} ${String(eb.preds.length).padStart(6)} ${pct(avgPred).padStart(7)} ${pct(avgActual).padStart(7)} ${brier.toFixed(4).padStart(7)}`);
    }

    console.log(`\n  By duration:`);
    console.log(`  ${'Duration'.padEnd(10)} ${'N'.padStart(6)} ${'Pred'.padStart(7)} ${'Actual'.padStart(7)} ${'Brier'.padStart(7)}`);
    for (const db of durBuckets) {
        if (db.preds.length === 0) continue;
        const avgPred = db.preds.reduce((a, b) => a + b, 0) / db.preds.length;
        const avgActual = db.actuals.reduce((a, b) => a + b, 0) / db.actuals.length;
        const brier = db.preds.reduce((s, p, i) => s + (p - db.actuals[i]) ** 2, 0) / db.preds.length;
        console.log(`  ${db.label.padEnd(10)} ${String(db.preds.length).padStart(6)} ${pct(avgPred).padStart(7)} ${pct(avgActual).padStart(7)} ${brier.toFixed(4).padStart(7)}`);
    }

    printSanityTrajectory(allSalvos, params);
}

function printCalibration(name, predictions, actuals) {
    const numBins = 10;
    const bins = Array.from({ length: numBins }, () => ({ count: 0, sumPred: 0, sumOutcome: 0 }));
    let brierSum = 0;

    for (let i = 0; i < predictions.length; i++) {
        const r = Math.max(0, Math.min(1, predictions[i]));
        brierSum += (r - actuals[i]) ** 2;
        const bin = Math.min(numBins - 1, Math.floor(r * numBins));
        bins[bin].count++;
        bins[bin].sumPred += r;
        bins[bin].sumOutcome += actuals[i];
    }

    const brier = brierSum / predictions.length;
    const baseRate = actuals.reduce((a, b) => a + b, 0) / actuals.length;
    const baselineBrier = baseRate * (1 - baseRate);
    const skill = 1 - brier / Math.max(0.001, baselineBrier);

    console.log(`\n  ${name}: Brier=${brier.toFixed(4)}, Skill=${skill.toFixed(3)}, BaseRate=${pct(baseRate)}, N=${predictions.length}`);
    console.log(`  ${'Bin'.padEnd(10)} ${'N'.padStart(5)} ${'Pred'.padStart(7)} ${'Actual'.padStart(7)} ${'\u0394'.padStart(8)}`);

    for (let b = 0; b < numBins; b++) {
        const info = bins[b];
        if (!info.count) continue;
        const avgPred = info.sumPred / info.count;
        const empirical = info.sumOutcome / info.count;
        const delta = empirical - avgPred;
        console.log(
            `  ${(b * 10 + '-' + (b + 1) * 10 + '%').padEnd(10)} ${String(info.count).padStart(5)} ${pct(avgPred).padStart(7)} ${pct(empirical).padStart(7)} ${((delta >= 0 ? '+' : '') + pct(delta)).padStart(8)}`
        );
    }
}

function printSanityTrajectory(allSalvos, params) {
    console.log(`\n  Sanity trajectory (duration=10m):`);
    const lastSalvo = allSalvos[allSalvos.length - 1];
    const testElapsed = [0, 2, 5, 10, 20, 30, 60, 120, 240, 480, 720, 1440];

    console.log(`  ${'Elapsed'.padEnd(8)} ${'Risk'.padStart(7)} ${'Hunger'.padStart(8)}`);
    for (const e of testElapsed) {
        const fakeNow = lastSalvo.timestamp + e * 60;
        const pastSalvos = allSalvos.filter(s => s.timestamp <= fakeNow);
        if (pastSalvos.length < 2) continue;
        const pred = computeRisk(pastSalvos, 10, fakeNow, params);
        const hunger = pred.hungerInfo ? pred.hungerInfo.hunger.toFixed(4) : 'N/A';
        console.log(`  ${String(e).padStart(5)}m  ${pct(pred.risk).padStart(7)} ${String(hunger).padStart(8)}`);
    }
}

async function main() {
    console.log('=== EVALUATING HUNGER MODEL ===\n');

    console.log('Fetching historical data...');
    const [alerts1, alerts2] = await Promise.all([
        fetchDateRange(new Date(Date.UTC(2025, 5, 15)), new Date(Date.UTC(2025, 5, 23))),
        fetchDateRange(new Date(Date.UTC(2026, 1, 28)), new Date(Date.UTC(2026, 2, 15)))
    ]);

    console.log(`\nTotal alerts: ${alerts1.length + alerts2.length}`);
    const parsed1 = buildSalvos(alerts1);
    const parsed2 = buildSalvos(alerts2);
    console.log(`Period 1 (Jun 2025): ${parsed1.salvos.length} salvos`);
    console.log(`Period 2 (Feb 2026+): ${parsed2.salvos.length} salvos`);

    for (const [label, parsed] of [['Period 1', parsed1], ['Period 2', parsed2]]) {
        const calcSalvos = salvosForCalculations(parsed.salvos);
        const gaps = extractGaps(calcSalvos);
        if (gaps.length === 0) continue;
        const sorted = [...gaps].sort((a, b) => a - b);
        const spanHours = ((parsed.salvos[parsed.salvos.length - 1].timestamp - parsed.salvos[0].timestamp) / 3600).toFixed(1);
        console.log(`\n  ${label}: ${gaps.length} gaps over ${spanHours}h`);
        console.log(`    gaps: min=${sorted[0].toFixed(1)}m, median=${sorted[Math.floor(gaps.length / 2)].toFixed(1)}m, mean=${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)}m, max=${sorted[gaps.length - 1].toFixed(1)}m`);
    }

    const timestamps1 = parsed1.salvos.map(s => s.timestamp);
    const timestamps2 = parsed2.salvos.map(s => s.timestamp);

    const params = loadModelParams();
    console.log(`\nUsing params from model.json: ${JSON.stringify(params)}`);

    if (parsed1.salvos.length >= 5)
        evaluatePeriod(parsed1.salvos, timestamps1, params, 'Period 1 (Jun 2025)');

    if (parsed2.salvos.length >= 5)
        evaluatePeriod(parsed2.salvos, timestamps2, params, 'Period 2 (Feb 2026+)');

    console.log('\n\nDone.');
}

main().catch(e => { console.error('Evaluation failed:', e); process.exit(1); });
