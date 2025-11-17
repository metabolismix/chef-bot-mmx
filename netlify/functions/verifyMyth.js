// netlify/functions/verifymyth.js
/* eslint-disable */
const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'Falta GOOGLE_API_KEY en variables de entorno',
      }),
    };
  }

  try {
    const {
      prompt,
      maxTokens = 600,
      temperature = 0.7,
      topP = 0.95,
    } = JSON.parse(event.body || '{}');

    if (!prompt || typeof prompt !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'prompt requerido (string)' }),
      };
    }

    const body = {
      systemInstruction: {
        role: 'user',
        parts: [
          {
            text:
              'Eres MacroChefBot, un asistente de cocina que genera recetas en español, ' +
              'claras, prácticas y seguras. Devuelve solo HTML simple (sin <script>), ' +
              'con encabezados, listas de ingredientes y pasos numerados. Evita claims ' +
              'sanitarios y comentarios sobre patologías.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature,
        topP,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
      },
      // safetySettings opcionales si quieres endurecer filtros
    };

    const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        statusCode: resp.status,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Error de Gemini', details: text }),
      };
    }

    const data = await resp.json();
    const text =
      (data &&
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        (data.candidates[0].content.parts[0]?.text ||
          data.candidates[0].content.parts
            .map((p) => p.text || '')
            .join('\n'))) ||
      '';

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, raw: data }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'Error interno',
        message: String(err?.message || err),
      }),
    };
  }
};
