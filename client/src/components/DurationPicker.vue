<script>
import { useTranslations } from '@/composables/useTranslations.js';

export default {
    props: {
        modelValue: { type: Number, default: 10 },
    },
    emits: ['update:modelValue'],
    data() {
        return {
            quickDurations: [5, 10, 15, 20],
            customDuration: null,
            isCustomFocused: false,
        };
    },
    setup() {
        return useTranslations();
    },
    methods: {
        pick(d) {
            this.customDuration = null;
            this.isCustomFocused = false;
            this.$emit('update:modelValue', d);
        },
        onCustomInput() {
            if (this.customDuration && this.customDuration >= 1)
                this.$emit('update:modelValue', this.customDuration);
        },
        onCustomBlur() {
            this.isCustomFocused = false;
            if (!this.customDuration) this.customDuration = null;
        },
    },
};
</script>

<template>
    <div>
        <div class="control-label">{{ t.duration }}</div>
        <div class="duration-row">
            <button v-for="d in quickDurations" :key="d" class="dur-pill" :class="{ active: modelValue === d && !isCustomFocused }" @click="pick(d)">
                {{ d }} {{ t.min }}
            </button>
            <input type="number" inputmode="numeric" class="dur-custom" :placeholder="t.custom" v-model.number="customDuration" @focus="isCustomFocused = true" @blur="onCustomBlur" @input="onCustomInput" min="1">
        </div>
    </div>
</template>
