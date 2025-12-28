// netlify/functions/chef.js
// Node runtime (Netlify Functions). API Key SOLO en entorno: GEMINI_API_KEY (o API_KEY)

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

function pick(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((acc, k) => acc?.[k], obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
}

function safeParseJson(text) {
  if (!text || typeof text !== "string") throw new Error("Respuesta vacía del modelo.");

  // Si viniera con basura (muy raro con JSON mode), intentamos recortar al primer/último { }.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const slice = (first !== -1 && last !== -1 && last > first) ? text.slice(first, last + 1) : text;

  return JSON.parse(slice);
}

function clampNumber(x, min = 0, max = 10000) {
  const n = Number(x);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

exports.handler = async (event) => {
  // Solo POST
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...jsonHeaders(),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: "Falta GEMINI_API_KEY (o API_KEY) en variables de entorno." }) };
  }

  let prefs;
  try {
    prefs = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "JSON inválido en el body." }) };
  }

  const protein = clampNumber(prefs.protein, 0, 500);
  const fat = clampNumber(prefs.fat, 0, 300);
  const carbs = clampNumber(prefs.carbs, 0, 800);
  const numMeals = clampNumber(prefs.numMeals, 2, 6);
  const dietaryFilter = String(prefs.dietaryFilter || "").trim();
  const fridgeIngredients = String(prefs.fridgeIngredients || "").trim();

  if (protein <= 0 || fat <= 0 || carbs <= 0) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Macros inválidos: proteína/grasas/carbos deben ser > 0." }) };
  }

  const prompt = `Genera un plan mediterráneo para 1 día con estos macros exactos:
Proteína: ${protein}g, Grasas: ${fat}g, Carbohidratos: ${carbs}g.
Número de comidas: ${numMeals}.
Restricciones: ${dietaryFilter || "Ninguna"}.
Ingredientes disponibles: ${fridgeIngredients || "Cualquiera"}.

REGLAS ESTRICTAS:
1) La suma de macros de todas las comidas debe aproximarse al objetivo diario.
2) Instrucciones ultra breves: máximo 2 pasos por receta.
3) Devuelve ÚNICAMENTE JSON válido (sin markdown, sin texto extra).`;

  // JSON Schema (Gemini JSON mode) – estructura equivalente a la de tu app React.
  // El Gemini API soporta generateContent y JSON mode con schema. :contentReference[oaicite:1]{index=1}
  const responseSchema = {
    type: "OBJECT",
    properties: {
      plan_name: { type: "STRING" },
      days: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            day_name: { type: "STRING" },
            total_macros: {
              type: "OBJECT",
              properties: {
                protein_g: { type: "NUMBER" },
                fat_g: { type: "NUMBER" },
                carbs_g: { type: "NUMBER" },
              },
              required: ["protein_g", "fat_g", "carbs_g"],
            },
            meals: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  meal_type: { type: "STRING" },
                  recipe_name: { type: "STRING" },
                  macros: {
                    type: "OBJECT",
                    properties: {
                      protein_g: { type: "NUMBER" },
                      fat_g: { type: "NUMBER" },
                      carbs_g: { type: "NUMBER" },
                    },
                    required: ["protein_g", "fat_g", "carbs_g"],
                  },
                  ingredients: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        quantity_grams: { type: "NUMBER" },
                      },
                      required: ["name", "quantity_grams"],
                    },
                  },
                  steps: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["meal_type", "recipe_name", "macros", "ingredients", "steps"],
              },
            },
          },
          required: ["day_name", "total_macros", "meals"],
        },
      },
      shopping_list: { type: "ARRAY", items: { type: "STRING" } },
      general_tips: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["plan_name", "days", "shopping_list", "general_tips"],
  };

  const systemInstruction =
    "Eres Chef-, un sistema de optimización nutricional mediterránea. " +
    "Tu objetivo es crear planes deliciosos y exactos usando el menor número de tokens posible. " +
    "No incluyas texto fuera del JSON.";

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        ...jsonHeaders(),
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const msg =
        pick(data, "error.message") ||
        pick(data, "message") ||
        `Gemini API error (${resp.status}).`;
      return {
        statusCode: resp.status,
        headers: jsonHeaders(),
        body: JSON.stringify({ error: msg }),
      };
    }

    const text = extractTextFromGeminiResponse(data);
    const plan = safeParseJson(text);

    const usageMetadata = data?.usageMetadata || {};
    const usage = {
      promptTokenCount: Number(usageMetadata.promptTokenCount || 0),
      candidatesTokenCount: Number(usageMetadata.candidatesTokenCount || 0),
      totalTokenCount: Number(usageMetadata.totalTokenCount || 0),
    };

    return {
      statusCode: 200,
      headers: jsonHeaders(),
      body: JSON.stringify({ plan, usage }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: jsonHeaders(),
      body: JSON.stringify({ error: `Fallo interno en Chef- Function: ${err?.message || "unknown"}` }),
    };
  }
};
