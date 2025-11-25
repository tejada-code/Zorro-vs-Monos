const CONFIG = {
    canvasWidth: 960,
    canvasHeight: 540,
    paso: 32,
    maxLives: 3,
    shieldDuration: 1000,
    invulnerableMs: 800,
    coinTarget: 3,
    bulletSpeed: 480,
    enemySpawnPadding: 48,
    coinPickupRadius: 24,
    voiceCommands: ['izquierda', 'derecha', 'dispara', 'escudo'],
    levels: [
        { id: 1, enemySpeed: 80, spawnInterval: 2200, backgroundKey: 'level1' },
        { id: 2, enemySpeed: 160, spawnInterval: 1200, backgroundKey: 'level2' }
    ]
};

const dom = {
    menu: document.getElementById('main-menu'),
    instructionsModal: document.getElementById('instructions-modal'),
    levelModal: document.getElementById('level-modal'),
    levelMessage: document.getElementById('level-message'),
    finalModal: document.getElementById('final-modal'),
    finalMessage: document.getElementById('final-message'),
    gameoverModal: document.getElementById('gameover-modal'),
    canvas: document.getElementById('game-canvas'),
    hudCoins: document.getElementById('hud-coins'),
    hudLives: document.getElementById('hud-lives'),
    hudCommand: document.getElementById('hud-command'),
    audioMusic: document.getElementById('music-toggle'),
    audioSfx: document.getElementById('sfx-toggle')
};

const ctx = dom.canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

class AssetLoader {
    constructor() {
        this.manifest = null;
        this.sprites = new Map();
        this.backgrounds = new Map();
    }

    async load() {
        const response = await fetch('assets.json');
        this.manifest = await response.json();
        await Promise.all([
            this.#loadSprites(),
            this.#loadBackgrounds()
        ]);
        return this;
    }

    async #loadSprites() {
        const tasks = Object.entries(this.manifest.sprites).map(async ([key, def]) => {
            const frames = await Promise.all(
                def.frames.map(path => this.#loadImage(path))
            );
            this.sprites.set(key, {
                frames,
                frameRate: def.frameRate ?? 8,
                loop: def.loop ?? true,
                width: def.width ?? frames[0].naturalWidth,
                height: def.height ?? frames[0].naturalHeight
            });
        });
        await Promise.all(tasks);
    }

    async #loadBackgrounds() {
        const tasks = Object.entries(this.manifest.backgrounds).map(async ([key, path]) => {
            const img = await this.#loadImage(path);
            this.backgrounds.set(key, img);
        });
        await Promise.all(tasks);
    }

    #loadImage(path) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = path;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    }

    getSprite(key) {
        return this.sprites.get(key);
    }

    getBackground(key) {
        return this.backgrounds.get(key);
    }
}

class AudioManager {
    constructor(manifest) {
        this.manifest = manifest ?? {};
        this.music = null;
        this.musicEnabled = true;
        this.sfxEnabled = true;
        this.audioCtx = null;
    }

    init() {
        if (this.manifest.music) {
            this.music = new Howl({
                src: [this.manifest.music],
                loop: true,
                volume: 0.4
            });
        }
    }

    playMusic() {
        if (this.music && this.musicEnabled && !this.music.playing()) {
            this.music.play();
        }
    }

    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        if (!this.musicEnabled && this.music && this.music.playing()) {
            this.music.pause();
        } else {
            this.playMusic();
        }
        return this.musicEnabled;
    }

    toggleSfx() {
        this.sfxEnabled = !this.sfxEnabled;
        return this.sfxEnabled;
    }

    playSfx(type) {
        if (!this.sfxEnabled) return;
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const duration = type === 'coin' ? 0.08 : type === 'explosion' ? 0.2 : 0.12;
        const freq = type === 'coin' ? 660 : type === 'explosion' ? 160 : 420;
        const oscillator = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        oscillator.type = type === 'explosion' ? 'sawtooth' : 'square';
        oscillator.frequency.value = freq;
        gain.gain.value = 0.16;
        oscillator.connect(gain).connect(this.audioCtx.destination);
        oscillator.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
        oscillator.stop(this.audioCtx.currentTime + duration);
    }
}

class AnimatedSprite {
    constructor(def) {
        this.def = def;
        this.elapsed = 0;
    }

    update(delta) {
        this.elapsed += delta;
    }

