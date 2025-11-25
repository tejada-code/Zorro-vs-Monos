const CONFIG = {
    canvasWidth: 960,
    canvasHeight: 540,
    paso: 32, // 2 * 16px
    maxLives: 3,
    groundOffset: 48,
    shieldDuration: 1000,
    invulnerableMs: 800,
    coinTarget: 3,
    bulletSpeed: 480,
    coinLifetime: 0, // 0 = las monedas no desaparecen
    enemySpawnPadding: 48,
    coinPickupRadius: 24,
    voiceCommands: ['izquierda', 'derecha', 'dispara', 'escudo'],
    levels: [
        { id: 1, enemySpeed: 20, spawnInterval: 2200, backgroundKey: 'level1' },
        { id: 2, enemySpeed: 50, spawnInterval: 1200, backgroundKey: 'level2' }
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
        this.audio = new Map();
    }

    async load() {
        const response = await fetch('assets.json');
        this.manifest = await response.json();
        await Promise.all([
            this.#loadSprites(),
            this.#loadBackgrounds(),
            this.#loadAudio()
        ]);
        return this;
    }

    async #loadSprites() {
        const tasks = Object.entries(this.manifest.sprites).map(async ([key, def]) => {
            const sheet = await this.#loadImage(def.spritesheet);
            const frames = this.#sliceSheet(sheet, def);
            this.sprites.set(key, { frames, frameRate: def.frameRate ?? 8, loop: def.loop ?? true, width: def.frameWidth, height: def.frameHeight });
        });
        await Promise.all(tasks);
    }

    #sliceSheet(sheet, def) {
        const frameCount = def.frameCount ?? 1;
        const frameWidth = def.frameWidth ?? Math.floor(sheet.naturalWidth / frameCount);
        const frameHeight = def.frameHeight ?? sheet.naturalHeight;
        const frames = [];
        for (let i = 0; i < frameCount; i += 1) {
            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            const context = canvas.getContext('2d');
            context.drawImage(sheet, i * frameWidth, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            if (this.#hasVisiblePixels(context, frameWidth, frameHeight)) { frames.push(canvas); }
        }
        // Si después de filtrar no queda ningún frame, añadimos uno vacío para evitar errores.
        if (frames.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            frames.push(canvas);
        }
        return frames;
    }

    async #loadBackgrounds() {
        const tasks = Object.entries(this.manifest.backgrounds).map(async ([key, path]) => {
            const img = await this.#loadImage(path);
            this.backgrounds.set(key, img);
        });
        await Promise.all(tasks);
    }

    async #loadAudio() {
        if (this.manifest.audio.music) {
            this.audio.set('music', new Howl({ src: [this.manifest.audio.music], loop: true, volume: 0.4 }));
        }
        if (this.manifest.audio.sfx) {
            for (const [key, path] of Object.entries(this.manifest.audio.sfx)) {
                this.audio.set(key, new Howl({ src: [path], volume: 0.6 }));
            }
        }
    }

    #loadImage(path) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = path;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    }

    #hasVisiblePixels(context, width, height) {
        // Revisa el canal alfa de cada píxel. Si alguno es mayor a 0, el frame no está vacío.
        const imageData = context.getImageData(0, 0, width, height).data;
        for (let i = 3; i < imageData.length; i += 4) {
            if (imageData[i] > 0) return true;
        }
        return false;
    }

    getSprite(key) { return this.sprites.get(key); }
    getBackground(key) { return this.backgrounds.get(key); }
    getAudio(key) { return this.audio.get(key); }
}

class AudioManager {
    constructor(assetLoader) {
        this.assetLoader = assetLoader;
        this.musicEnabled = true;
        this.sfxEnabled = true;
    }

