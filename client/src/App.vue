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
import RainCanvas from '@/components/RainCanvas.vue';

export default {
    components: { AppHeader, AppFooter, DebugPanel, RiskGauge, DurationPicker, LocationPicker, InfoCards, ReasoningsChart, DailyGraph, DonationToast, RainCanvas },
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
    },
    watch: {
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
        focusLocationInput() {
            const input = this.$el.querySelector('.loc-input');
            if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
        },
    },
};
</script>

<template>
    <div>
        <RainCanvas :rocket-count="rocketCount" />
        <div class="bg-blobs"><span class="b1"></span><span class="b2"></span><span class="b3"></span><span class="b4"></span></div>
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
