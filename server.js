import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const upload = multer(); // archivos en memoria

// Middlewares base
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Cliente de OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ======================
// Health + Root
// ======================

// Para probar rápido que el server anda
app.get('/', (req, res) => {
  res.send('DR.TRADER IA backend OK');
});

// Health checks (Render / uptime monitors)
app.get(['/health', '/salud'], (req, res) => {
  res.status(200).json({ ok: true, service: 'drtrader-ia-backend' });
});

// ======================
// Endpoint Mentor IA (texto + imagen)
// ======================

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
        'Tu tarea: decir qué está bien, qué está mal o flojo, y sugerir mejoras claras. No des señales ni recomendaciones explícitas de inversión.',
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
      model: 'gpt-4.1-mini',
      input,
    });

    const replyText = response.output_text || 'No se pudo generar una respuesta.';
    return res.json({ reply: replyText });
  } catch (err) {
    console.error('Error en /api/analisis-ia:', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'Error procesando la solicitud de IA.' });
  }
});

// ======================
// Detecta patrones armónicos (legacy)
// ======================

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
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
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
          notes: p.notes ? String(p.notes) : '',
        };
      });
    }

    // Armamos un texto simple para el front (compatibilidad)
    let reply = '';
    if (parsed && Array.isArray(parsed.patterns) && parsed.patterns.length) {
      reply = parsed.patterns
        .map((p, i) => {
          const pts = `X=${p.X}, A=${p.A}, B=${p.B}, C=${p.C}, D=${p.D}`;
          return `${i + 1}) ${p.name} (${p.direction}) | ${pts} | conf=${p.confidence ?? ''}`;
        })
        .join('\n');
    } else {
      reply = 'No detecté patrones armónicos claros en la captura.';
    }

    return res.json({ reply, ...parsed });
  } catch (err) {
    console.error('Error /api/harmonic-detect:', err);
    return res.status(500).json({ error: 'Error interno analizando imagen' });
  }
});

// ===============================
// HARMONICS V2 – DrTrader System
// Endpoint versionado: analiza imagen + devuelve JSON con score (B/XA prioritario)
// ===============================

app.post('/v2/analyze-image-harmonic', upload.single('image'), async (req, res) => {
  try {
    // OJO: se evalúa en runtime (por request), así si cambiás env en Render, no queda “cacheado”
    const HARMONICS_V2_ENABLED =
      String(process.env.HARMONICS_V2_ENABLED || 'false').trim().toLowerCase() === 'true';

    if (!HARMONICS_V2_ENABLED) {
      return res.status(503).json({
        error: 'Harmonics V2 disabled',
        message: 'El sistema DrTrader V2 está apagado por feature flag',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'Missing image',
        message: "Tenés que subir un archivo en el campo form-data 'image'",
      });
    }

    const mime = req.file.mimetype || 'image/png';
    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    // Prompt: candidatos + ratios + score (B/XA manda)
    const prompt = `
Devolvé SOLO JSON válido. Nada de texto extra.

Objetivo: detectar TODOS los patrones armónicos posibles en una captura de TradingView/velas.
Patrones permitidos: Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, Cypher, 5-0 (y "Other" si aplica).
Si no hay patrones claros, devolvé patterns: [].

Reglas:
- Proponé candidatos aunque no sean perfectos.
- Para cada candidato: name, direction (bullish/bearish/unknown)
- points: X,A,B,C,D como {x,y} en píxeles aproximados (si no se puede, poné null)
- ratios: B_XA, C_AB, D_XA, D_BC (si no se puede calcular, null)
- score 0..100. Peso mayor en B/XA.
  Ponderación sugerida: B/XA=0.45, D/XA=0.25, C/AB=0.20, D/BC=0.10.
- notes: breve explicación de por qué lo elegiste o qué faltó.

Formato exacto:
{
  "patterns": [
    {
      "name": "Gartley|Bat|Butterfly|Crab|Deep Crab|Shark|Cypher|5-0|Other",
      "direction": "bullish|bearish|unknown",
      "points": { "X": {"x":0,"y":0}, "A": {"x":0,"y":0}, "B": {"x":0,"y":0}, "C": {"x":0,"y":0}, "D": {"x":0,"y":0} },
      "ratios": { "B_XA": 0.618, "C_AB": 0.50, "D_XA": 0.786, "D_BC": 1.618 },
      "score": 0,
      "notes": ""
    }
  ],
  "summary": ""
}
`;

    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
    });

    const text = response.output_text || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Si el modelo no devolvió JSON perfecto, te devuelvo raw para ajustar prompt
      return res.status(200).json({
        ok: true,
        warning: 'No pude parsear JSON. Devuelvo raw para depurar y ajustar prompt.',
        raw: text,
      });
    }

    const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
    patterns.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));

    return res.json({
      ok: true,
      patterns,
      summary: parsed.summary || '',
    });
  } catch (err) {
    console.error('Error /v2/analyze-image-harmonic:', err?.response?.data || err.message || err);
    return res.status(500).json({
      error: 'Internal error',
      message: 'Error interno analizando imagen con OpenAI',
    });
  }
});

// ======================
// Listen
// ======================

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor IA escuchando en puerto ${port}`);
});