    draw(context, x, y, { flip = false, scale = 1 } = {}) {
        const totalFrames = this.def.frames.length;
        const frameIndex = Math.floor(this.elapsed * this.def.frameRate) % totalFrames;
        const image = this.def.frames[frameIndex];
        const drawWidth = image.naturalWidth * scale;
        const drawHeight = image.naturalHeight * scale;
        context.save();
        context.translate(x, y);
        if (flip) {
            context.scale(-1, 1);
        }
        context.drawImage(
            image,
            flip ? -drawWidth : 0,
            0,
            drawWidth,
            drawHeight
        );
        context.restore();
    }
}

class Entity {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.dead = false;
    }

    get centerX() {
        return this.x + this.width / 2;
    }

    get centerY() {
        return this.y + this.height / 2;
    }

    collides(other) {
        return !(
            this.x + this.width < other.x ||
            this.x > other.x + other.width ||
            this.y + this.height < other.y ||
            this.y > other.y + other.height
        );
    }
}

class Player extends Entity {
    constructor(assetLoader) {
        super(CONFIG.canvasWidth / 2 - 32, CONFIG.canvasHeight - 140, 64, 96);
        this.facing = 'right';
        this.lives = CONFIG.maxLives;
        this.coins = 0;
        this.moving = false;
        this.assets = assetLoader;
        this.invulnerableUntil = 0;
        this.shieldUntil = 0;
        this.bullets = [];
        this.currentAnim = this.#getAnim('idle');
        this.bulletSprite = assetLoader.getSprite('bullet');
    }

    reset() {
        this.x = CONFIG.canvasWidth / 2 - 32;
        this.y = CONFIG.canvasHeight - 140;
        this.facing = 'right';
        this.lives = CONFIG.maxLives;
        this.coins = 0;
        this.bullets = [];
        this.invulnerableUntil = 0;
        this.shieldUntil = 0;
    }

    #getAnim(state) {
        const key = state === 'walk'
            ? (this.facing === 'right' ? 'playerWalkRight' : 'playerWalkLeft')
            : (this.facing === 'right' ? 'playerIdleRight' : 'playerIdleLeft');
        return new AnimatedSprite(this.assets.getSprite(key));
    }

    move(direction) {
        this.facing = direction;
        const delta = direction === 'left' ? -CONFIG.paso : CONFIG.paso;
        this.x = Math.max(0, Math.min(CONFIG.canvasWidth - this.width, this.x + delta));
        this.moving = true;
        this.currentAnim = this.#getAnim('walk');
        setTimeout(() => {
            this.moving = false;
            this.currentAnim = this.#getAnim('idle');
        }, 160);
    }

    shoot() {
        const bullet = new Bullet(
            this.facing === 'right' ? this.x + this.width : this.x - 12,
            this.y + this.height / 2,
            this.facing,
            this.bulletSprite
        );
        this.bullets.push(bullet);
        return bullet;
    }

    activateShield(now) {
        this.shieldUntil = now + CONFIG.shieldDuration;
    }

    takeDamage(now) {
        if (now < this.invulnerableUntil) return false;
        this.lives -= 1;
        this.invulnerableUntil = now + CONFIG.invulnerableMs;
        return true;
    }

    hasShield(now, attackFrom) {
        const shieldActive = now < this.shieldUntil;
        if (!shieldActive) return false;
        return (this.facing === 'right' && attackFrom === 'right') ||
            (this.facing === 'left' && attackFrom === 'left');
    }

    update(delta, now) {
        this.currentAnim.update(delta);
        this.bullets = this.bullets.filter(b => !b.dead);
        this.bullets.forEach(b => b.update(delta));
        if (now > this.shieldUntil) {
            this.shieldUntil = 0;
        }
    }

    draw(context, now) {
        const flip = this.facing === 'left';
        this.currentAnim.draw(context, this.x, this.y, { flip });
        if (now < this.shieldUntil) {
            const sprite = this.assets.getSprite('shieldLeft');
            if (sprite) {
                const anim = new AnimatedSprite(sprite);
                anim.draw(context, this.facing === 'left' ? this.x - 20 : this.x + this.width - 20, this.y + 10, {
                    flip: this.facing === 'right'
                });
            } else {
                context.save();
                context.strokeStyle = '#93c5fd';
                context.lineWidth = 4;
                const offset = this.facing === 'right' ? this.width : 0;
                context.strokeRect(this.x + offset - 10, this.y + 4, 20, this.height - 8);
                context.restore();
            }
        }
        this.bullets.forEach(b => b.draw(context));
    }
}