    playMusic() {
        const music = this.assetLoader.getAudio('music');
        if (music && this.musicEnabled && !music.playing()) {
            music.play();
        }
    }

    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        const music = this.assetLoader.getAudio('music');
        if (music) {
            this.musicEnabled ? music.play() : music.pause();
        }
        return this.musicEnabled;
    }

    toggleSfx() {
        this.sfxEnabled = !this.sfxEnabled;
        return this.sfxEnabled;
    }

    playSfx(type) {
        if (!this.sfxEnabled) return;
        const sfx = this.assetLoader.getAudio(type);
        if (sfx) sfx.play();
    }
}

class AnimatedSprite {
    constructor(def) {
        this.def = def;
        this.elapsed = 0;
    }

    update(delta) { this.elapsed += delta; }
    reset() { this.elapsed = 0; }

    draw(context, x, y, { flip = false } = {}) {
        if (!this.def || !this.def.frames.length) return;
        let frameIndex = Math.floor(this.elapsed * this.def.frameRate);
        if (this.def.loop) {
            frameIndex %= this.def.frames.length;
        } else {
            frameIndex = Math.min(frameIndex, this.def.frames.length - 1);
        }
        const image = this.def.frames[frameIndex];
        context.save();
        context.translate(x, y);
        if (flip) {
            context.scale(-1, 1);
            context.drawImage(image, -this.def.width, 0, this.def.width, this.def.height);
        } else {
            context.drawImage(image, 0, 0, this.def.width, this.def.height);
        }
        context.restore();
    }
}

class Entity {
    constructor(x, y, width, height) {
        this.x = x; this.y = y; this.width = width; this.height = height; this.dead = false;
        // Por defecto, el hitbox es toda la entidad. Se puede sobreescribir.
        this.hitbox = { x: 0, y: 0, width, height };
    }
    get centerX() { return this.x + this.width / 2; }
    get centerY() { return this.y + this.height / 2; }
    collides(other) {
        const r1 = { x: this.x + this.hitbox.x, y: this.y + this.hitbox.y, width: this.hitbox.width, height: this.hitbox.height };
        const r2 = { x: other.x + other.hitbox.x, y: other.y + other.hitbox.y, width: other.hitbox.width, height: other.hitbox.height };

        return !(r1.x + r1.width < r2.x ||
                 r1.x > r2.x + r2.width ||
                 r1.y + r1.height < r2.y ||
                 r1.y > r2.y + r2.height);
    }
}

class Player extends Entity {
    constructor(assetLoader) {
        const width = 64, height = 64;
        super(CONFIG.canvasWidth / 2 - width / 2, CONFIG.canvasHeight - CONFIG.groundOffset - height, width, height);
        this.assets = assetLoader;
        // Hitbox más ajustado para el jugador para que la colisión sea más precisa.
        this.hitbox = { x: 18, y: 10, width: 28, height: 54 };
        this.animations = {
            idle: new AnimatedSprite(this.assets.getSprite('playerIdleRight')),
            walk: new AnimatedSprite(this.assets.getSprite('playerWalkRight')),
            shoot: new AnimatedSprite(this.assets.getSprite('shotRight')),
            idleLeft: new AnimatedSprite(this.assets.getSprite('playerIdleLeft')),
            walkLeft: new AnimatedSprite(this.assets.getSprite('playerWalkLeft')),
            shootLeft: new AnimatedSprite(this.assets.getSprite('shotLeft')),
            shield: new AnimatedSprite(this.assets.getSprite('shieldLeft'))
        };
        this.reset();
    }

    reset() {
        this.x = CONFIG.canvasWidth / 2 - this.width / 2;
        this.y = CONFIG.canvasHeight - CONFIG.groundOffset - this.height;
        this.facing = 'right';
        this.lives = CONFIG.maxLives;
        this.coins = 0;
        this.bullets = [];
        this.invulnerableUntil = 0;
        this.shieldUntil = 0;
        this.actionState = 'idle';
        this.actionTimeout = null;
        this.currentAnim = this.animations.idle;
    }

