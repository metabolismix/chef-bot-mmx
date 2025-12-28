export default async (req, context) => {
  // --- Solo POST ---
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- API KEY (Netlify env) ---
  const apiKey =
    (globalThis?.Netlify?.env?.get && Netlify.env.get('GEMINI_API_KEY')) ||
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY in Netlify env vars' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Body size guard (barato y efectivo) ---
  const raw = await req.text();
  if (!raw || raw.length > 3500) {
    return new Response(JSON.stringify({ error: 'Payload demasiado grande' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Sanitización / clamps ---
  const clampInt = (x, min, max, fallback) => {
    const n = Number.isFinite(Number(x)) ? Math.round(Number(x)) : fallback;
    return Math.max(min, Math.min(max, n));
  };

  const clampStr = (s, maxLen) => {
    if (typeof s !== 'string') return '';
    const trimmed = s.trim();
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  };

  const prefs = {
    protein: clampInt(body.protein, 40, 300, 160),
    fat: clampInt(body.fat, 20, 200, 70),
    carbs: clampInt(body.carbs, 0, 400, 220),
    numMeals: clampInt(body.numMeals, 2, 5, 3),
    dietaryFilter: clampStr(body.dietaryFilter, 120),
    fridgeIngredients: clampStr(body.fridgeIngredients, 600),
  };

  const prompt = `
Plan mediterráneo de 1 día.
Objetivo macros total día: PROT=${prefs.protein}g, GRASA=${prefs.fat}g, CARB=${prefs.carbs}g.
Número de comidas EXACTO: ${prefs.numMeals}.
Restricciones: ${prefs.dietaryFilter || "N/A"}.
Ingredientes disponibles (si aplica): ${prefs.fridgeIngredients || "N/A"}.

INSTRUCCIONES:
- Responde SOLO con JSON válido (sin markdown, sin texto extra).
- Recetas simples y realistas.
- Máximo 2 pasos por plato.
- Incluye cantidades en gramos en ingredientes.
- Ajusta macros aproximados por comida para que el total del día sea coherente.

FORMATO JSON:
{
  "plan_name": string,
  "days": [{
    "day_name": string,
    "total_macros": {"protein_g": number, "fat_g": number, "carbs_g": number},
    "meals": [{
      "meal_type": string,
      "recipe_name": string,
      "short_description": string,
      "macros": {"protein_g": number, "fat_g": number, "carbs_g": number},
      "ingredients": [{"name": string, "quantity_grams": number}],
      "steps": [string, string]
    }]
  }],
  "shopping_list": [string],
  "general_tips": [string]
}
`.trim();

  const systemInstruction = `
Eres Chef-, un asistente de nutrición mediterránea experto y eficiente.
Eres ultra-conciso y optimizas coste: salida breve, sin relleno, y JSON limpio.
`.trim();

  // --- Llamada a Gemini 2.5 Flash (REST) ---
  // Endpoint y estructura de generateContent están documentados por Google. :contentReference[oaicite:5]{index=5}
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json', // JSON mode :contentReference[oaicite:6]{index=6}
      maxOutputTokens: 700,
      temperature: 0.4,
    },
  };

  let geminiJson;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    geminiJson = await resp.json();

    if (!resp.ok) {
      const msg = geminiJson?.error?.message || 'Error llamando a Gemini';
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Fallo de red hacia Gemini' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Extraer texto ---
  const text =
    geminiJson?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')?.trim() || '';

  if (!text) {
    return new Response(JSON.stringify({ error: 'Respuesta vacía de Gemini' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Parse JSON con salvavidas ---
  const safeParse = (t) => {
    try { return JSON.parse(t); } catch {}
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = t.slice(start, end + 1);
      try { return JSON.parse(slice); } catch {}
    }
    return null;
  };

  const plan = safeParse(text);
  if (!plan) {
    return new Response(JSON.stringify({ error: 'Gemini devolvió JSON inválido' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Normalización mínima: 2 pasos máximo y nº comidas exacto ---
  try {
    const day0 = plan?.days?.[0];
    if (day0?.meals?.length) {
      // Ajustar nº de comidas exacto
      day0.meals = day0.meals.slice(0, prefs.numMeals);

      // Forzar 2 pasos máximo
      day0.meals = day0.meals.map(m => ({
        ...m,
        steps: Array.isArray(m.steps) ? m.steps.slice(0, 2) : [],
      }));
    }
  } catch {
    // si falla, devolvemos igual; pero normalmente no falla
  }

  return new Response(JSON.stringify({ plan, usage: geminiJson?.usageMetadata || null }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