class Enemy extends Entity {
    constructor(direction, speed, spriteRight, spriteLeft) {
        const width = 64;
        const height = 80;
        const x = direction === 'left'
            ? CONFIG.canvasWidth + CONFIG.enemySpawnPadding
            : -CONFIG.enemySpawnPadding;
        const y = CONFIG.canvasHeight - 120;
        super(x, y, width, height);
        this.direction = direction;
        this.speed = speed;
        this.anim = new AnimatedSprite(direction === 'left' ? spriteLeft : spriteRight);
    }

    update(delta) {
        const step = this.speed * delta;
        this.x += this.direction === 'left' ? -step : step;
        this.anim.update(delta);
        if (this.x < -150 || this.x > CONFIG.canvasWidth + 150) {
            this.dead = true;
        }
    }

    draw(context) {
        this.anim.draw(context, this.x, this.y);
    }
}

class Bullet extends Entity {
    constructor(x, y, direction, spriteDef) {
        super(x, y, 16, 16);
        this.direction = direction;
        this.speed = CONFIG.bulletSpeed;
        this.anim = spriteDef ? new AnimatedSprite(spriteDef) : null;
    }

    update(delta) {
        const step = this.speed * delta;
        this.x += this.direction === 'right' ? step : -step;
        if (this.anim) this.anim.update(delta);
        if (this.x < -50 || this.x > CONFIG.canvasWidth + 50) {
            this.dead = true;
        }
    }

    draw(context) {
        if (this.anim) {
            this.anim.draw(context, this.x, this.y, { flip: this.direction === 'left', scale: 0.5 });
        } else {
            context.fillStyle = '#fde047';
            context.fillRect(this.x, this.y, this.width, this.height);
        }
    }
}

class Coin extends Entity {
    constructor(x, y, sprite) {
        super(x, y, 32, 32);
        this.anim = new AnimatedSprite(sprite);
    }

    update(delta) {
        this.anim.update(delta);
    }

    draw(context) {
        this.anim.draw(context, this.x, this.y);
    }
}

class Explosion {
    constructor(x, y, sprite) {
        this.x = x;
        this.y = y;
        this.anim = new AnimatedSprite(sprite);
        this.elapsed = 0;
        this.done = false;
    }

    update(delta) {
        this.elapsed += delta;
        this.anim.update(delta);
        if (this.elapsed > 0.3) {
            this.done = true;
        }
    }

    draw(context) {
        this.anim.draw(context, this.x, this.y);
    }
}

class VoiceInput {
    constructor(onCommand, onStatus) {
        this.onCommand = onCommand;
        this.onStatus = onStatus;
        this.recognition = null;
        this.enabled = false;
        this.#setup();
    }

    #setup() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.onStatus('Reconocimiento no disponible');
            return;
        }
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
            this.onStatus(`Comando: ${transcript}`);
            if (CONFIG.voiceCommands.includes(transcript)) {
                this.onCommand(transcript);
            }
        };
        this.recognition.onerror = () => {
            this.onStatus('Error de voz');
        };
        this.recognition.onend = () => {
            if (this.enabled) {
                this.recognition.start();
            }
        };
    }

    start() {
        if (this.recognition && !this.enabled) {
            this.recognition.start();
            this.enabled = true;
            this.onStatus('Comando: escuchando…');
        }
    }

    stop() {
        if (this.recognition && this.enabled) {
            this.enabled = false;
            this.recognition.stop();
        }
    }
}

class InputManager {
    constructor(callback, hudUpdater) {
        this.callback = callback;
        this.hudUpdater = hudUpdater;
        this.voice = new VoiceInput(this.#handleCommand.bind(this), hudUpdater);
        this.#bindKeyboard();
    }

    startVoice() {
        this.voice.start();
    }

    stopVoice() {
        this.voice.stop();
    }

    #bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            switch (event.key) {
                case 'ArrowLeft':
                    this.#handleCommand('izquierda');
                    break;
                case 'ArrowRight':
                    this.#handleCommand('derecha');
                    break;
                case 'z':
                case 'Z':
                    this.#handleCommand('dispara');
                    break;
                case 'x':
                case 'X':
                    this.#handleCommand('escudo');
                    break;
                default:
                    return;
            }
            event.preventDefault();
        });
    }

    #handleCommand(command) {
        this.hudUpdater(`Comando: ${command}`);
        this.callback(command);
    }
}