    #setAnimation(state) {
        const animKey = this.facing === 'left' ? `${state}Left` : state;
        const target = this.animations[animKey] ?? this.animations[state];
        if (target && this.currentAnim !== target) {
            target.reset();
            this.currentAnim = target;
        }
    }

    move(direction) {
        clearTimeout(this.actionTimeout);
        this.actionState = 'walk';
        this.facing = direction;
        this.x = Math.max(0, Math.min(CONFIG.canvasWidth - this.width, this.x + (direction === 'left' ? -CONFIG.paso : CONFIG.paso)));
        this.actionTimeout = setTimeout(() => { if (this.actionState === 'walk') this.actionState = 'idle'; }, 150);
    }

    shoot() {
        clearTimeout(this.actionTimeout);
        this.actionState = 'shoot';
        const bullet = new Bullet(this.facing === 'right' ? this.x + this.width : this.x - 16, this.y + 28, this.facing, this.assets.getSprite('bullet'));
        this.bullets.push(bullet);
        this.actionTimeout = setTimeout(() => { if (this.actionState === 'shoot') this.actionState = 'idle'; }, 300);
        return bullet;
    }

    activateShield(now) {
        if (this.actionState === 'shoot') return;
        clearTimeout(this.actionTimeout);
        this.actionState = 'shield';
        this.shieldUntil = now + CONFIG.shieldDuration;
        this.actionTimeout = setTimeout(() => { if (this.actionState === 'shield') this.actionState = 'idle'; }, CONFIG.shieldDuration);
    }

    takeDamage(now) {
        if (now < this.invulnerableUntil) return false;
        this.lives -= 1;
        this.invulnerableUntil = now + CONFIG.invulnerableMs;
        return true;
    }

    hasShield(now, attackFrom) {
        return now < this.shieldUntil && this.facing === attackFrom;
    }

    update(delta, now) {
        this.#setAnimation(this.actionState);
        this.currentAnim.update(delta);
        this.bullets.forEach(b => b.update(delta));
        this.bullets = this.bullets.filter(b => !b.dead);
    }

    draw(context, now) {
        // Dibuja la animación base del personaje (idle, walk, shoot).
        // La lógica de update() ya selecciona la animación correcta (ej: walkLeft),
        // por lo que no se necesita flip aquí.
        if (this.actionState !== 'shield') this.currentAnim.draw(context, this.x, this.y);

        // Si el escudo está activo, lo dibujamos siempre encima. El sprite base es el izquierdo,
        // así que lo espejeamos (`flip`) solo cuando el jugador mira a la derecha para que cubra el frente.
        if (now < this.shieldUntil) this.animations.shield.draw(context, this.x, this.y, { flip: this.facing === 'right' });
    }
}

class Enemy extends Entity {
    constructor(direction, speed, spriteRight, spriteLeft) {
        const width = 64, height = 64;
        const x = direction === 'left' ? CONFIG.canvasWidth + CONFIG.enemySpawnPadding : -CONFIG.enemySpawnPadding;
        super(x, CONFIG.canvasHeight - CONFIG.groundOffset - height, width, height);
        this.direction = direction;
        // Hitbox más ajustado para el enemigo.
        this.hitbox = { x: 12, y: 8, width: 40, height: 56 };
        this.speed = speed;
        this.anim = new AnimatedSprite(direction === 'left' ? spriteLeft : spriteRight);
    }

    update(delta) {
        this.x += (this.direction === 'left' ? -1 : 1) * this.speed * delta;
        this.anim.update(delta);
        if (this.x < -150 || this.x > CONFIG.canvasWidth + 150) this.dead = true;
    }

    draw(context) { this.anim.draw(context, this.x, this.y); }
}

class Bullet extends Entity {
    constructor(x, y, direction, spriteDef) {
        super(x, y, 16, 16);
        this.direction = direction;
        // Hitbox para la bala.
        this.hitbox = { x: 2, y: 2, width: 12, height: 12 };
        this.anim = new AnimatedSprite(spriteDef);
    }
    update(delta) {
        this.x += (this.direction === 'right' ? 1 : -1) * CONFIG.bulletSpeed * delta;
        this.anim.update(delta);
        if (this.x < -50 || this.x > CONFIG.canvasWidth + 50) this.dead = true;
    }
    draw(context) { this.anim.draw(context, this.x, this.y); }
}

