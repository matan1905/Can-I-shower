const { DEFAULT_WEIGHTS } = require('../services/riskEngine');

function handleWeightsGet() {
    return DEFAULT_WEIGHTS;
}

function handleWeightsPost() {
    return { status: 200, data: DEFAULT_WEIGHTS };
}

module.exports = { handleWeightsGet, handleWeightsPost };
