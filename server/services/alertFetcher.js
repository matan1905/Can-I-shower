const fs = require('fs');
const { execSync } = require('child_process');
const { buildSalvos, parseIsraelTimestamp } = require('../../shared');
const {
    REDALERT_BASE, REDALERT_API_KEY, HTTP_TIMEOUT_MS, HISTORY_DAYS,
    ROCKETALERT_API_BASE, ROCKETALERT_REALTIME_URL,
    GIT_ALERTS_REPO, GIT_ALERTS_DIR, GIT_ALERTS_CSV,
} = require('../config');

const REDALERT_HISTORY_URL = `${REDALERT_BASE}/api/stats/history`;
const PAGE_LIMIT = 500;
const PARALLEL_PAGES = 5;

function isoDate(d) { return d.toISOString().slice(0, 10); }

// ── RedAlert (primary) ──────────────────────────────────────────────

async function fetchRedAlertPage(page) {
    const url = `${REDALERT_HISTORY_URL}?page=${page}&limit=${PAGE_LIMIT}&category=missiles`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${REDALERT_API_KEY}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RedAlert API ${res.status}`);
    return res.json();
}

function parseRedAlertEntry(entry) {
    const ts = parseIsraelTimestamp(entry.timestamp.replace('Z', '').replace('.000', ''));
    return (entry.cities || []).map(city => ({ location: city.name, timestamp: ts, type: entry.type }));
}

function parseRedAlertPage(json, cutoff) {
    const alerts = [];
    let reachedCutoff = false;
    for (const entry of json.data) {
        if (cutoff && new Date(entry.timestamp).getTime() < cutoff) { reachedCutoff = true; break; }
        alerts.push(...parseRedAlertEntry(entry));
    }
    return { alerts, reachedCutoff };
}

async function fetchRedAlertHistory(startDate) {
    const cutoff = startDate ? new Date(startDate).getTime() : 0;
    const firstPage = await fetchRedAlertPage(1);
    const { totalPages } = firstPage.meta;
    const { alerts, reachedCutoff } = parseRedAlertPage(firstPage, cutoff);
    if (reachedCutoff || totalPages <= 1) return alerts;

    for (let batchStart = 2; batchStart <= totalPages; batchStart += PARALLEL_PAGES) {
        const batchEnd = Math.min(batchStart + PARALLEL_PAGES - 1, totalPages);
        const pages = [];
        for (let p = batchStart; p <= batchEnd; p++) pages.push(p);

        const results = await Promise.all(pages.map(p => fetchRedAlertPage(p)));
        let done = false;
        for (const json of results) {
            const parsed = parseRedAlertPage(json, cutoff);
            alerts.push(...parsed.alerts);
            if (parsed.reachedCutoff || json.data.length < PAGE_LIMIT) { done = true; break; }
        }
        if (done) break;
    }
    return alerts;
}

async function fetchRedAlertRecent() {
    const json = await fetchRedAlertPage(1);
    const alerts = [];
    for (const entry of json.data) alerts.push(...parseRedAlertEntry(entry));
    return alerts;
}

// ── RocketAlert (fallback) ──────────────────────────────────────────

async function fetchRocketAlerts(from, to) {
    const res = await fetch(`${ROCKETALERT_API_BASE}?from=${from}&to=${to}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'RocketAlert API error');
    const alerts = [];
    for (const day of json.payload) {
        for (const a of day.alerts) {
            if (a.alertTypeId !== 1 && a.alertTypeId !== 2) continue;
            alerts.push({ location: a.name, timestamp: parseIsraelTimestamp(a.timeStamp), type: a.alertTypeId });
        }
    }
    return alerts;
}

async function fetchRocketAlertRealtime() {
    const res = await fetch(ROCKETALERT_REALTIME_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'RocketAlert realtime error');
    const alerts = [];
    for (const group of json.payload) {
        for (const a of group.alerts) {
            if (a.alertTypeId !== 1 && a.alertTypeId !== 2) continue;
            alerts.push({ location: a.name, timestamp: parseIsraelTimestamp(a.timeStamp), type: a.alertTypeId });
        }
    }
    return alerts;
}

// ── Git CSV (fallback) ──────────────────────────────────────────────

