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
app.listen(port, () => {
  console.log(`Servidor IA escuchando en puerto ${port}`);
});
