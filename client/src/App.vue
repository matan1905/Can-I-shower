<script>
export default {};
</script>

<template>
    <div>
        <div class="app peacetime">
            <header class="peace-header">
                <h1 class="peace-title">🚿</h1>
                <h2 class="peace-answer peace-answer--he">כן, אפשר להתקלח!</h2>
                <h2 class="peace-answer peace-answer--en">YES, you can shower!</h2>
                <p class="peace-subtitle">המלחמה נגמרה. אין אזעקות. לכו תתקלחו בשקט.</p>
                <p class="peace-subtitle peace-subtitle--en">The war is over. No alerts. Go shower in peace.</p>
            </header>

            <section class="peace-notice">
                <p class="notice-title">השירות סגור 🎉</p>
                <p class="notice-body">
                    האתר הזה נבנה כדי לעזור לדעת מתי בטוח להתקלח בזמן מלחמה.<br>
                    עכשיו שהמלחמה נגמרה — תמיד בטוח.<br><br>
                    <strong>האתר יחזור לפעילות אם ומתי שיהיה צורך.</strong>
                </p>
                <p class="notice-body notice-body--en">
                    This site was built to help people know when it's safe to shower during wartime.<br>
                    Now that the war is over — it's always safe.<br><br>
                    <strong>The site is free and will reopen if and when it's needed again.</strong>
                </p>
            </section>
        </div>
    </div>
</template>

<style scoped>
.peacetime {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 80vh;
    text-align: center;
    gap: 2rem;
}
.peace-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
}
.peace-title {
    font-size: 5rem;
    margin-bottom: 0.5rem;
}
.peace-answer {
    font-size: clamp(2rem, 6vw, 3.5rem);
    font-weight: 800;
    color: #4ade80;
    margin: 0;
}
.peace-answer--en {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
    color: #86efac;
}
.peace-subtitle {
    font-size: 1.1rem;
    color: #94a3b8;
    margin-top: 0.5rem;
}
.peace-subtitle--en {
    font-size: 0.95rem;
    color: #64748b;
}
.peace-notice {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    padding: 2rem;
    max-width: 500px;
}
.notice-title {
    font-size: 1.3rem;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 1rem;
}
.notice-body {
    font-size: 0.95rem;
    color: #94a3b8;
    line-height: 1.7;
}
.notice-body--en {
    margin-top: 1.5rem;
    font-size: 0.85rem;
    color: #64748b;
}
</style>
