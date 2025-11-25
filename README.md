## Zorro vs Monos

Juego 2D HTML5 + Canvas controlado por voz donde el héroe Zorro debe derrotar a monos invasores y recolectar monedas para avanzar de nivel.

### Cómo ejecutar
- Abre `index.html` en Google Chrome para tener soporte de Web Speech API (recomendado).
- Asegúrate de conceder permiso al micrófono cuando el navegador lo solicite.

### Controles
- **Voz**: `izquierda`, `derecha`, `dispara`, `escudo`.
- **Teclado (fallback)**: `←` / `→` mueven dos pasos por pulsación, `Z` dispara, `X` activa escudo.

### Parámetros ajustables
- `CONFIG.paso`: tamaño del paso por comando (por defecto 32 px).
- `CONFIG.levels`: controla velocidad (`enemySpeed`) y frecuencia de aparición (`spawnInterval`) de los monos.
- `CONFIG.shieldDuration`, `CONFIG.invulnerableMs`, `CONFIG.coinTarget` para balancear dificultad.

### Assets
- Configurados en `assets.json`. Cada sprite puede declararse con múltiples frames o uno solo.
- Rutas esperadas:
  - Sprites: `./sprites/...`
  - Fondos: `./fondo/...`
  - Sonido: `./sonido/...`

### Audio
- Se usa Howler.js para la música (`/sonido/musica_fondo.mp3`).
- Los efectos se generan con Web Audio API para asegurar compatibilidad.

### Compatibilidad
- Chrome/Edge con Web Speech API. Otros navegadores utilizarán solo el esquema de teclado.

### Créditos
- Proyecto: Rodrigo Alonso Tejada Morales.

