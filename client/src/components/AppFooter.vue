<script>
import { useTranslations } from '@/composables/useTranslations.js';

export default {
    props: {
        lastUpdateTime: String,
    },
    setup() {
        return useTranslations();
    },
};
</script>

<template>
    <footer>
        <p>{{ t.disclaimer }}</p>
        <p>
            <span>{{ t.source }}</span>
            <a href="https://redalert.orielhaim.com" target="_blank" rel="noopener">RedAlert</a>
        </p>
        <p>{{ t.lastUpdate }}: {{ lastUpdateTime }}</p>
        <div style="display: flex; justify-content: center; gap: 0.75rem; width: 100%;">
            <a href="https://linkedin.com/in/matan1905" target="_blank" rel="noopener">LinkedIn</a>
            <a href="https://x.com/IAmMatan" target="_blank" rel="noopener">X</a>
        </div>
    </footer>
</template>
