// netlify/functions/chef.js
// Node runtime en Netlify. Sin dependencias externas (solo fetch).

const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function clampNumber(x, min, max, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Falta GEMINI_API_KEY en variables de entorno de Netlify." }) };
    }

    const raw = JSON.parse(event.body || "{}");

    // Ajustes defensivos (evita input loco y te protege coste)
    const protein = clampNumber(raw.protein, 0, 400, 160);
    const fat = clampNumber(raw.fat, 0, 200, 70);
    const carbs = clampNumber(raw.carbs, 0, 600, 220);
    const numMeals = clampNumber(raw.numMeals, 2, 5, 3);

    const dietaryFilter = (raw.dietaryFilter || "").toString().slice(0, 120);
    const fridgeIngredients = (raw.fridgeIngredients || "").toString().slice(0, 800);

    const systemInstruction =
      "Eres Chef-, un asistente de nutrición mediterránea experto y eficiente. " +
      "Generas planes de alimentación estructurados en JSON de forma extremadamente concisa para ahorrar recursos. " +
      "Recetas simples, ingredientes realistas, máximo 2 pasos por plato.";

    const prompt =
      `Plan mediterráneo de 1 día.\n` +
      `Macros objetivo: Proteína ${protein}g, Grasas ${fat}g, Carbohidratos ${carbs}g.\n` +
      `Número de comidas: ${numMeals}.\n` +
      `Restricciones/estilo: ${dietaryFilter || "N/A"}.\n` +
      `Ingredientes disponibles (nevera): ${fridgeIngredients || "N/A"}.\n\n` +
      `INSTRUCCIONES DURAS:\n` +
      `- Devuelve SOLO JSON válido.\n` +
      `- Debe incluir exactamente ${numMeals} objetos en days[0].meals.\n` +
      `- Cada plato: máximo 2 pasos.\n` +
      `- Macros por plato coherentes (aprox) y total_macros del día informado.\n` +
      `- shopping_list: lista corta y útil.\n` +
      `- general_tips: 3-5 tips cortos.\n`;

    // JSON Schema (para responseJsonSchema en Gemini API)
    const responseJsonSchema = {
      type: "object",
      properties: {
        plan_name: { type: "string" },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day_name: { type: "string" },
              total_macros: {
                type: "object",
                properties: {
                  protein_g: { type: "number" },
                  fat_g: { type: "number" },
                  carbs_g: { type: "number" }
                },
                required: ["protein_g", "fat_g", "carbs_g"]
              },
              meals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    meal_type: { type: "string" },
                    recipe_name: { type: "string" },
                    short_description: { type: "string" },
                    macros: {
                      type: "object",
                      properties: {
                        protein_g: { type: "number" },
                        fat_g: { type: "number" },
                        carbs_g: { type: "number" }
                      },
                      required: ["protein_g", "fat_g", "carbs_g"]
                    },
                    ingredients: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          quantity_grams: { type: "number" }
                        },
                        required: ["name", "quantity_grams"]
                      }
                    },
                    steps: {
                      type: "array",
                      items: { type: "string" }
                    }
                  },
                  required: ["meal_type", "recipe_name", "macros", "ingredients", "steps"]
                }
              }
            },
            required: ["day_name", "total_macros", "meals"]
          }
        },
        shopping_list: { type: "array", items: { type: "string" } },
        general_tips: { type: "array", items: { type: "string" } }
      },
      required: ["plan_name", "days", "shopping_list", "general_tips"]
    };

    const body = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema,
        maxOutputTokens: 700,
        temperature: 0.4
      }
    };

    const resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body)
    });

    const json = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Error desde Gemini API.",
          details: json
        })
      };
    }

    const usage = json.usageMetadata || null;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Respuesta vacía o inválida del modelo.", details: json }) };
    }

    let plan;
    try {
      plan = JSON.parse(text);
    } catch (e) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "El modelo no devolvió JSON parseable.", raw: text }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ plan, usage })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Error interno en Netlify Function.", details: String(e?.message || e) })
    };
  }
};
