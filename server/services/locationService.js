const fs = require('fs');
const path = require('path');

let locationCoords = null;

function loadLocationCoords() {
    if (locationCoords) return locationCoords;
    try {
        const raw = fs.readFileSync(path.join(__dirname, '../../locations-latlong.json'), 'utf8');
        const obj = JSON.parse(raw);
        locationCoords = Object.entries(obj).map(([name, v]) => {
            const lat = Number(v && v.lat);
            const lng = Number(v && v.lng);
            return Number.isFinite(lat) && Number.isFinite(lng) ? { name, lat, lng } : null;
        }).filter(Boolean);
    } catch (e) {
        console.error('Failed to load locations-latlong.json:', e.message);
        locationCoords = [];
    }
    return locationCoords;
}

// Haversine distance in km (accurate for "nearest" on Earth)
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function findNearestLocation(lat, lng) {
    const locs = loadLocationCoords();
    if (!locs.length) return null;
    let best = null;
    let bestKm = Infinity;
    for (const loc of locs) {
        const km = haversineKm(lat, lng, loc.lat, loc.lng);
        if (km < bestKm) {
            bestKm = km;
            best = loc;
        }
    }
    return best;
}

module.exports = { loadLocationCoords, findNearestLocation };
