#!/usr/bin/env node
/**
 * Fetches all locations from the rocket alert API. The API already returns
 * lat/lon per alert — we collect unique location names and their coordinates
 * and write locations-latlong.json for use with military-target risk calculations.
 * Usage: node scripts/fetch-locations-latlong.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://agg.rocketalert.live/api/v1/alerts/details';
const OUT_FILE = path.join(__dirname, '..', 'locations-latlong.json');

function fetch(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'GET', headers: { Accept: 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const body = data.trim();
                    if (body.startsWith('<?xml') || body.startsWith('<!')) {
                        return reject(new Error(`API returned HTML/XML. Body start: ${body.slice(0, 120)}`));
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

async function getLocationsWithCoords() {
    const now = new Date();
    const from = new Date(now.getTime() - 90 * 86400000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);
    const url = `${API_BASE}?from=${fromStr}&to=${toStr}`;
    const json = await fetch(url);
    if (!json.success) throw new Error(json.error || 'API error');
    const out = {};
    for (const day of json.payload || []) {
        for (const a of day.alerts || []) {
            if (a.alertTypeId !== 1 && a.alertTypeId !== 2) continue;
            const lat = a.lat != null ? parseFloat(a.lat) : null;
            const lon = a.lon != null ? parseFloat(a.lon) : null;
            if (a.name && lat != null && lon != null && !out[a.name]) {
                out[a.name] = { lat, lng: lon };
            }
        }
    }
    return out;
}

async function main() {
    console.log('Fetching alerts from API...');
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
