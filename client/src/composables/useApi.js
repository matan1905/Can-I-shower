export async function fetchPredict({ duration, locations, debugNow }) {
    let url = `/api/predict?duration=${duration}`;
    if (locations && locations.length) url += `&location=${encodeURIComponent(locations.join('|'))}`;
    if (debugNow != null) url += `&debugNow=${encodeURIComponent(debugNow)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('predict failed');
    return res.json();
}

export async function fetchLocations() {
    const res = await fetch('/api/locations');
    if (!res.ok) throw new Error('locations failed');
    return res.json();
}

export async function fetchNearestLocation(lat, lng) {
    const res = await fetch(`/api/nearest-location?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (!res.ok) return null;
    return res.json();
}

export async function fetchDailyRisk({ duration, locations, date, debugNow }) {
    let url = `/api/predict/daily-risk?duration=${duration}`;
    if (locations && locations.length) url += `&location=${encodeURIComponent(locations.join('|'))}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;
    if (debugNow != null) url += `&debugNow=${encodeURIComponent(debugNow)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('daily-risk failed');
    return res.json();
}

export async function pingViewers(id) {
    const res = await fetch(`/api/analytics/ping?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return res.json();
}

export async function fetchWeights() {
    const res = await fetch('/api/weights');
    if (!res.ok) throw new Error('weights failed');
    return res.json();
}