function gitSync() {
    try {
        if (fs.existsSync(GIT_ALERTS_DIR)) {
            execSync('git pull --ff-only', { cwd: GIT_ALERTS_DIR, timeout: 10000, stdio: 'pipe' });
        } else {
            execSync(`git clone --depth 1 ${GIT_ALERTS_REPO} ${GIT_ALERTS_DIR}`, { timeout: 15000, stdio: 'pipe' });
        }
        return true;
    } catch (e) {
        console.error('Git sync failed:', e.message);
        return false;
    }
}

function parseGitCsv(historyDays) {
    if (!fs.existsSync(GIT_ALERTS_CSV)) return [];
    const cutoffStr = new Date(Date.now() - historyDays * 86400000).toISOString().slice(0, 10);
    const content = fs.readFileSync(GIT_ALERTS_CSV, 'utf8');
    const lines = content.split('\n');
    const alerts = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const dateMatch = line.match(/,(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}),(\d+),/);
        if (!dateMatch) continue;
        const datePart = dateMatch[1];
        const timePart = dateMatch[2];
        const category = parseInt(dateMatch[3], 10);
        if (datePart < cutoffStr) continue;
        if (category !== 1 && category !== 2 && category !== 14) continue;
        const commaIdx = line.indexOf(',');
        if (commaIdx === -1) continue;
        const location = line.slice(0, commaIdx);
        if (location.startsWith('"')) continue;
        alerts.push({ location, timestamp: parseIsraelTimestamp(`${datePart} ${timePart}`), type: category });
    }
    return alerts;
}

async function fetchGitAlerts(historyDays) {
    gitSync();
    return parseGitCsv(historyDays);
}

// ── Merge / State ───────────────────────────────────────────────────

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

async function fetchHistorical(historyDays) {
    const startDate = new Date(Date.now() - historyDays * 86400000);
    const from = isoDate(startDate);
    const to = isoDate(new Date());

    const [primary, rocketAlerts, realtime, gitAlerts] = await Promise.all([
        fetchRedAlertHistory(startDate).catch(e => { console.error('RedAlert failed:', e.message); return null; }),
        fetchRocketAlerts(from, to).catch(() => []),
        fetchRocketAlertRealtime().catch(() => []),
        fetchGitAlerts(historyDays).catch(() => []),
    ]);

    if (primary && primary.length > 0) {
        mergeAlerts(state.allAlerts, primary);
    } else {
        mergeAlerts(state.allAlerts, rocketAlerts);
        mergeAlerts(state.allAlerts, realtime);
        mergeAlerts(state.allAlerts, gitAlerts);
    }

    state.parsedCache = buildSalvos(state.allAlerts);
    state.lastFetch = Date.now();
    console.log(`Historical fetch: ${state.allAlerts.length} alerts, ${state.parsedCache.salvos.length} salvos (source: ${primary && primary.length > 0 ? 'redalert' : 'fallbacks'})`);
}

function trimOldAlerts() {
    const cutoff = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86400;
    const before = state.allAlerts.length;
    while (state.allAlerts.length > 0 && state.allAlerts[0].timestamp < cutoff) {
        const removed = state.allAlerts.shift();
        _seenAlertKeys.delete(`${removed.timestamp}:${removed.location}`);
    }
    return state.allAlerts.length < before;
}

async function fetchRecent() {
    const [recent, rocketAlerts, realtime] = await Promise.all([
        fetchRedAlertRecent().catch(e => { console.error('RedAlert recent failed:', e.message); return null; }),
        fetchRocketAlerts(isoDate(new Date(Date.now() - 2 * 86400000)), isoDate(new Date())).catch(() => []),
        fetchRocketAlertRealtime().catch(() => []),
    ]);

    let changed = trimOldAlerts();
    if (recent && recent.length > 0) {
        if (mergeAlerts(state.allAlerts, recent) > 0) changed = true;
    } else {
        if (mergeAlerts(state.allAlerts, rocketAlerts) + mergeAlerts(state.allAlerts, realtime) > 0) changed = true;
    }
    if (changed) state.parsedCache = buildSalvos(state.allAlerts);

    state.lastFetch = Date.now();
}

function getParsedCache() {
    return state.parsedCache || buildSalvos(state.allAlerts);
}

module.exports = { fetchHistorical, fetchRecent, getParsedCache, mergeAlerts, state };
