// netlify/functions/verifyMyth.js
exports.handler = async function (event, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // ---------- CORS / MÉTODO ----------
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  // ---------- RECIPE FALLBACKS ----------
  const makeFallbackRecipe = (title, simpleMessage, warnings) => {
    return {
      title: title || 'Receta no disponible',
      shortDescription: simpleMessage || 'En este momento Chef-Bot no puede generar la receta con IA.',
      prepTimeMinutes: 0,
      cookTimeMinutes: 0,
      difficulty: 'Fácil',
      steps: [
        'Prepara una comida sencilla utilizando los ingredientes que ya tienes a mano.',
        'Cuando la configuración del servidor esté corregida, vuelve a intentar generar una receta con IA.'
      ],
      tips: [],
      warnings: Array.isArray(warnings) && warnings.length
        ? warnings
        : ['Este mensaje es solo informativo: no contiene instrucciones culinarias detalladas.']
    };
  };

  try {
    // ---------- INPUT ----------
    const parsedBody = JSON.parse(event.body || '{}');
    const recipeRequest = parsedBody.recipeRequest;

    if (!recipeRequest) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetro "recipeRequest" requerido.' })
      };
    }

    // ---------- API KEY ----------
    const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      const fallback = makeFallbackRecipe(
        'Configuración de Chef-Bot pendiente',
        'Ahora mismo Chef-Bot no está bien configurado en el servidor y no puede conectarse a la IA.',
        [
          'Revisa en Netlify que la variable de entorno GOOGLE_API_KEY esté definida correctamente.',
          'Una vez configurada la clave de la API de Google, podrás generar recetas con IA.'
        ]
      );
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify(fallback)
      };
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL =
      process.env.GEMINI_MODEL ||
      process.env.GOOGLE_MODEL ||
      'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const systemPrompt = `
Eres Chef-Bot, un asistente experto en cocina cotidiana y planificación de menús con enfoque en macros.

RECIBES SIEMPRE un objeto JSON serializado como texto con esta forma aproximada:
{
  "comida": "Desayuno" | "Almuerzo" | "Cena" | "Merienda" | "Media Mañana" | "Post-Cena" | "Comida Única",
  "descripcion": "texto breve con el tipo de plato",
  "ingredientes": [
    { "nombre": "arroz integral", "gramos": 90 },
    { "nombre": "pechuga de pollo", "gramos": 150 }
  ],
  "macrosObjetivo": {
    "proteina_g": 40,
    "grasa_g": 15,
    "carbohidratos_g": 60
  },
  "restricciones": "texto libre con alergias, intolerancias o dietas (por ejemplo, intolerancia a la lactosa, celiaquía, alergia a frutos secos, etc.)",
  "notas": "instrucciones adicionales"
}

TU TAREA:
Transformar esa información en una receta clara, coherente y práctica.

DEVUELVE SIEMPRE un JSON VÁLIDO con la estructura:

{
  "title": "string",
  "shortDescription": "string",
  "prepTimeMinutes": number,
  "cookTimeMinutes": number,
  "difficulty": "Muy fácil" | "Fácil" | "Media" | "Alta",
  "steps": ["Paso 1...", "Paso 2...", "..."],
  "tips": ["Consejo opcional 1", "Consejo opcional 2"],
  "warnings": ["Aviso opcional 1", "Aviso opcional 2"]
}

REGLAS IMPORTANTES:
1) NO inventes ingredientes nuevos. SOLO puedes usar los ingredientes que aparezcan en el campo "ingredientes".
   - Puedes añadir únicamente sal, especias genéricas, hierbas aromáticas o agua cuando sean razonables.
   - No añadas alimentos nuevos con carga calórica relevante ni ingredientes potencialmente alergénicos adicionales.

2) RESPETA rigurosamente las restricciones dietéticas del campo "restricciones".
   - Nunca propongas lácteos si se menciona intolerancia a la lactosa.
   - Nunca uses gluten si se menciona celiaquía o "sin gluten".
   - Nunca uses marisco si se menciona alergia al marisco, etc.

3) Ajusta las instrucciones a cocina casera en español de España, con buena ortografía, frases completas y un tono cercano pero profesional.

4) Los pasos deben ser coherentes con los gramos indicados y la forma habitual de cocinar cada ingrediente.
   - Si hay 200 g de pechuga de pollo, la receta debe usar esa cantidad, sin eliminarla ni multiplicarla sin motivo.
   - Mantén la receta razonablemente sencilla: 4–8 pasos suele ser lo ideal.

5) NO des recomendaciones médicas ni sanitarias. Solo instrucciones culinarias.

