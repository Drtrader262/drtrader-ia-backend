import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const upload = multer(); // archivos en memoria

// Habilitar CORS para que el front (Netlify, etc.) pueda llamarte
app.use(cors());

// Cliente de OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Para probar rápido que el server anda
app.get('/', (req, res) => {
  res.send('DR.TRADER IA backend OK');
});

app.post('/api/analisis-ia', upload.single('image'), async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Falta el mensaje.' });
    }

    const input = [];

    // Instrucciones del "mentor IA"
    input.push({
      role: 'system',
      content:
        'Sos un analista profesional de trading (Forex y sintéticos) y actuás como un mentor cercano pero serio. ' +
        'Evaluás análisis de operaciones: estructura de mercado, zonas, liquidez, patrones (armónicos, S&D, OB, FVG), gestión de riesgo. ' +
        'Tu tarea: decir qué está bien, qué está mal o flojo, y sugerir mejoras claras. No des señales ni recomendaciones explícitas de inversión.'
    });

    // Mensaje textual del usuario
    input.push({
      role: 'user',
      content:
        `Análisis del usuario (texto):\n` +
        message +
        `\n\nDecile si está bien planteado, qué mejorarías y en qué debe prestar atención.`,
    });

    // Si viene una imagen, la agregamos como input_image
    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      input.push({
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: `data:${req.file.mimetype};base64,${base64}`,
          },
          {
            type: 'input_text',
            text: 'Esta es la captura del gráfico relacionada con el análisis anterior. Tenela en cuenta en tu respuesta.',
          },
        ],
      });
    }

    // Llamada al modelo con visión (texto + imagen)
    const response = await client.responses.create({
      model: 'gpt-4.1-mini', // o gpt-4.1 si querés
      input,
    });

    const replyText = response.output_text || 'No se pudo generar una respuesta.';

    return res.json({ reply: replyText });
  } catch (err) {
    console.error('Error en /api/analisis-ia:', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'Error procesando la solicitud de IA.' });
  }
});

const port = process.env.PORT || 3000;

// Health checks (Render / uptime monitors)
app.get(['/health', '/salud'], (req, res) => {
  res.status(200).json({ ok: true, service: 'drtrader-ia-backend' });
});

// Detecta patrones armónicos desde una imagen (para el módulo VIP de Patrones Armónicos)
// Devuelve hasta 2 patrones con puntos X,A,B,C,D listos para que el front calcule el score DrTrader.
app.post('/api/harmonic-detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Falta imagen (campo: image)' });
    }

    const imgB64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${imgB64}`;

    const system = `Sos un analista cuantitativo de patrones armónicos. 
Tu tarea: detectar patrones armónicos en la imagen (captura de TradingView).
IMPORTANTE: devolvé SOLO JSON válido, sin texto extra.`;

    const userText = `Detectá HASTA 2 patrones armónicos visibles (si hay 0, devolvé patterns: []).
- El patrón puede ser: Gartley, Bat, Butterfly, Crab, Deep Crab, Cypher, Shark.
- Identificá dirección: bullish o bearish.
- Para cada patrón, devolvé puntos X,A,B,C,D como números (float).
- Elegí los swings más claros de izquierda a derecha (zoom del usuario puede variar).
- Si dudás entre dos variantes, elegí la más probable y marcá confidence (0-1).
Formato exacto:
{
  "patterns":[
    {
      "name":"Butterfly",
      "direction":"bullish",
      "X":0,"A":0,"B":0,"C":0,"D":0,
      "confidence":0.0,
      "notes":""
    }
  ]
}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: 'Respuesta IA inválida (no JSON)', raw });
    }

    // Normalización básica de números
    if (parsed && Array.isArray(parsed.patterns)) {
      parsed.patterns = parsed.patterns.slice(0, 2).map((p) => {
        const toNum = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        return {
          name: String(p.name || '').trim(),
          direction: String(p.direction || '').trim().toLowerCase(),
          X: toNum(p.X),
          A: toNum(p.A),
          B: toNum(p.B),
          C: toNum(p.C),
          D: toNum(p.D),
          confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
          notes: p.notes ? String(p.notes) : ''
        };
      });
    }

    
    // Armamos un texto simple para el front (compatibilidad)
    let reply = '';
    if (parsed && Array.isArray(parsed.patterns) && parsed.patterns.length) {
      reply = parsed.patterns.map((p, i) => {
        const pts = `X=${p.X}, A=${p.A}, B=${p.B}, C=${p.C}, D=${p.D}`;
        return `${i+1}) ${p.name} (${p.direction}) | ${pts} | conf=${p.confidence ?? ''}`;
      }).join('\n');
    } else {
      reply = 'No detecté patrones armónicos claros en la captura.';
    }

    return res.json({ reply, ...parsed });

  } catch (err) {
    console.error('Error /api/harmonic-detect:', err);
    return res.status(500).json({ error: 'Error interno analizando imagen' });
  }
});

app.listen(port, () => {
  console.log(`Servidor IA escuchando en puerto ${port}`);
});
