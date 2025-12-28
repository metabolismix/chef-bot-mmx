// netlify/functions/chef.js

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(min, Math.min(max, n));
}

function safeParseJSON(text) {
  if (typeof text !== "string") return null;

  // Quita code fences si el modelo los colara (aunque le pedimos que no).
  let s = text.trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  // Si viniera con basura alrededor, intenta recortar al primer/último brace.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1).trim();
  }

  // Normaliza comillas “raras”.
  s = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizePlan(plan, mealsPerDay, protein, fat, carbs) {
  const labels =
    mealsPerDay === 1 ? ["Comida"] :
    mealsPerDay === 2 ? ["Comida", "Cena"] :
    ["Desayuno", "Comida", "Cena"];

  const out = {
    calories_target_kcal: Math.round(protein * 4 + carbs * 4 + fat * 9),
    macros_target_g: { protein, fat, carbs },
    meals_per_day: mealsPerDay,
    meals: [],
    shopping_list: [],
    prep_tips: []
  };

  const meals = Array.isArray(plan?.meals) ? plan.meals : [];
  for (let i = 0; i < mealsPerDay; i++) {
    const m = meals[i] || {};
    out.meals.push({
      meal: typeof m.meal === "string" ? m.meal : labels[i],
      recipe_name: typeof m.recipe_name === "string" ? m.recipe_name : `Plato mediterráneo ${i + 1}`,
      approx_macros_g: {
        protein: clamp(m?.approx_macros_g?.protein ?? 0, 0, 999),
        fat: clamp(m?.approx_macros_g?.fat ?? 0, 0, 999),
        carbs: clamp(m?.approx_macros_g?.carbs ?? 0, 0, 999),
      },
      ingredients: Array.isArray(m.ingredients) ? m.ingredients.slice(0, 14).map(String) : [],
      steps: Array.isArray(m.steps) ? m.steps.slice(0, 10).map(String) : [],
    });
  }

  out.shopping_list = Array.isArray(plan?.shopping_list) ? plan.shopping_list.slice(0, 24).map(String) : [];
  out.prep_tips = Array.isArray(plan?.prep_tips) ? plan.prep_tips.slice(0, 16).map(String) : [];

  // “1 opción por plato” => garantizado: solo hay 1 receta por meal en el schema.
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Método no permitido. Usa POST." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    // Este era el “Unterminated string…” típico: body no era JSON válido.
    return json(400, { ok: false, error: "Body inválido: asegúrate de enviar JSON con JSON.stringify()." });
  }

  const protein = clamp(body.protein, 0, 400);
  const fat = clamp(body.fat, 0, 200);
  const carbs = clamp(body.carbs, 0, 500);
  const mealsPerDay = clamp(body.mealsPerDay, 1, 3);
  const dietaryFilter = (body.dietaryFilter ?? "").toString().trim().slice(0, 140);

  if (protein + fat + carbs <= 0) {
    return json(400, { ok: false, error: "Macros inválidos: al menos uno debe ser > 0." });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return json(500, { ok: false, error: "Falta GEMINI_API_KEY (o API_KEY) en variables de entorno." });
  }

  // Modelo recomendado en docs (2.5 Flash). :contentReference[oaicite:1]{index=1}
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // Endpoint oficial generateContent. :contentReference[oaicite:2]{index=2}
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const system_instruction = {
    parts: [{
      text:
        "Eres Chef-Bot, un cocinero mediterráneo inteligente. " +
        "Diseña menús realistas, saludables, simples y sabrosos. " +
        "Devuelve SOLO JSON válido (sin markdown, sin comentarios, sin texto extra). " +
        "No uses comillas dobles dentro de valores de texto."
    }]
  };

  const prompt =
`Objetivo: crea un plan de 1 día estilo mediterráneo que se aproxime a estos macros totales:
- Proteína: ${protein} g
- Grasas: ${fat} g
- Carbohidratos: ${carbs} g
- Platos/día: ${mealsPerDay} (máximo 3; exactamente ${mealsPerDay})
- Restricción/filtro: ${dietaryFilter ? dietaryFilter : "ninguno"}

Reglas IMPORTANTES:
1) Solo 1 opción por plato (no des alternativas).
2) Platos realistas con ingredientes comunes (España/Europa).
3) Evita ingredientes ultra procesados si no son necesarios.
4) Devuelve JSON estrictamente con esta forma (sin campos extra):

{
  "meals": [
    {
      "meal": "Desayuno|Comida|Cena (o equivalente)",
      "recipe_name": "string",
      "approx_macros_g": { "protein": number, "fat": number, "carbs": number },
      "ingredients": ["string", "..."],
      "steps": ["string", "..."]
    }
  ],
  "shopping_list": ["string", "..."],
  "prep_tips": ["string", "..."]
}

Asegúrate de que:
- meals tiene longitud EXACTA ${mealsPerDay}
- ingredients (6-12 items por plato) y steps (3-6 pasos por plato)
- approx_macros_g son números sin unidades
- shopping_list y prep_tips son listas útiles y cortas
`;

  const payload = {
    system_instruction, // campo documentado para REST. :contentReference[oaicite:3]{index=3}
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 900,
      responseMimeType: "application/json" // JSON mode. :contentReference[oaicite:4]{index=4}
    }
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      const msg = data?.error?.message || `Gemini API error (${resp.status})`;
      return json(resp.status, { ok: false, error: msg });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("") || "";

    const parsed = safeParseJSON(text);
    if (!parsed) {
      return json(502, {
        ok: false,
        error: "La respuesta no llegó como JSON parseable. Baja un poco la complejidad del texto y reintenta.",
      });
    }

    const plan = normalizePlan(parsed, mealsPerDay, protein, fat, carbs);
    return json(200, { ok: true, plan });

  } catch (e) {
    return json(500, { ok: false, error: e?.message || "Fallo interno en la función." });
  }
};
