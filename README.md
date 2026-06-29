# 🐺 Los Hombres Lobo de Castronegro — Web

Juego online multijugador hasta 24 personas.

## Cómo correr localmente

```bash
npm install
npm start
```
Abre http://localhost:3000

---

## Cómo hostear gratis en Railway (recomendado)

1. Crea cuenta en https://railway.app (gratis con GitHub)
2. Haz clic en **"New Project" → "Deploy from GitHub repo"**
3. Sube esta carpeta a un repo de GitHub (o usa Railway CLI)
4. Railway detecta automáticamente que es Node.js
5. Te da una URL pública tipo `https://castronegro-xxxx.railway.app`
6. ¡Compártela con tus amigos!

### Alternativa: Render.com
1. Crea cuenta en https://render.com
2. New → Web Service → conecta tu repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Te da URL pública gratis

---

## Estructura
```
castronegro/
├── server.js          ← Backend Node.js + Socket.IO
├── package.json
└── public/
    ├── index.html     ← Interfaz principal
    ├── css/style.css  ← Estilos (colores originales del juego)
    └── js/app.js      ← Lógica frontend
```

## Roles incluidos
- 👨‍🌾 Aldeano (siempre)
- 🐺 Hombre Lobo (siempre, ~1 por cada 4 jugadores)
- 🔮 Vidente
- 🧪 Bruja (poción salvar + poción matar)
- 🏹 Cazador (al morir, puede llevarse a alguien)
- 💘 Cupido (elige 2 enamorados en ronda 1)
- 🃏 Ladrón (intercambia carta en ronda 1)
- 👧 Niña (puede espiar a los lobos)
- 🌟 Alguacil (doble voto)
- 🛡️ Salvador (protege a alguien cada noche)
