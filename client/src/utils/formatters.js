export function fmtMin(m, t) {
    if (m == null) return '–';
    if (m < 1) return t.lessThanMin;
    if (m < 60) return `${Math.round(m)} ${t.minutes}`;
    const h = Math.floor(m / 60);
    const rm = Math.round(m % 60);
    if (h < 24) return h + ' ' + t.hours + (rm > 0 ? ' ' + t.and + rm + ' ' + t.minutes : '');
    return `${Math.floor(h / 24)} ${t.days}`;
}

export function fmtHighRisk(m, t) {
    if (m == null) return '–';
    if (m < 1) return t.now;
    return fmtMin(m, t);
}