class Coin extends Entity {
    constructor(x, y, sprite) {
        super(x, y, 16, 16);
        this.createdAt = performance.now();
        // Hitbox para la moneda.
        this.hitbox = { x: 0, y: 0, width: 16, height: 16 };
        this.anim = new AnimatedSprite(sprite);
    }
    update(delta) {
        if (CONFIG.coinLifetime > 0 && performance.now() - this.createdAt > CONFIG.coinLifetime) this.dead = true;
        this.anim.update(delta);
    }
    draw(context) { this.anim.draw(context, this.x, this.y); }
}

class Explosion extends Entity {
    constructor(x, y, sprite) {
        super(x, y, 32, 32);
        this.anim = new AnimatedSprite(sprite);
        this.duration = (sprite.frames.length / sprite.frameRate) * 1000;
        this.createdAt = performance.now();
    }
    update() {
        if (performance.now() - this.createdAt > this.duration) this.dead = true;
        this.anim.update(1/60); // Fake delta for simplicity
    }
    draw(context) { this.anim.draw(context, this.x, this.y); }
}

class VoiceInput {
    constructor(onCommand, onStatus) {
        this.onCommand = onCommand;
        this.onStatus = onStatus;
        this.recognition = null;
        this.enabled = false;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.onStatus('Voz no disponible');
            return;
        }
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        const commandCooldowns = new Map(); // Para evitar que un solo comando se dispare múltiples veces.

        this.recognition.onresult = (event) => {
            const result = event.results[event.results.length - 1];
            const transcript = result[0].transcript.trim().toLowerCase();
            const now = performance.now();

            for (const command of CONFIG.voiceCommands) {
                const lastUsed = commandCooldowns.get(command) || 0;
                const commandRegex = new RegExp(`\\b${command}\\b`);

                // Si el comando se detecta y ha pasado el tiempo de enfriamiento, se ejecuta.
                if (commandRegex.test(transcript) && now - lastUsed > 250) { // Cooldown de 250ms
                    this.onCommand(command);
                    commandCooldowns.set(command, now); // Se reinicia el temporizador para ese comando.
                }
            }
        };
        this.recognition.onerror = (event) => {
            this.onStatus(`Error de voz: ${event.error}`);
            this.enabled = false;
        };
        this.recognition.onend = () => { if (this.enabled) this.recognition.start(); };
    }

    start() {
        if (this.recognition && !this.enabled) {
            try {
                this.recognition.start();
                this.enabled = true;
                this.onStatus('Comando: escuchando…');
            } catch (e) { this.onStatus('Error al iniciar micrófono.'); }
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.voice.start();
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                stream.getTracks().forEach(track => track.stop());
                this.voice.start();
            })
            .catch(() => this.hudUpdater('Micrófono bloqueado.'));
    }

    stopVoice() { this.voice.stop(); }

    #bindKeyboard() {
        window.addEventListener('keydown', (e) => {
            let command = null;
            switch (e.key) {
                case 'ArrowLeft': command = 'izquierda'; break;
                case 'ArrowRight': command = 'derecha'; break;
                case 'z': case 'Z': command = 'dispara'; break;
                case 'x': case 'X': command = 'escudo'; break;
            }
            if (command) {
                e.preventDefault();
                this.#handleCommand(command);
            }
        });
    }

    #handleCommand(command) {
        this.hudUpdater(`Comando: ${command}`);
        this.callback(command);
    }
}

class Game {
    constructor() {
        this.state = 'loading';
        this.assetLoader = new AssetLoader();
        this.audioManager = null;
        this.inputManager = null;
        this.player = null;
        this.enemies = [];
        this.coins = [];
        this.explosions = [];
        this.lastTimestamp = 0;
        this.currentLevelIndex = 0;
        this.lastSpawn = 0;
        this.loop = this.loop.bind(this);
    }