class Game {
    constructor() {
        this.assetLoader = new AssetLoader();
        this.audioManager = null;
        this.inputManager = null;
        this.player = null;
        this.enemies = [];
        this.coins = [];
        this.explosions = [];
        this.lastSpawn = 0;
        this.lastTimestamp = 0;
        this.currentLevelIndex = 0;
        this.running = false;
        this.spawnInterval = 2000;
        this.enemySpeed = 80;
        this.background = null;
        this.state = 'menu';
        this.loop = this.loop.bind(this);
    }

    async init() {
        await this.assetLoader.load();
        this.audioManager = new AudioManager(this.assetLoader.manifest.audio);
        this.audioManager.init();
        this.inputManager = new InputManager(this.#handleCommand.bind(this), (text) => {
            dom.hudCommand.textContent = text;
        });
        this.player = new Player(this.assetLoader);
        this.#bindUI();
        requestAnimationFrame(this.loop);
    }

    #bindUI() {
        document.querySelector('[data-action="play"]').addEventListener('click', () => {
            this.startGame();
        });
        document.querySelector('[data-action="instructions"]').addEventListener('click', () => {
            dom.instructionsModal.classList.remove('hidden');
        });
        document.querySelector('[data-action="sound-toggle"]').addEventListener('click', () => {
            const enabled = this.audioManager.toggleMusic();
            alert(`Música ${enabled ? 'activada' : 'en pausa'}`);
        });
        document.querySelector('[data-action="exit"]').addEventListener('click', () => {
            window.close();
        });
        document.querySelector('[data-action="close-instructions"]').addEventListener('click', () => {
            dom.instructionsModal.classList.add('hidden');
        });
        document.querySelector('[data-action="continue-level"]').addEventListener('click', () => {
            dom.levelModal.classList.add('hidden');
            this.advanceLevel();
        });
        document.getElementById('level-modal').addEventListener('click', (e) => {
            if (e.target.id === 'level-modal') e.currentTarget.classList.add('hidden');
        });
        document.querySelector('[data-action="restart"]').addEventListener('click', () => {
            dom.finalModal.classList.add('hidden');
            this.startGame();
        });
        document.querySelector('[data-action="retry"]').addEventListener('click', () => {
            dom.gameoverModal.classList.add('hidden');
            this.startGame();
        });
        dom.audioMusic.addEventListener('click', () => {
            const enabled = this.audioManager.toggleMusic();
            dom.audioMusic.textContent = enabled ? 'Música' : 'Música (mute)';
        });
        dom.audioSfx.addEventListener('click', () => {
            const enabled = this.audioManager.toggleSfx();
            dom.audioSfx.textContent = enabled ? 'SFX' : 'SFX (mute)';
        });
    }

    startGame() {
        dom.menu.classList.remove('screen--active');
        dom.instructionsModal.classList.add('hidden');
        dom.finalModal.classList.add('hidden');
        dom.gameoverModal.classList.add('hidden');
        this.currentLevelIndex = 0;
        this.player.reset();
        this.player.coins = 0;
        this.enemies = [];
        this.coins = [];
        this.explosions = [];
        this.running = true;
        this.state = 'playing';
        this.lastSpawn = performance.now();
        this.configureLevel(CONFIG.levels[this.currentLevelIndex]);
        this.inputManager.startVoice();
        this.audioManager.playMusic();
    }

    configureLevel(levelConfig) {
        this.spawnInterval = levelConfig.spawnInterval;
        this.enemySpeed = levelConfig.enemySpeed;
        this.background = this.assetLoader.getBackground(levelConfig.backgroundKey);
        dom.hudCoins.textContent = `Monedas: ${this.player.coins}/3`;
        dom.hudLives.textContent = `Vidas: ${'❤'.repeat(this.player.lives)}`;
    }

    advanceLevel() {
        if (this.currentLevelIndex + 1 >= CONFIG.levels.length) {
            dom.finalMessage.textContent = '¡Victoria! Has derrotado a los monos.';
            dom.finalModal.classList.remove('hidden');
            this.running = false;
            this.state = 'victory';
            this.inputManager.stopVoice();
            return;
        }
        this.currentLevelIndex += 1;
        this.player.coins = 0;
        this.enemies = [];
        this.coins = [];
        this.configureLevel(CONFIG.levels[this.currentLevelIndex]);
        this.state = 'playing';
        this.running = true;
    }

    loop(timestamp) {
        const delta = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0;
        this.lastTimestamp = timestamp;
        if (this.running) {
            this.update(delta, timestamp);
            this.render();
        } else {
            this.render();
        }
        requestAnimationFrame(this.loop);
    }

    update(delta, now) {
        const msNow = performance.now();
        this.player.update(delta, msNow);
        this.enemies.forEach(enemy => enemy.update(delta));
        this.enemies = this.enemies.filter(e => !e.dead);
        this.coins.forEach(coin => coin.update(delta));
        this.explosions.forEach(explosion => explosion.update(delta));
        this.explosions = this.explosions.filter(e => !e.done);

        if (now - this.lastSpawn > this.spawnInterval) {
            this.spawnEnemy();
            this.lastSpawn = now;
        }

        this.handleCollisions(msNow);

        this.player.bullets = this.player.bullets.filter(b => !b.dead);
        dom.hudCoins.textContent = `Monedas: ${this.player.coins}/3`;
        dom.hudLives.textContent = `Vidas: ${'❤'.repeat(this.player.lives)}`;
    }

    handleCollisions(now) {
        // Bala vs enemigo
        this.player.bullets.forEach(bullet => {
            this.enemies.forEach(enemy => {
                if (!bullet.dead && !enemy.dead && bullet.collides(enemy)) {
                    bullet.dead = true;
                    enemy.dead = true;
                    this.audioManager.playSfx('explosion');
                    this.explosions.push(new Explosion(enemy.x, enemy.y, this.assetLoader.getSprite('explosion')));
                    setTimeout(() => {
                        this.coins.push(new Coin(enemy.x, enemy.y, this.assetLoader.getSprite('coin')));
                    }, 300);
                }
            });
        });

        // Jugador vs enemigo
        this.enemies.forEach(enemy => {
            if (!enemy.dead && this.player.collides(enemy)) {
                const attackFrom = enemy.centerX > this.player.centerX ? 'right' : 'left';
                if (this.player.hasShield(now, attackFrom)) {
                    enemy.dead = true;
                } else if (this.player.takeDamage(now)) {
                    this.audioManager.playSfx('hit');
                    enemy.dead = true;
                    if (this.player.lives <= 0) {
                        this.triggerGameOver();
                    }
                }
            }
        });

        // Jugador vs moneda
        this.coins.forEach(coin => {
            if (!coin.dead && this.player.collides(coin)) {
                coin.dead = true;
                this.player.coins += 1;
                this.audioManager.playSfx('coin');
                if (this.player.coins >= CONFIG.coinTarget && this.state === 'playing') {
                    if (this.currentLevelIndex === 0) {
                        dom.levelMessage.textContent = 'Ganaste la batalla, pero la guerra aún sigue';
                        dom.levelModal.classList.remove('hidden');
                        this.running = false;
                        this.state = 'levelTransition';
                        this.inputManager.stopVoice();
                    } else {
                        dom.finalMessage.textContent = '¡Victoria! Has derrotado a los monos.';
                        dom.finalModal.classList.remove('hidden');
                        this.state = 'victory';
                        this.running = false;
                        this.inputManager.stopVoice();
                    }
                }
            }
        });
        this.coins = this.coins.filter(c => !c.dead);
    }

    spawnEnemy() {
        const direction = Math.random() > 0.5 ? 'left' : 'right';
        const enemy = new Enemy(
            direction,
            this.enemySpeed,
            this.assetLoader.getSprite('enemyWalkRight'),
            this.assetLoader.getSprite('enemyWalkLeft')
        );
        if (direction === 'left') {
            enemy.x = CONFIG.canvasWidth + CONFIG.enemySpawnPadding;
        } else {
            enemy.x = -CONFIG.enemySpawnPadding;
        }
        this.enemies.push(enemy);
    }

    render() {
        if (this.background) {
            ctx.drawImage(this.background, 0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
        }
        this.player.draw(ctx, performance.now());
        this.enemies.forEach(enemy => enemy.draw(ctx));
        this.coins.forEach(coin => coin.draw(ctx));
        this.explosions.forEach(explosion => explosion.draw(ctx));
    }

    #handleCommand(command) {
        if (this.state !== 'playing') return;
        switch (command) {
            case 'izquierda':
                this.player.move('left');
                break;
            case 'derecha':
                this.player.move('right');
                break;
            case 'dispara':
                const bullet = this.player.shoot();
                if (bullet) {
                    this.audioManager.playSfx('shot');
                }
                break;
            case 'escudo':
                this.player.activateShield(performance.now());
                this.audioManager.playSfx('shield');
                break;
            default:
                break;
        }
    }

    triggerGameOver() {
        this.running = false;
        this.state = 'gameover';
        this.inputManager.stopVoice();
        dom.gameoverModal.classList.remove('hidden');
    }
}

const game = new Game();
game.init();

