const { ping, getCount } = require('../services/viewerTracker');

function handleAnalyticsPing(searchParams) {
    const rawId = searchParams.get('id') || '';
    ping(rawId.slice(0, 64));
    return { viewers: getCount() };
}

module.exports = { handleAnalyticsPing };