6) Devuelve ÚNICAMENTE el JSON indicado, sin explicaciones adicionales ni texto fuera del objeto.
`;

    const responseSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        shortDescription: { type: 'string' },
        prepTimeMinutes: { type: 'number' },
        cookTimeMinutes: { type: 'number' },
        difficulty: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } },
        tips: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'steps']
    };

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify(recipeRequest)
            }
          ]
        }
      ],
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    const TIMEOUT_MS = parseInt(
      process.env.GEMINI_TIMEOUT_MS || '8000',
      10
    );

    // ---------- LLAMADA A GEMINI CON TIMEOUT ----------
    let result;
    let res;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const fallback = makeFallbackRecipe(
        'No se ha podido contactar con la IA',
        'Ha habido un problema de conexión con el servicio de IA de Google.',
        [
          'Es probable que se trate de un problema temporal de red o de la API.',
          'Intenta generar la receta de nuevo en unos minutos.'
        ]
      );
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify(fallback)
      };
    }

    clearTimeout(timeoutId);

    try {
      result = await res.json();
    } catch (err) {
      const fallback = makeFallbackRecipe(
        'Respuesta de IA no válida',
        'La respuesta devuelta por la IA no se ha podido interpretar correctamente.',
        [
          'Puede haberse generado un JSON mal formado.',
          'Intenta generar de nuevo la receta o revisa la configuración del modelo.'
        ]
      );
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify(fallback)
      };
    }

    if (!res.ok) {
      const msg =
        (result && result.error && result.error.message) ||
        'Error desconocido en la API de Google.';
      const fallback = makeFallbackRecipe(
        'Error en el servicio de IA',
        'La API de Google ha devuelto un error al intentar generar la receta.',
        [`Mensaje de la API: ${msg}`]
      );
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify(fallback)
      };
    }

    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const stripFences = (t) => {
      let x = (t || '').trim();
      if (x.startsWith('```')) {
        x = x
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```$/, '')
          .trim();
      }
      return x;
    };

    const robustParse = (text) => {
      const t = stripFences(text);
      if (!t) return null;

      // 1) Intento directo
      try {
        return JSON.parse(t);
      } catch {}

      // 2) Si empieza por [, intentamos como array y tomamos el primer objeto
      if (t.startsWith('[')) {
        try {
          const arr = JSON.parse(t);
          if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object') {
            return arr[0];
          }
        } catch {}
      }

      // 3) Extraer bloque { ... } balanceado
      const start = t.indexOf('{');
      if (start >= 0) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let i = start; i < t.length; i++) {
          const ch = t[i];
          if (inStr) {
            if (esc) {
              esc = false;
            } else if (ch === '\\') {
              esc = true;
            } else if (ch === '"') {
              inStr = false;
            }
          } else {
            if (ch === '"') inStr = true;
            else if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                const snippet = t.slice(start, i + 1);
                try {
                  return JSON.parse(snippet);
                } catch {}
                break;
              }
            }
          }
        }
      }
      return null;
    };

    let recipe = robustParse(rawText);
    if (!recipe || typeof recipe !== 'object') {
      recipe = makeFallbackRecipe(
        'Receta simplificada',
        'No he podido estructurar la respuesta de la IA, así que te propongo una receta simplificada basada en los ingredientes.',
        [
          'La respuesta original del modelo no se ha podido convertir a un JSON válido.',
          'Se ha generado una receta de respaldo para no interrumpir la experiencia de uso.'
        ]
      );
    }

    // ---------- NORMALIZACIÓN ----------
    const toStringSafe = (v) =>
      typeof v === 'string' ? v : v == null ? '' : String(v);

    const toNumberSafe = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : def;
    };

    const toStringArray = (arr) =>
      Array.isArray(arr)
        ? arr
            .map((x) => toStringSafe(x))
            .map((x) => x.trim())
            .filter(Boolean)
        : [];

    const safeRecipe = {
      title: toStringSafe(recipe.title || 'Receta sugerida'),
      shortDescription: toStringSafe(recipe.shortDescription || ''),
      prepTimeMinutes: toNumberSafe(recipe.prepTimeMinutes, 10),
      cookTimeMinutes: toNumberSafe(recipe.cookTimeMinutes, 15),
      difficulty: toStringSafe(recipe.difficulty || 'Fácil'),
      steps:
        toStringArray(recipe.steps).length > 0
          ? toStringArray(recipe.steps)
          : [
              'Prepara los ingredientes siguiendo una técnica sencilla (plancha, horno o salteado suave).',
              'Sirve el plato respetando las cantidades de cada ingrediente según el plan de Chef-Bot.'
            ],
      tips: toStringArray(recipe.tips),
      warnings: toStringArray(recipe.warnings)
    };

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-chef-bot-func-version': 'v1-gemini-recipe-2025-11-17'
      },
      body: JSON.stringify(safeRecipe)
    };
  } catch (error) {
    const fallback = makeFallbackRecipe(
      'Error interno en Chef-Bot',
      'Ha ocurrido un problema interno al procesar la consulta en Chef-Bot.',
      [
        `Detalle técnico: ${error?.message || String(error)}`,
        'Revisa los logs de Netlify para depurar el origen del error.'
      ]
    );
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallback)
    };
  }
};
