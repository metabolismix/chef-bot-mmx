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

  // ---------- API KEY ----------
  const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Falta GOOGLE_API_KEY en variables de entorno.'
      })
    };
  }

  const MODEL = 'gemini-2.5-flash';
  const GEMINI_URL =
    `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------- UTILIDADES ----------

  // Envoltorio para devolver una "card" en el formato que espera el front
  function makeCardResponse(cardJsonObj) {
    const text = JSON.stringify(cardJsonObj);
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ]
    };
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
  }

  // Plan de respaldo para cuando la IA falle
  function buildFallbackCard(mode, extraWarning) {
    const baseWarning = extraWarning
      ? [extraWarning]
      : ['Se ha producido un error al llamar a la IA.'];

    if (mode === 'week') {
      return {
        mode: 'week',
        plan_name: 'Plan de respaldo',
        days: [],
        shopping_list: [],
        general_tips: [
          'La IA no ha devuelto un plan estructurado completo. Se ha generado un plan mínimo de respaldo.',
          ...baseWarning
        ]
      };
    }

    // Por si en el futuro usas modo "recipe"
    return {
      mode: 'recipe',
      recipe_name: 'Receta de respaldo',
      prep_minutes: 5,
      cook_minutes: 5,
      difficulty: 'Fácil',
      servings: 1,
      meal_type: 'Desayuno',
      ingredients: ['1 pieza de fruta', '1 puñado de frutos secos'],
      steps: [
        'Escoge una fruta que te guste.',
        'Añade un puñado de frutos secos.',
        'Acompáñalo de agua, café o infusión sin azúcar.'
      ],
      meal_summary:
        'Desayuno rápido de respaldo mientras se soluciona el problema con la IA.',
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null
      },
      warnings: baseWarning
    };
  }

  // ---------- PROMPTS ----------

  function buildWeekPrompt(payload) {
    const {
      dailyTargets,
      restrictions,
      fridgeIngredients,
      style
    } = payload || {};

    const { calories, protein_g, carbs_g, fat_g } = dailyTargets || {};

    return `
Eres Chef-Bot, un planificador de menús semanal para dieta mediterránea.

OBJETIVO
- Generar un PLAN SEMANAL completo (7 días) con desayunos, comidas, cenas y 1–2 snacks diarios.
- Ajustar lo máximo posible los macros diarios a:
  - Calorías: ${calories ?? 'N/A'}
  - Proteínas (g): ${protein_g ?? 'N/A'}
  - Hidratos (g): ${carbs_g ?? 'N/A'}
  - Grasas (g): ${fat_g ?? 'N/A'}

Restricciones dietéticas del usuario:
${restrictions && restrictions.length ? '- ' + restrictions.join('\n- ') : 'Ninguna específica.'}

Ingredientes prioritarios en la nevera o despensa:
${fridgeIngredients && fridgeIngredients.length ? '- ' + fridgeIngredients.join('\n- ') : 'No especificados; puedes proponer ingredientes típicos de dieta mediterránea.'}

Estilo de cocina preferido:
${style || 'Mediterránea sencilla, realista y repetible en un piso estándar.'}

INSTRUCCIONES IMPORTANTES
- Recetas realistas, nada de combinaciones absurdas (evita cosas como “atún con plátano y espinacas” para desayunar).
- Usa nombres de recetas normales de cocina casera mediterránea.
- Nada de marcas comerciales concretas.
- Mantén una estructura clara: cada día con sus comidas, cada comida con su tipo y un nombre de receta descriptivo.
- Ajusta los macros diarios lo mejor posible, pero que prime el sentido común culinario.
- NO añadas texto explicativo fuera del JSON. No uses comentarios, ni frases antes o después.

DEVUELVE EXCLUSIVAMENTE un JSON válido con este formato EXACTO (sin texto adicional):

