## Zorro vs Monos

Juego 2D HTML5 + Canvas controlado por voz donde el héroe Zorro debe derrotar a monos invasores y recolectar monedas para avanzar de nivel.

### Cómo ejecutar
- Abre `index.html` en un navegador moderno como Google Chrome para tener soporte completo de Web Speech API.
- Asegúrate de conceder permiso para usar el micrófono cuando el navegador lo solicite.

### Controles

#### Comandos de Voz (Español)
- **`izquierda`**: Mueve al personaje hacia la izquierda.
- **`derecha`**: Mueve al personaje hacia la derecha.
- **`dispara`**: Dispara una bala en la dirección actual.
- **`escudo`**: Activa un escudo protector por un breve período.

#### Teclado (Fallback)
- **`←` (Flecha Izquierda)**: Mueve al personaje hacia la izquierda.
- **`→` (Flecha Derecha)**: Mueve al personaje hacia la derecha.
- **`Z`**: Dispara una bala.
- **`X`**: Activa el escudo.

### Parámetros Ajustables (en `game.js`)

Puedes ajustar el comportamiento del juego modificando el objeto `CONFIG` al inicio del archivo `game.js`:

- `CONFIG.paso`: Tamaño del paso en píxeles por cada comando de movimiento (por defecto: 32).
- `CONFIG.levels`: Un array que controla los niveles. Puedes ajustar la velocidad de los enemigos (`enemySpeed`) y la frecuencia con la que aparecen (`spawnInterval`) para cada nivel.
- `CONFIG.shieldDuration`: Duración del escudo en milisegundos (por defecto: 1000).
- `CONFIG.invulnerableMs`: Tiempo de invulnerabilidad después de recibir un golpe (por defecto: 800).
- `CONFIG.coinTarget`: Número de monedas necesarias para pasar de nivel (por defecto: 3).
- `CONFIG.coinLifetime`: Tiempo en milisegundos antes de que una moneda desaparezca si no se recoge (por defecto: 3000).

### Assets
- Todos los assets (imágenes, sonidos) se definen en `assets.json`.
- El juego espera la siguiente estructura de carpetas:
  - `/sprites/`
  - `/fondo/`
  - `/sonido/`

### Compatibilidad
- **Recomendado**: Google Chrome o Microsoft Edge para un soporte óptimo de la Web Speech API.
- En otros navegadores, el juego funcionará utilizando únicamente los controles de teclado.

### Créditos
- **Autor**: Rodrigo Alonso Tejada Morales.