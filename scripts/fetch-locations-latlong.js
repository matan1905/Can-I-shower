#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const REDALERT_BASE = process.env.REDALERT_BASE || 'https://redalert.orielhaim.com';
const REDALERT_API_KEY = process.env.REDALERT_API_KEY || '';
const OUT_FILE = path.join(__dirname, '..', 'locations-latlong.json');

async function getLocationsWithCoords() {
    const out = {};
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const url = `${REDALERT_BASE}/api/stats/history?page=${page}&limit=100&category=missiles`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${REDALERT_API_KEY}` },
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`RedAlert API ${res.status}: ${await res.text()}`);
        const json = await res.json();
        totalPages = json.meta.totalPages;

        for (const entry of json.data) {
            for (const city of entry.cities || []) {
                const lat = city.lat != null ? parseFloat(city.lat) : null;
                const lng = city.lng != null ? parseFloat(city.lng) : null;
                if (city.name && lat != null && lng != null && !out[city.name]) {
                    out[city.name] = { lat, lng };
                }
            }
        }
        if (json.data.length < 100) break;
        page++;
    }
    return out;
}

async function main() {
    console.log('Fetching alerts from RedAlert API...');
    const locations = await getLocationsWithCoords();
    const names = Object.keys(locations).sort();
    console.log(`Found ${names.length} unique locations with coordinates.`);
    const out = {};
    for (const n of names) out[n] = locations[n];
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote ${OUT_FILE}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