{
  "mode": "week",
  "plan_name": "Texto breve para nombrar el plan",
  "days": [
    {
      "day": "Lunes",
      "meals": [
        {
          "meal_type": "Desayuno | Comida | Cena | Snack",
          "recipe_name": "Nombre de la receta",
          "ingredients": ["lista de ingredientes en texto"],
          "steps": ["pasos cortos en imperativo"],
          "macro_estimate": {
            "calories": 500,
            "protein_g": 30,
            "carbs_g": 40,
            "fat_g": 20
          }
        }
      ]
    }
  ],
  "shopping_list": ["lista de la compra orientativa"],
  "general_tips": ["1–5 consejos generales prácticos"]
}
`.trim();
  }

  function buildRecipePrompt(payload) {
    const { claim, context } = payload || {};
    return `
Eres Chef-Bot, un generador de recetas mediterráneas sencillas y realistas.

Dentro de unos segundos recibirás una petición con:
- Una idea de comida o contexto del usuario.
- Sus objetivos de salud y preferencias.

Genera UNA sola receta coherente, en castellano, con:
- Nombre de la receta.
- Ingredientes en lista.
- Pasos en lista.
- Estimación aproximada de macros.

DEVUELVE EXCLUSIVAMENTE un JSON válido con este formato EXACTO (sin texto adicional):

{
  "mode": "recipe",
  "recipe_name": "Nombre de la receta",
  "prep_minutes": 10,
  "cook_minutes": 20,
  "difficulty": "Fácil | Media | Difícil",
  "servings": 1,
  "meal_type": "Desayuno | Comida | Cena | Snack",
  "ingredients": ["..."],
  "steps": ["..."],
  "meal_summary": "Descripción breve de 1-2 frases",
  "macro_estimate": {
    "calories": 500,
    "protein_g": 30,
    "carbs_g": 40,
    "fat_g": 20
  },
  "warnings": []
}

Contexto opcional del usuario:
${context || 'No especificado.'}

Idea o petición original:
${claim || 'No especificada.'}
`.trim();
  }

  // ---------- LLAMADA A GEMINI (SIN response_schema) ----------

  async function callGemini(mode, payload) {
    const prompt =
      mode === 'week'
        ? buildWeekPrompt(payload)
        : buildRecipePrompt(payload);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generation_config: {
        temperature: 0.45,
        top_p: 0.9,
        top_k: 32,
        max_output_tokens: 4096
        // IMPORTANTE: sin response_mime_type ni response_schema
      }
    };

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const json = await res.json();

    if (!res.ok) {
      const msg =
        (json && json.error && json.error.message) ||
        'Error desconocido en Gemini.';
      throw new Error(`Gemini ${res.status}: ${msg}`);
    }

    let text =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    text = text.trim();

    // A veces el modelo envuelve en ```json ... ```
    if (text.startsWith('```')) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/m, '')
        .replace(/```$/m, '')
        .trim();
    }

    if (!text) {
      throw new Error('Respuesta vacía de la IA.');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('No se ha podido parsear el JSON devuelto por la IA.');
    }

    // Validación mínima
    if (mode === 'week') {
      if (!parsed.plan_name || !Array.isArray(parsed.days)) {
        throw new Error('La respuesta de la IA para el plan semanal es incompleta.');
      }
      parsed.mode = 'week';
    } else {
      if (!parsed.recipe_name || !Array.isArray(parsed.ingredients)) {
        throw new Error('La respuesta de la IA para la receta es incompleta.');
      }
      parsed.mode = 'recipe';
    }

    return parsed;
  }

  // ---------- HANDLER PRINCIPAL ----------

  try {
    const body = JSON.parse(event.body || '{}');
    const mode = body.mode === 'week' ? 'week' : 'recipe';
    const payload = body.payload || {};

    let card;
    try {
      card = await callGemini(mode, payload);
    } catch (err) {
      console.error('Error al llamar a Gemini:', err.message);
      card = buildFallbackCard(
        mode,
        `La API de Gemini ha devuelto un error: ${err.message}`
      );
    }

    return makeCardResponse(card);
  } catch (err) {
    console.error('Error inesperado en verifyMyth:', err);

    const fallback = buildFallbackCard(
      'week',
      'Error inesperado en el backend de Chef-Bot.'
    );
    return makeCardResponse(fallback);
  }
};
