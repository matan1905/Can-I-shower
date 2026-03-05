<script>
import { useTranslations } from '@/composables/useTranslations.js';

export default {
    props: {
        points: { type: Array, default: () => [] },
        salvos: { type: Array, default: () => [] },
        weights: { type: Object, default: () => ({}) },
        isLoading: Boolean,
        debugNow: { type: [Number, String], default: null },
    },
    setup() {
        return useTranslations();
    },
    data() {
        return { chart: null, isZoomed: false, _updateTimer: null };
    },
    watch: {
        points: { handler: 'updateChart', deep: true },
        salvos: { handler: 'updateChart', deep: true },
        weights: { handler: 'updateChart', deep: true },
        debugNow: 'updateChart',
        lang: 'updateChart',
    },
    mounted() {
        this.updateChart();
    },
    beforeUnmount() {
        clearTimeout(this._updateTimer);
        if (this.chart) { this.chart.destroy(); this.chart = null; }
    },
    computed: {
        weightedPoints() {
            if (!this.points?.length) return [];
            const w = this.weights;
            const hasWeights = w && Object.keys(w).length > 0;
            return this.points.map(p => {
                if (!hasWeights || !p.reasonings?.length) return p;
                const totalW = p.reasonings.reduce((s, r) => s + (w[r.id] ?? 0), 0) || 1;
                const risk = Math.max(0, Math.min(0.99, p.reasonings.reduce((s, r) => s + ((w[r.id] ?? 0) / totalW) * r.risk, 0)));
                return { ...p, risk };
            });
        },
        interpolatedPoints() {
            const pts = this.weightedPoints;
            if (pts.length < 2) return pts;
            const result = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                const gap = b.minuteOfDay - a.minuteOfDay;
                for (let m = a.minuteOfDay; m < b.minuteOfDay; m++) {
                    const t = (m - a.minuteOfDay) / gap;
                    result.push({ minuteOfDay: m, risk: a.risk + (b.risk - a.risk) * t });
                }
            }
            const last = pts[pts.length - 1];
            result.push({ minuteOfDay: last.minuteOfDay, risk: last.risk });
            return result;
        },
        bestTimeWindow() {
            const pts = this.interpolatedPoints;
            if (!pts.length) return null;
            const currentMin = this.currentMinuteOfDay;
            const xRange = this.xAxisRange;
            let minRisk = Infinity;
            let bestWrapped = null;
            for (const p of pts) {
                let wrapped = p.minuteOfDay;
                if (wrapped < xRange.min) wrapped += 1440;
                else if (wrapped > xRange.max) wrapped -= 1440;
                if (wrapped < currentMin || wrapped < xRange.min || wrapped > xRange.max) continue;
                if (p.risk < minRisk) {
                    minRisk = p.risk;
                    bestWrapped = wrapped;
                }
            }
            if (bestWrapped == null) return null;
            const display = ((bestWrapped % 1440) + 1440) % 1440;
            const h = String(Math.floor(display / 60)).padStart(2, '0');
            const m = String(display % 60).padStart(2, '0');
            return { minuteOfDay: bestWrapped, risk: minRisk, time: `${h}:${m}` };
        },
        currentMinuteOfDay() {
            let d;
            if (this.debugNow != null && this.debugNow !== '') {
                const n = Number(this.debugNow);
                d = new Date(n < 1e12 ? n * 1000 : n);
            } else {
                d = new Date();
            }
            const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':');
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        },
        xAxisRange() {
            const current = this.currentMinuteOfDay;
            return { min: current - 720, max: current + 720 };
        },
    },
    methods: {
        resetZoom() {
            if (!this.chart) return;
            const xRange = this.xAxisRange;
            this.chart.zoomX(xRange.min, xRange.max);
            this.isZoomed = false;
        },
        updateChart() {
            this.isZoomed = false;
            if (!this.weightedPoints.length) {
                if (this.chart) { this.chart.destroy(); this.chart = null; }
                return;
            }
            clearTimeout(this._updateTimer);
            this._updateTimer = setTimeout(() => {
                const el = this.$refs.chartEl;
                if (!el) return;

                const minuteToTime = m => {
                    const wrapped = ((m % 1440) + 1440) % 1440;
                    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
                };
                const xRange = this.xAxisRange;
                const currentMin = this.currentMinuteOfDay;

                const wrapToWindow = (minuteOfDay) => {
                    let m = minuteOfDay;
                    if (m < xRange.min) m += 1440;
                    else if (m > xRange.max) m -= 1440;
                    return m;
                };

                const seriesData = this.interpolatedPoints
                    .map(p => ({ x: wrapToWindow(p.minuteOfDay), y: Math.round(p.risk * 100) }))
                    .filter(p => p.x >= xRange.min && p.x <= xRange.max)
                    .sort((a, b) => a.x - b.x);
                const bestTime = this.bestTimeWindow;
                const t = this.t;

                const annotations = { xaxis: [] };

                for (const salvo of this.salvos) {
                    if (salvo.minuteOfDay < xRange.min || salvo.minuteOfDay > currentMin) continue;
                    annotations.xaxis.push({
                        x: salvo.minuteOfDay,
                        borderColor: '#ef4444',
                        strokeDashArray: 0,
                        borderWidth: 1,
                        opacity: 0.5,
                        label: { text: '', style: { background: 'transparent' } },
                    });
                }

                annotations.xaxis.push({
                    x: currentMin,
                    borderColor: '#a5b4fc',
                    strokeDashArray: 4,
                    label: {
                        text: t.currentTimeLabel,
                        style: { color: '#fff', background: '#4f46e5', fontSize: '11px' },
                    },
                });

                if (bestTime) {
                    const bestX = wrapToWindow(bestTime.minuteOfDay);
                    if (bestX >= xRange.min && bestX <= xRange.max) {
                        annotations.xaxis.push({
                            x: bestX,
                            borderColor: '#4ade80',
                            strokeDashArray: 0,
                            borderWidth: 2,
                            label: { text: '', style: { background: 'transparent' } },
                        });
                    }
                }

                const vm = this;
                const options = {
                    chart: {
                        type: 'area',
                        background: 'transparent',
                        height: 260,
                        toolbar: { show: false },
                        animations: { enabled: true, speed: 400 },
                        sparkline: { enabled: false },
                        events: {
                            zoomed() { vm.isZoomed = true; },
                            scrolled() { vm.isZoomed = true; },
                        },
                    },
                    theme: { mode: 'dark' },
                    series: [{ name: '%', data: seriesData }],
                    xaxis: {
                        type: 'numeric',
                        min: xRange.min,
                        max: xRange.max,
                        tickAmount: 8,
                        labels: {
                            formatter: val => minuteToTime(Math.round(val)),
                            style: { colors: '#64748b', fontSize: '11px' },
                            rotate: 0,
                        },
                        axisBorder: { show: false },
                        axisTicks: { show: false },
                    },
                    yaxis: {
                        min: 0,
                        max: 100,
                        tickAmount: 4,
                        labels: {
                            formatter: val => `${val}%`,
                            style: { colors: '#64748b', fontSize: '11px' },
                        },
                    },
                    fill: {
                        type: 'gradient',
                        gradient: {
                            shadeIntensity: 1,
                            opacityFrom: 0.5,
                            opacityTo: 0.05,
                            stops: [0, 90, 100],
                            colorStops: [
                                { offset: 0, color: '#f87171', opacity: 0.5 },
                                { offset: 50, color: '#fbbf24', opacity: 0.3 },
                                { offset: 100, color: '#4ade80', opacity: 0.05 },
                            ],
                        },
                    },
                    stroke: {
                        curve: 'smooth',
                        width: 2,
                        colors: ['#818cf8'],
                    },
                    // Color zones: green 0-25%, yellow 25-50%, red 50-100%
                    annotations: {
                        ...annotations,
                        yaxis: [
                            {
                                y: 0, y2: 25,
                                fillColor: '#4ade80',
                                opacity: 0.05,
                                label: { text: '', style: { background: 'transparent' } },
                            },
                            {
                                y: 25, y2: 50,
                                fillColor: '#fbbf24',
                                opacity: 0.05,
                                label: { text: '', style: { background: 'transparent' } },
                            },
                            {
                                y: 50, y2: 100,
                                fillColor: '#f87171',
                                opacity: 0.05,
                                label: { text: '', style: { background: 'transparent' } },
                            },
                        ],
                    },
                    tooltip: {
                        theme: 'dark',
                        intersect: false,
                        followCursor: true,
                        x: { formatter: val => minuteToTime(Math.round(val)) },
                        y: { formatter: val => `${val}%` },
                    },
                    grid: {
                        borderColor: 'rgba(255,255,255,0.06)',
                        strokeDashArray: 4,
                    },
                    dataLabels: { enabled: false },
                    markers: { size: 0 },
                };

                if (this.chart) {
                    this.chart.updateOptions(options, true, true);
                } else {
                    this.chart = new window.ApexCharts(el, options);
                    this.chart.render();
                }
            }, 50);
        },
    },
};
</script>

<template>
    <section class="daily-graph-section glass">
        <div class="daily-graph-header">
            <span class="daily-graph-title">{{ t.dailyGraphTitle }}</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span v-if="bestTimeWindow" class="best-time-badge">🚿 {{ t.bestTimeLabel }}: {{ bestTimeWindow.time }}</span>
                <button v-if="isZoomed" class="zoom-reset-btn" @click="resetZoom">↺</button>
            </div>
        </div>
        <div v-if="isLoading" class="daily-graph-loading">{{ t.loading }}</div>
        <div v-show="!isLoading" ref="chartEl" dir="ltr"></div>
    </section>
</template>
