import { describe, it, expect } from 'vitest';

function makeDailyPoints(count = 96) {
    return Array.from({ length: count }, (_, i) => {
        const minuteOfDay = i * 15;
        const h = Math.floor(minuteOfDay / 60);
        const m = minuteOfDay % 60;
        return {
            time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
            minuteOfDay,
            risk: Math.random() * 0.8 + 0.1,
            level: 'YELLOW',
        };
    });
}

function interpolate(points) {
    if (points.length < 2) return points;
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const gap = b.minuteOfDay - a.minuteOfDay;
        for (let m = a.minuteOfDay; m < b.minuteOfDay; m++) {
            const t = (m - a.minuteOfDay) / gap;
            result.push({ minuteOfDay: m, risk: a.risk + (b.risk - a.risk) * t });
        }
    }
    const last = points[points.length - 1];
    result.push({ minuteOfDay: last.minuteOfDay, risk: last.risk });
    return result;
}

function bestTimeWindow(points, currentMinuteOfDay) {
    const interp = interpolate(points);
    if (!interp.length) return null;
    let minRisk = Infinity;
    let bestMinute = null;
    for (const p of interp) {
        if (p.minuteOfDay >= currentMinuteOfDay && p.risk < minRisk) {
            minRisk = p.risk;
            bestMinute = p.minuteOfDay;
        }
    }
    if (bestMinute == null) return null;
    const h = String(Math.floor(bestMinute / 60)).padStart(2, '0');
    const m = String(bestMinute % 60).padStart(2, '0');
    return { minuteOfDay: bestMinute, risk: minRisk, time: `${h}:${m}` };
}

describe('DailyGraph bestTimeWindow logic', () => {
    it('returns null when there are no points', () => {
        expect(bestTimeWindow([], 600)).toBeNull();
    });

    it('returns null when all points are in the past', () => {
        const points = makeDailyPoints(4).map((p, i) => ({ ...p, minuteOfDay: i * 15 }));
        expect(bestTimeWindow(points, 1440)).toBeNull();
    });

    it('never returns a point in the past', () => {
        const points = makeDailyPoints();
        const currentMin = 720;
        const best = bestTimeWindow(points, currentMin);
        expect(best).not.toBeNull();
        expect(best.minuteOfDay).toBeGreaterThanOrEqual(currentMin);
    });

    it('returns the interpolated minute with the lowest risk among future points', () => {
        const points = [
            { minuteOfDay: 600, risk: 0.1 },
            { minuteOfDay: 840, risk: 0.05 },
            { minuteOfDay: 1080, risk: 0.3 },
        ];
        const best = bestTimeWindow(points, 700);
        expect(best.time).toBe('14:00');
        expect(best.risk).toBe(0.05);
    });

    it('ignores past points even if they have lower risk', () => {
        const points = [
            { minuteOfDay: 360, risk: 0.01 },
            { minuteOfDay: 840, risk: 0.2 },
            { minuteOfDay: 1200, risk: 0.4 },
        ];
        const best = bestTimeWindow(points, 720);
        expect(best.minuteOfDay).toBeGreaterThanOrEqual(720);
        expect(best.risk).toBeLessThan(0.4);
    });

    it('includes the current minute point as a candidate', () => {
        const points = [
            { minuteOfDay: 720, risk: 0.05 },
            { minuteOfDay: 840, risk: 0.3 },
        ];
        const best = bestTimeWindow(points, 720);
        expect(best.time).toBe('12:00');
    });

    it('finds interpolated best time between interval boundaries', () => {
        const points = [
            { minuteOfDay: 600, risk: 0.5 },
            { minuteOfDay: 615, risk: 0.1 },
            { minuteOfDay: 630, risk: 0.5 },
        ];
        const best = bestTimeWindow(points, 600);
        expect(best.time).toBe('10:15');
        expect(best.risk).toBe(0.1);
    });

    it('can find best time at a non-boundary minute via interpolation', () => {
        const points = [
            { minuteOfDay: 600, risk: 0.4 },
            { minuteOfDay: 630, risk: 0.2 },
            { minuteOfDay: 660, risk: 0.6 },
        ];
        const best = bestTimeWindow(points, 600);
        expect(best.time).toBe('10:30');
        expect(best.risk).toBe(0.2);
    });
});