    async init() {
        await this.assetLoader.load();
        this.audioManager = new AudioManager(this.assetLoader);
        this.inputManager = new InputManager(this.#handleCommand.bind(this), (text) => dom.hudCommand.textContent = text);
        this.player = new Player(this.assetLoader);
        this.#bindUI();
        this.state = 'menu';
        requestAnimationFrame(this.loop);
    }

    #bindUI() {
        document.body.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            switch (action) {
                case 'play': this.startGame(); break;
                case 'instructions': dom.instructionsModal.classList.remove('hidden'); break;
                case 'close-instructions': dom.instructionsModal.classList.add('hidden'); break;
                case 'sound-toggle': this.audioManager.toggleMusic(); break;
                case 'exit': window.close(); break;
                case 'continue-level': dom.levelModal.classList.add('hidden'); this.advanceLevel(); break;
                case 'restart': dom.finalModal.classList.add('hidden'); this.returnToMenu(); break;
                case 'retry': dom.gameoverModal.classList.add('hidden'); this.startGame(); break;
            }
        });
        dom.audioMusic.addEventListener('click', () => dom.audioMusic.textContent = this.audioManager.toggleMusic() ? 'Música' : 'Música (Mute)');
        dom.audioSfx.addEventListener('click', () => dom.audioSfx.textContent = this.audioManager.toggleSfx() ? 'SFX' : 'SFX (Mute)');
    }

    startGame() {
        dom.menu.classList.remove('screen--active');
        this.currentLevelIndex = 0;
        this.player.reset();
        this.configureLevel(CONFIG.levels[this.currentLevelIndex]);
        this.state = 'playing';
        this.lastSpawn = performance.now();
        this.inputManager.startVoice();
        this.audioManager.playMusic();
    }

    configureLevel(levelConfig) {
        this.enemies = [];
        this.coins = [];
        this.explosions = [];
        this.player.coins = 0;
        this.levelConfig = levelConfig;
        this.background = this.assetLoader.getBackground(levelConfig.backgroundKey);
        this.updateHUD();
    }

    advanceLevel() {
        this.currentLevelIndex++;
        if (this.currentLevelIndex >= CONFIG.levels.length) {
            this.state = 'victory';
            dom.finalModal.classList.remove('hidden');
            this.inputManager.stopVoice();
        } else {
            this.configureLevel(CONFIG.levels[this.currentLevelIndex]);
            this.state = 'playing';
            this.inputManager.startVoice();
        }
    }

    loop(timestamp) {
        const delta = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0;
        this.lastTimestamp = timestamp;
        if (this.state === 'playing') {
            this.update(delta, timestamp);
        }
        this.render();
        requestAnimationFrame(this.loop);
    }

    returnToMenu() {
        dom.finalModal.classList.add('hidden');
        dom.gameoverModal.classList.add('hidden');
        dom.levelModal.classList.add('hidden');
        dom.menu.classList.add('screen--active');
        this.state = 'menu';
        this.inputManager.stopVoice();
    }

    update(delta, now) {
        this.player.update(delta, now);
        this.enemies.forEach(e => e.update(delta));
        this.coins.forEach(c => c.update(delta));
        this.explosions.forEach(e => e.update(delta));

        this.enemies = this.enemies.filter(e => !e.dead);
        this.coins = this.coins.filter(c => !c.dead);
        this.explosions = this.explosions.filter(e => !e.dead);

        if (now - this.lastSpawn > this.levelConfig.spawnInterval) {
            this.spawnEnemy();
            this.lastSpawn = now;
        }
        this.handleCollisions(now);
        this.updateHUD();
    }

    handleCollisions(now) {
        this.player.bullets.forEach(bullet => {
            this.enemies.forEach(enemy => {
                if (!bullet.dead && !enemy.dead && bullet.collides(enemy)) {
                    bullet.dead = true;
                    enemy.dead = true;
                    this.audioManager.playSfx('explosion');
                    this.explosions.push(new Explosion(enemy.centerX - 16, enemy.centerY - 16, this.assetLoader.getSprite('explosion')));
                    setTimeout(() => this.coins.push(new Coin(enemy.centerX - 8, enemy.centerY - 8, this.assetLoader.getSprite('coin'))), 300);
                }
            });
        });

        this.enemies.forEach(enemy => {
            if (!enemy.dead && this.player.collides(enemy)) {
                const attackFrom = enemy.centerX > this.player.centerX ? 'right' : 'left';
                if (this.player.hasShield(now, attackFrom)) {
                    this.audioManager.playSfx('shield');
                    // Empuja al enemigo hacia atrás si el escudo está activo.
                    const pushDelta = enemy.direction === 'left' ? CONFIG.paso * 3 : -CONFIG.paso * 3;
                    enemy.x += pushDelta;
                } else if (this.player.takeDamage(now)) {
                    this.audioManager.playSfx('hit');
                    // Empuja al jugador en la dirección opuesta al mono.
                    const pushDirection = attackFrom === 'right' ? 'left' : 'right';
                    const pushDelta = pushDirection === 'left' ? -CONFIG.paso * 2 : CONFIG.paso * 2;
                    this.player.x = Math.max(0, Math.min(CONFIG.canvasWidth - this.player.width, this.player.x + pushDelta));
                    if (this.player.lives <= 0) this.triggerGameOver();
                }
            }
        });

        this.coins.forEach(coin => {
            if (!coin.dead && this.player.collides(coin)) {
                const wasAlreadyDead = coin.dead;
                coin.dead = true;
                // Solo contamos la moneda si no estaba ya "muerta", para evitar contarla varias veces.
                if (!wasAlreadyDead) {
                    this.player.coins++;
                    this.audioManager.playSfx('coin');
                    if (this.player.coins >= CONFIG.coinTarget) {
                        this.state = 'levelTransition';
                        dom.levelModal.classList.remove('hidden');
                        this.inputManager.stopVoice();
                    }
                }
            }
        });
    }

    spawnEnemy() {
        const direction = Math.random() > 0.5 ? 'left' : 'right';
        this.enemies.push(new Enemy(direction, this.levelConfig.enemySpeed, this.assetLoader.getSprite('enemyWalkRight'), this.assetLoader.getSprite('enemyWalkLeft')));
    }

    render() {
        ctx.clearRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
        if (this.background) {
            ctx.drawImage(this.background, 0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
        }
        if (this.state === 'playing' || this.state === 'levelTransition' || this.state === 'gameover') {
            this.player.draw(ctx, performance.now());
            this.player.bullets.forEach(b => b.draw(ctx));
            this.enemies.forEach(e => e.draw(ctx));
            this.coins.forEach(c => c.draw(ctx));
            this.explosions.forEach(e => e.draw(ctx));
        }
    }

    updateHUD() {
        dom.hudCoins.textContent = `Monedas: ${this.player.coins}/${CONFIG.coinTarget}`;
        dom.hudLives.textContent = `Vidas: ${'❤'.repeat(this.player.lives)}`;
    }

    #handleCommand(command) {
        if (this.state !== 'playing') return;
        switch (command) {
            case 'izquierda': this.player.move('left'); break;
            case 'derecha': this.player.move('right'); break;
            case 'dispara':
                if (this.player.shoot()) this.audioManager.playSfx('shot');
                break;
            case 'escudo':
                this.player.activateShield(performance.now());
                this.audioManager.playSfx('shield');
                break;
        }
    }

    triggerGameOver() {
        this.state = 'gameover';
        this.inputManager.stopVoice();
        dom.gameoverModal.classList.remove('hidden');
    }
}

const game = new Game();
game.init();
