<script>
const DROP_COUNT = 14;
const ROCKET_SVG_PATH = new Path2D();
// Rocket body
ROCKET_SVG_PATH.moveTo(6, 0);
ROCKET_SVG_PATH.bezierCurveTo(6, 0, 2, 5, 2, 11);
ROCKET_SVG_PATH.bezierCurveTo(2, 13, 3, 14.5, 4, 15.5);
ROCKET_SVG_PATH.lineTo(4.5, 13);
ROCKET_SVG_PATH.lineTo(7.5, 13);
ROCKET_SVG_PATH.lineTo(8, 15.5);
ROCKET_SVG_PATH.bezierCurveTo(9, 14.5, 10, 13, 10, 11);
ROCKET_SVG_PATH.bezierCurveTo(10, 5, 6, 0, 6, 0);
ROCKET_SVG_PATH.closePath();

export default {
    props: {
        rocketCount: { type: Number, default: 0 },
    },
    data() {
        return {
            drops: [],
            rockets: [],
            particles: [],
            _raf: null,
            _ctx: null,
            _w: 0,
            _h: 0,
        };
    },
    watch: {
        rocketCount(n) { this.syncRockets(n); },
    },
    mounted() {
        const canvas = this.$refs.canvas;
        this._ctx = canvas.getContext('2d');
        this.resize();
        this.initDrops();
        this.syncRockets(this.rocketCount);
        window.addEventListener('resize', this.resize);
        document.addEventListener('visibilitychange', this.onVis);
        this.lastTime = performance.now();
        this._raf = requestAnimationFrame(this.tick);
    },
    beforeUnmount() {
        cancelAnimationFrame(this._raf);
        window.removeEventListener('resize', this.resize);
        document.removeEventListener('visibilitychange', this.onVis);
    },
    methods: {
        resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const canvas = this.$refs.canvas;
            this._w = window.innerWidth;
            this._h = window.innerHeight;
            canvas.width = this._w * dpr;
            canvas.height = this._h * dpr;
            canvas.style.width = this._w + 'px';
            canvas.style.height = this._h + 'px';
            this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        },
        initDrops() {
            this.drops = [];
            for (let i = 0; i < DROP_COUNT; i++) {
                this.drops.push(this.makeDrop());
            }
        },
        makeDrop(randomY = true) {
            return {
                x: Math.random() * this._w,
                y: randomY ? Math.random() * this._h : -30 - Math.random() * 60,
                len: 25 + Math.random() * 35,
                speed: 220 + Math.random() * 180,
                opacity: 0.08 + Math.random() * 0.14,
            };
        },
        syncRockets(count) {
            // Add or remove rockets to match count, spread evenly
            while (this.rockets.length < count) {
                this.rockets.push(this.makeRocket());
            }
            if (this.rockets.length > count) {
                this.rockets.length = count;
            }
            // Redistribute x positions evenly with jitter
            const n = this.rockets.length;
            for (let i = 0; i < n; i++) {
                this.rockets[i].x = (this._w / (n + 1)) * (i + 1) + (Math.random() - 0.5) * (this._w / (n + 2));
            }
        },
        makeRocket() {
            return {
                x: Math.random() * this._w,
                y: -20 - Math.random() * 100,
                speed: 300 + Math.random() * 200,
                opacity: 0.25 + Math.random() * 0.15,
            };
        },
        spawnExplosion(x, y) {
            if (this.particles.length > 80) return;
            const count = 6 + Math.floor(Math.random() * 4);
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
                const speed = 60 + Math.random() * 80;
                this.particles.push({
                    x, y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1,
                    decay: 1.5 + Math.random() * 0.8,
                    size: 1.5 + Math.random() * 2.5,
                    hue: 25 + Math.random() * 30,
                });
            }
        },
        onVis() {
            if (!document.hidden) {
                this.lastTime = performance.now();
                if (!this._raf) this._raf = requestAnimationFrame(this.tick);
            }
        },
        tick(now) {
            if (document.hidden) { this._raf = null; return; }
            const dt = Math.min((now - this.lastTime) / 1000, 0.1);
            this.lastTime = now;
            this.update(dt);
            this.draw();
            this._raf = requestAnimationFrame(this.tick);
        },
        update(dt) {
            const h = this._h;
            const w = this._w;
            // Rain
            for (const d of this.drops) {
                d.y += d.speed * dt;
                if (d.y > h + 10) {
                    Object.assign(d, this.makeDrop(false));
                }
            }
            // Rockets
            const atPageBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 30);
            for (const r of this.rockets) {
                r.y += r.speed * dt;
                if (r.y >= h - 10) {
                    if (atPageBottom) this.spawnExplosion(r.x, h - 4);
                    r.y = -20 - Math.random() * 80;
                    r.x = Math.random() * w;
                    r.speed = 300 + Math.random() * 200;
                }
            }
            // Particles
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.life -= p.decay * dt;
                if (p.life <= 0) { this.particles.splice(i, 1); continue; }
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 80 * dt; // gravity
                p.vx *= (1 - 2 * dt); // drag
            }
        },
        draw() {
            const ctx = this._ctx;
            const w = this._w;
            const h = this._h;
            ctx.clearRect(0, 0, w, h);

            // Rain drops
            for (const d of this.drops) {
                const grad = ctx.createLinearGradient(d.x, d.y, d.x, d.y + d.len);
                grad.addColorStop(0, 'transparent');
                grad.addColorStop(0.6, `rgba(147,197,253,${d.opacity * 0.5})`);
                grad.addColorStop(1, `rgba(147,197,253,${d.opacity})`);
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x, d.y + d.len);
                ctx.strokeStyle = grad;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Rockets (nose-up, falling downward like incoming missiles)
            for (const r of this.rockets) {
                ctx.save();
                ctx.translate(r.x, r.y);
                ctx.rotate(Math.PI); // flip 180deg so nose points up
                ctx.translate(-6, -17); // re-center after rotation (path is 12 wide, 17 tall)
                ctx.globalAlpha = r.opacity;
                // Body
                ctx.fillStyle = 'rgba(147,197,253,0.7)';
                ctx.fill(ROCKET_SVG_PATH);
                // Flame (now visually at bottom = trailing upward)
                ctx.beginPath();
                ctx.moveTo(4.5, 13);
                ctx.lineTo(3, 17);
                ctx.lineTo(6, 15.5);
                ctx.lineTo(9, 17);
                ctx.lineTo(7.5, 13);
                ctx.closePath();
                ctx.fillStyle = `rgba(251,146,60,${0.4 + Math.random() * 0.2})`;
                ctx.fill();
                // Porthole
                ctx.beginPath();
                ctx.arc(6, 9, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            // Explosion particles
            for (const p of this.particles) {
                const a = Math.max(0, p.life);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue},100%,60%,${a * 0.9})`;
                ctx.fill();
            }
        },
    },
};
</script>

<template>
    <canvas ref="canvas" class="rain-canvas"></canvas>
</template>

<style scoped>
.rain-canvas {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 0;
    pointer-events: none;
}
</style>
