const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const REDALERT_BASE = 'https://redalert.orielhaim.com';
const REDALERT_API_KEY = process.env.REDALERT_API_KEY || '';
const ROCKETALERT_API_BASE = 'https://agg.rocketalert.live/api/v1/alerts/details';
const ROCKETALERT_REALTIME_URL = 'https://agg.rocketalert.live/api/v2/alerts/real-time/cached';
const GIT_ALERTS_REPO = 'https://github.com/dleshem/israel-alerts-data.git';
const GIT_ALERTS_DIR = '/tmp/israel-alerts-data';
const GIT_ALERTS_CSV = '/tmp/israel-alerts-data/israel-alerts.csv';
const FETCH_INTERVAL_MS = 30 * 1000;
const HISTORY_DAYS = 14;
const HTTP_TIMEOUT_MS = 8000;
const VIEWER_TTL_MS = 60 * 1000;

module.exports = {
    PORT, REDALERT_BASE, REDALERT_API_KEY,
    ROCKETALERT_API_BASE, ROCKETALERT_REALTIME_URL,
    GIT_ALERTS_REPO, GIT_ALERTS_DIR, GIT_ALERTS_CSV,
    FETCH_INTERVAL_MS, HISTORY_DAYS, HTTP_TIMEOUT_MS, VIEWER_TTL_MS,
};
