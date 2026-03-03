const { getParsedCache, state } = require('../services/alertFetcher');

function handleStatus() {
    const parsed = getParsedCache();
    const latestAlert = parsed.salvos.length > 0
        ? parsed.salvos[parsed.salvos.length - 1].timestamp
        : null;
    return {
        lastFetch: state.lastFetch,
        alertCount: state.allAlerts.length,
        salvoCount: parsed.salvos.length,
        latestAlert,
        modelType: 'hunger+heuristics',
    };
}

module.exports = { handleStatus };
