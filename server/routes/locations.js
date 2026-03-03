const { findNearestLocation } = require('../services/locationService');
const { getParsedCache } = require('../services/alertFetcher');

function handleLocations() {
    return getParsedCache().locations;
}

function handleNearestLocation(searchParams) {
    const lat = parseFloat(searchParams.get('lat'));
    const lng = parseFloat(searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return { status: 400, data: { error: 'invalid_coordinates' } };
    const nearest = findNearestLocation(lat, lng);
    if (!nearest)
        return { status: 500, data: { error: 'location_index_unavailable' } };
    return { status: 200, data: { name: nearest.name, lat: nearest.lat, lng: nearest.lng } };
}

module.exports = { handleLocations, handleNearestLocation };
