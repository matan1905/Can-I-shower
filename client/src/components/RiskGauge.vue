<script>
import { useTranslations } from '@/composables/useTranslations.js';

const ARC_LEN = Math.PI * 84;

export default {
    props: {
        risk: { type: Number, default: 0 },
        isLoading: Boolean,
        hasData: Boolean,
        lastAlertIsPreWarning: { type: Boolean, default: false },
        viewerText: { type: String, default: '' },
        riskRec: { type: String, default: '' },
        hasLocation: Boolean,
    },
    emits: ['locate'],
    setup() {
        return useTranslations();
    },
    computed: {
        riskClass() {
            if (this.risk > 0.4) return this.lastAlertIsPreWarning ? 'warning' : 'red';
            if (this.risk >= 0.25) return 'yellow';
            return 'green';
        },
        riskDisplay() {
            if (this.isLoading || !this.hasData) return '–';
            return `${Math.round(this.risk * 100)}%`;
        },
        riskLabel() {
            if (this.isLoading) return this.t.loading;
            if (!this.hasData) return this.t.noData;
            if (this.riskClass === 'warning') return this.t.riskPreWarning;
            if (this.riskClass === 'red') return this.t.riskHigh;
            if (this.riskClass === 'yellow') return this.t.riskMed;
            return this.t.riskLow;
        },
        gaugeDash() {
            if (this.isLoading || !this.hasData) return `0 ${ARC_LEN}`;
            const fill = ARC_LEN * Math.min(this.risk, 1);
            return `${fill} ${ARC_LEN}`;
        },
        gaugeGradient() {
            return `url(#grad-${this.riskClass})`;
        },
    },
};
</script>

<template>
    <main class="risk-section">
        <div class="risk-gauge" dir="ltr">
            <svg viewBox="0 0 200 115">
                <defs>
                    <linearGradient id="grad-green" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#16a34a" /><stop offset="100%" stop-color="#4ade80" />
                    </linearGradient>
                    <linearGradient id="grad-yellow" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#d97706" /><stop offset="100%" stop-color="#fbbf24" />
                    </linearGradient>
                    <linearGradient id="grad-red" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#dc2626" /><stop offset="100%" stop-color="#f87171" />
                    </linearGradient>
                    <linearGradient id="grad-warning" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#d97706" /><stop offset="100%" stop-color="#f59e0b" />
                    </linearGradient>
                    <filter id="gauge-glow">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                <!-- Subtle track ticks -->
                <path fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="16" stroke-linecap="round" d="M 16 100 A 84 84 0 0 1 184 100" />
                <path fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12" stroke-linecap="round" d="M 16 100 A 84 84 0 0 1 184 100" />
                <!-- Glowing active arc -->
                <path fill="none" :stroke="gaugeGradient" stroke-width="12" stroke-linecap="round" d="M 16 100 A 84 84 0 0 1 184 100" :stroke-dasharray="gaugeDash" filter="url(#gauge-glow)" style="transition: stroke-dasharray 0.8s ease, stroke 0.5s ease;" />
            </svg>
            <div class="gauge-text">
                <span class="risk-percent">{{ riskDisplay }}</span>
                <span class="risk-sublabel">{{ riskLabel }}</span>
            </div>
        </div>
        <p class="risk-rec">{{ riskRec }}</p>
        <button v-if="!hasLocation" type="button" class="loc-cta" @click="$emit('locate')">
            <span class="icon">📍</span>
            <span>{{ t.locCta }}</span>
        </button>
        <p v-if="viewerText" class="viewer-line">{{ viewerText }}</p>
    </main>
</template>
