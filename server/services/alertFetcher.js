const { buildSalvos, parseIsraelTimestamp } = require('../../shared');
const { API_BASE, REALTIME_URL, HTTP_TIMEOUT_MS } = require('../config');

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function fetchAlerts(from, to) {
    const res = await fetch(`${API_BASE}?from=${from}&to=${to}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');
    const alerts = [];
    for (const day of json.payload) {
        for (const a of day.alerts) {
            if (a.alertTypeId !== 1 && a.alertTypeId !== 2) continue;
            alerts.push({ location: a.name, timestamp: parseIsraelTimestamp(a.timeStamp), type: a.alertTypeId });
        }
    }
    return alerts;
}

async function fetchRealtimeCached() {
    const res = await fetch(REALTIME_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');
    const alerts = [];
    for (const group of json.payload) {
        for (const a of group.alerts) {
            if (a.alertTypeId !== 1 && a.alertTypeId !== 2) continue;
            alerts.push({ location: a.name, timestamp: parseIsraelTimestamp(a.timeStamp), type: a.alertTypeId });
        }
    }
    return alerts;
}

const _seenAlertKeys = new Set();

function mergeAlerts(existing, incoming) {
    if (_seenAlertKeys.size === 0) {
        for (const a of existing) _seenAlertKeys.add(`${a.timestamp}:${a.location}`);
    }
    let added = 0;
    for (const a of incoming) {
        const key = `${a.timestamp}:${a.location}`;
        if (!_seenAlertKeys.has(key)) {
            existing.push(a);
            _seenAlertKeys.add(key);
            added++;
        }
    }
    if (added > 0) existing.sort((a, b) => a.timestamp - b.timestamp);
    return added;
}

const state = {
    allAlerts: [],
    parsedCache: null,
    lastFetch: null,
};

async function fetchHistorical(HISTORY_DAYS) {
    const now = new Date();
    const from = new Date(now.getTime() - HISTORY_DAYS * 86400000);
    const [historical, realtime] = await Promise.all([
        fetchAlerts(isoDate(from), isoDate(now)),
        fetchRealtimeCached().catch(() => [])
    ]);
    mergeAlerts(state.allAlerts, historical);
    mergeAlerts(state.allAlerts, realtime);
    state.parsedCache = buildSalvos(state.allAlerts);
    state.lastFetch = Date.now();
    console.log(`Historical fetch: ${state.allAlerts.length} alerts, ${state.parsedCache.salvos.length} salvos`);
}

async function fetchRecent() {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 86400000);
    const [historical, realtime] = await Promise.all([
        fetchAlerts(isoDate(from), isoDate(now)).catch(() => []),
        fetchRealtimeCached().catch(() => [])
    ]);
    const added = mergeAlerts(state.allAlerts, historical) + mergeAlerts(state.allAlerts, realtime);
    if (added > 0) state.parsedCache = buildSalvos(state.allAlerts);
    state.lastFetch = Date.now();
}

function getParsedCache() {
    return state.parsedCache || buildSalvos(state.allAlerts);
}

module.exports = { fetchHistorical, fetchRecent, getParsedCache, mergeAlerts, state };
