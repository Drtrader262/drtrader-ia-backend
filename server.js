import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const upload = multer(); // archivos en memoria

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

    // Instrucciones de mentor
    input.push({
      role: 'system',
      content:
        'Sos un analista profesional de trading (Forex y sintéticos). Actuás como mentor cercano pero serio. ' +
        'Evaluás análisis de operaciones: estructura, zonas, liquidez, patrones (armónicos, S&D, OB, FVG), gestión de riesgo. ' +
        'Decís qué está bien, qué está flojo y sugerís mejoras concretas. No das señales ni recomendaciones financieras.',
    });

    // Mensaje del usuario
    input.push({
      role: 'user',
      content:
        `Análisis del usuario:
${message}

Evaluá qué tan bien está justificado y qué mejorar.`,
    });

    // Si envía imagen → la agregamos al input
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
            text: 'Esta es la captura del gráfico relacionada con el análisis.',
          },
        ],
      });
    }

    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input,
    });

    const replyText = response.output_text || 'No se pudo generar respuesta.';

    return res.json({ reply: replyText });
  } catch (err) {
    console.error('Error en /api/analisis-ia:', err);
    return res.status(500).json({ error: 'Error procesando la solicitud de IA.' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor IA escuchando en puerto ${port}`);
});
