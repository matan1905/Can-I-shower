<script>
import { useTranslations } from '@/composables/useTranslations.js';
import { fetchPredict, fetchLocations, fetchNearestLocation, fetchDailyRisk, pingViewers, fetchWeights } from '@/composables/useApi.js';
import AppHeader from '@/components/AppHeader.vue';
import AppFooter from '@/components/AppFooter.vue';
import DebugPanel from '@/components/DebugPanel.vue';
import RiskGauge from '@/components/RiskGauge.vue';
import DurationPicker from '@/components/DurationPicker.vue';
import LocationPicker from '@/components/LocationPicker.vue';
import InfoCards from '@/components/InfoCards.vue';
import ReasoningsChart from '@/components/ReasoningsChart.vue';
import DailyGraph from '@/components/DailyGraph.vue';
import DonationToast from '@/components/DonationToast.vue';

export default {
    components: { AppHeader, AppFooter, DebugPanel, RiskGauge, DurationPicker, LocationPicker, InfoCards, ReasoningsChart, DailyGraph, DonationToast },
    setup() {
        return useTranslations();
    },
    data() {
        return {
            isConnected: false,
            duration: 10,
            selectedLocations: [],
            allLocations: [],
            lastUpdateTime: '–',
            isLoading: false,
            isInitialLoading: true,
            isDebug: false,
            debugNow: null,
            viewerId: null,
            viewersCount: 0,
            dailyPoints: [],
            dailySalvos: [],
            isDailyLoading: false,
            userWeights: {},
            data: {
                risk: 0, minutesSinceLastAlert: null,
                salvoCount: 0, trend: 'stable',
                expectedNextAlert: null, avgGapLast10Minutes: null,
                noData: false, reasonings: [], lastAlertIsPreWarning: false,
            },
            pollTimer: null,
            pingTimer: null,
            rocketTimers: [],
            pageHeight: 0,
            _resizeObs: null,
            _tabHidden: false,
        };
    },
    computed: {
        hasData() {
            return !this.isInitialLoading && !this.data.noData && this.data.minutesSinceLastAlert != null;
        },
        weightedRisk() {
            const w = this.userWeights;
            const reasonings = this.data.reasonings;
            if (!reasonings?.length || !w || !Object.keys(w).length) return this.data.risk;
            const totalW = reasonings.reduce((s, r) => s + (w[r.id] ?? 0), 0) || 1;
            return Math.max(0, Math.min(0.99, reasonings.reduce((s, r) => s + ((w[r.id] ?? 0) / totalW) * r.risk, 0)));
        },
        riskRec() {
            if (!this.hasData) return '';
            const r = this.weightedRisk;
            if (r >= 0.5) return this.data.lastAlertIsPreWarning ? this.t.recPreWarning : this.t.recHigh;
            if (r >= 0.25) return this.t.recMed;
            return this.t.recLow;
        },
        rocketCount() {
            const r = this.weightedRisk;
            if (!this.hasData || r < 0.25) return 0;
            if (r < 0.4) return 2;
            if (r < 0.55) return 4;
            if (r < 0.7) return 7;
            return 12;
        },
        activeRockets() {
            const count = this.rocketCount;
            const allPositions = [8, 88, 42, 69, 22, 95, 35, 79, 15, 58, 5, 48];
            const durations = [2.6, 3.1, 2.8, 3.3, 2.5, 3.0, 2.7, 3.4, 2.9, 3.2, 2.8, 3.0];
            const delays = [0.0, 1.8, 0.6, 2.4, 1.1, 3.2, 0.4, 2.8, 1.5, 0.9, 3.6, 2.0];
            const opacities = [0.16, 0.15, 0.18, 0.13, 0.17, 0.16, 0.14, 0.12, 0.14, 0.15, 0.13, 0.16];
            return Array.from({ length: count }, (_, i) => ({
                id: i,
                leftPct: allPositions[i],
                durMs: durations[i] * 1000,
                style: {
                    left: allPositions[i] + '%',
                    animationDuration: durations[i] + 's',
                    animationDelay: delays[i] + 's',
                    opacity: opacities[i],
                },
            }));
        },
        viewerText() {
            const c = this.viewersCount || 0;
            if (c <= 1) return '';
            const others = c - 1;
            if (others === 1) return this.t.viewersYouAndOne;
            if (others <= 4) return this.t.viewersYouAndFew.replace('{n}', others);
            return this.t.viewersYouAndMany.replace('{n}', others);
        },
    },
    mounted() {
        this.updatePageHeight();
        this._resizeObs = new ResizeObserver(() => this.updatePageHeight());
        this._resizeObs.observe(document.documentElement);
        this._onVisChange = () => { this._tabHidden = document.hidden; };
        document.addEventListener('visibilitychange', this._onVisChange);
        this.initDebug();
        this.ensureViewerId();
        try {
            const saved = JSON.parse(localStorage.getItem('selectedLocations'));
            if (Array.isArray(saved) && saved.length) this.selectedLocations = saved;
        } catch (_) {}
        this.loadLocations();
        this.loadWeights();
        this.load();
        this.loadDailyRisk();
        this.pollTimer = setInterval(() => this.load(), 30000);
        this.pingTimer = setInterval(() => this.pingViewers(), 25000);
        this.pingViewers();
    },
    beforeUnmount() {
        clearInterval(this.pollTimer);
        clearInterval(this.pingTimer);
        this.rocketTimers.forEach(t => { clearTimeout(t); clearInterval(t); });
        if (this._resizeObs) this._resizeObs.disconnect();
        document.removeEventListener('visibilitychange', this._onVisChange);
    },
    watch: {
        activeRockets: {
            handler(rockets) {
                this.rocketTimers.forEach(t => clearInterval(t));
                this.rocketTimers = [];
                for (const r of rockets) {
                    const delayMs = parseFloat(r.style.animationDelay) * 1000;
                    const firstFire = delayMs + r.durMs;
                    const tid = setTimeout(() => {
                        this.spawnExplosion(r);
                        const iid = setInterval(() => this.spawnExplosion(r), r.durMs);
                        this.rocketTimers.push(iid);
                    }, firstFire);
                    this.rocketTimers.push(tid);
                }
            },
            immediate: true,
        },
        duration() { this.load(); this.loadDailyRisk(); },
        selectedLocations(v) {
            localStorage.setItem('selectedLocations', JSON.stringify(v));
            this.load();
            this.loadDailyRisk();
        },
        debugNow() { this.load(); this.loadDailyRisk(); },
        lang() { this.updateTitle(); },
    },
    methods: {
        initDebug() {
            try {
                const params = new URLSearchParams(window.location.search || '');
                this.isDebug = params.has('debug') && ['true', '', '1'].includes(params.get('debug'));
            } catch (_) { this.isDebug = false; }
        },
        updateTitle() {
            document.title = this.t.title;
        },
        ensureViewerId() {
            try {
                const saved = localStorage.getItem('viewerId');
                if (saved) { this.viewerId = saved; return; }
            } catch (_) {}
            const id = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);
            this.viewerId = id;
            try { localStorage.setItem('viewerId', id); } catch (_) {}
        },
        async load() {
            this.isLoading = true;
            try {
                const d = await fetchPredict({
                    duration: this.duration,
                    locations: this.selectedLocations,
                    debugNow: this.debugNow,
                });
                this.data = d;
                this.isConnected = true;
                this.isInitialLoading = false;
                this.lastUpdateTime = new Date().toLocaleTimeString(this.lang === 'he' ? 'he-IL' : 'en-US');
            } catch (_) {
                this.isConnected = false;
            } finally {
                this.isLoading = false;
            }
        },
        async loadLocations() {
            try {
                this.allLocations = await fetchLocations();
            } catch (_) {}
        },
        async loadWeights() {
            try {
                const saved = JSON.parse(localStorage.getItem('userWeights'));
                if (saved && typeof saved === 'object' && Object.keys(saved).length) {
                    this.userWeights = saved;
                    return;
                }
            } catch (_) {}
            try {
                this.userWeights = await fetchWeights();
            } catch (_) {}
        },
        onWeightsChange(weights) {
            this.userWeights = weights;
            try { localStorage.setItem('userWeights', JSON.stringify(weights)); } catch (_) {}
        },
        async loadDailyRisk() {
            this.isDailyLoading = true;
            try {
                const result = await fetchDailyRisk({
                    duration: this.duration,
                    locations: this.selectedLocations,
                    debugNow: this.debugNow,
                });
                this.dailyPoints = result.points || [];
                this.dailySalvos = result.salvos || [];
            } catch (_) {
                this.dailyPoints = [];
                this.dailySalvos = [];
            } finally {
                this.isDailyLoading = false;
            }
        },
        async pingViewers() {
            if (!this.viewerId) return;
            try {
                const d = await pingViewers(this.viewerId);
                if (d && typeof d.viewers === 'number') this.viewersCount = d.viewers;
            } catch (_) {}
        },
        async startLocationAssist() {
            if (this.selectedLocations.length) { this.focusLocationInput(); return; }
            if (!navigator.geolocation) { this.focusLocationInput(); return; }
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const { latitude: lat, longitude: lng } = pos.coords;
                    const accuracyM = pos.coords.accuracy != null ? pos.coords.accuracy : Infinity;
                    if (accuracyM > 10000) {
                        this.focusLocationInput();
                        return;
                    }
                    try {
                        const d = await fetchNearestLocation(lat, lng);
                        if (d && d.name && !this.selectedLocations.includes(d.name)) {
                            this.selectedLocations = [d.name];
                        }
                    } catch (_) { this.focusLocationInput(); }
                },
                () => this.focusLocationInput(),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        },
        updatePageHeight() {
            this.pageHeight = document.documentElement.scrollHeight;
        },
        spawnExplosion(rocket) {
            if (this._tabHidden) return;
            const container = this.$refs.explosionLayer;
            if (!container) return;
            // Cap total particles in DOM to prevent buildup
            if (container.children.length > 60) return;
            const x = (rocket.leftPct / 100) * window.innerWidth;
            const y = this.pageHeight - 5;
            const count = 6 + Math.floor(Math.random() * 4);
            for (let i = 0; i < count; i++) {
                const p = document.createElement('span');
                p.className = 'explosion-particle';
                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
                const dist = 20 + Math.random() * 40;
                const size = 2 + Math.random() * 4;
                const hue = 25 + Math.random() * 30;
                p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist}px;background:hsl(${hue},100%,${55 + Math.random() * 20}%)`;
                container.appendChild(p);
                p.addEventListener('animationend', () => p.remove(), { once: true });
            }
            const glow = document.createElement('span');
            glow.className = 'explosion-glow';
            glow.style.cssText = `left:${x}px;top:${y}px`;
            container.appendChild(glow);
            glow.addEventListener('animationend', () => glow.remove(), { once: true });
        },
        focusLocationInput() {
            const input = this.$el.querySelector('.loc-input');
            if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
        },
    },
};
</script>

<template>
    <div style="position:relative;min-height:100vh">
        <div class="shower-rain">
            <span class="drop d1"></span><span class="drop d2"></span><span class="drop d3"></span>
            <span class="drop d4"></span><span class="drop d5"></span><span class="drop d6"></span>
            <span class="drop d7"></span><span class="drop d8"></span><span class="drop d9"></span>
            <span class="drop d10"></span><span class="drop d11"></span><span class="drop d12"></span>
            <span
                v-for="r in activeRockets"
                :key="r.id"
                class="drop rocket"
                :style="r.style"
            ><svg viewBox="0 0 24 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C12 0 4 10 4 22c0 4 2 7 4 9l1-5h6l1 5c2-2 4-5 4-9C20 10 12 0 12 0z" fill="rgba(147,197,253,0.7)"/><path d="M9 26l-3 6 3-2h6l3 2-3-6H9z" fill="rgba(251,146,60,0.6)"/><circle cx="12" cy="18" r="3" fill="rgba(255,255,255,0.25)"/></svg></span>
        </div>
        <div class="bg-blobs"><span class="b1"></span><span class="b2"></span><span class="b3"></span><span class="b4"></span></div>
        <div class="explosion-layer" ref="explosionLayer"></div>
        <div class="app">
            <DebugPanel v-if="isDebug" v-model="debugNow" :on-fake-toast="() => $refs.donationToast?.addFakeToast()" />
            <AppHeader :connected="isConnected" />
            <RiskGauge
                :risk="weightedRisk"
                :is-loading="isInitialLoading"
                :has-data="hasData"
                :last-alert-is-pre-warning="!!data.lastAlertIsPreWarning"
                :viewer-text="viewerText"
                :risk-rec="riskRec"
                :has-location="selectedLocations.length > 0"
                @locate="startLocationAssist"
            />
            <section class="controls-card glass">
                <DurationPicker v-model="duration" />
                <LocationPicker v-model="selectedLocations" :all-locations="allLocations" />
            </section>
            <section class="support-section">
                <p class="support-title">{{ t.supportTitle }}</p>
                <p class="support-subtitle">{{ t.supportSubtitle }}</p>
                <a href="https://buymeacoffee.com/iammatan" target="_blank" rel="noopener" class="support-link">
                    <img src="/haha_shampoo.png" alt="Buy me a shampoo" class="support-img" />
                </a>
            </section>
            <InfoCards
                :minutes-since-last-alert="data.minutesSinceLastAlert"
                :avg-gap-last10-minutes="data.avgGapLast10Minutes"
                :salvo-count="data.salvoCount"
                :trend="data.trend"
            />
            <DailyGraph :points="dailyPoints" :salvos="dailySalvos" :weights="userWeights" :is-loading="isDailyLoading" :debug-now="debugNow" :duration="duration" />
            <ReasoningsChart v-if="hasData" :reasonings="data.reasonings" :weights="userWeights" @update:weights="onWeightsChange" />
            <AppFooter :last-update-time="lastUpdateTime" />
            <DonationToast ref="donationToast" />
        </div>
    </div>
</template>
