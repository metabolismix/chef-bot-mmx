/**
 * Netlify Function: netlify/functions/chef.js
 * Requiere env var: GEMINI_API_KEY (o GOOGLE_API_KEY)
 */

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function safeParseJSON(str) {
  // 1) parse directo
  try { return { ok: true, data: JSON.parse(str) }; } catch (_) {}

  // 2) intentar extraer el primer {...} completo
  const first = str.indexOf("{");
  const last = str.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const slice = str.slice(first, last + 1);
    try { return { ok: true, data: JSON.parse(slice) }; } catch (_) {}
  }
  return { ok: false };
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function kcalFromMacros(p, c, f) {
  return Math.round(p * 4 + c * 4 + f * 9);
}

function buildSchema(numMeals) {
  // Schema suficientemente estricto para evitar “strings rotas”, pero no tan frágil que rompa generación.
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      plan_name: { type: "string" },
      days: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            day_name: { type: "string" },
            total_macros: {
              type: "object",
              additionalProperties: false,
              properties: {
                protein_g: { type: "number" },
                fat_g: { type: "number" },
                carbs_g: { type: "number" }
              },
              required: ["protein_g", "fat_g", "carbs_g"]
            },
            meals: {
              type: "array",
              minItems: numMeals,
              maxItems: numMeals,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  meal_type: { type: "string" },
                  recipe_name: { type: "string" },
                  macros: {
                    type: "object",
                    additionalProperties: false,
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
                      additionalProperties: false,
                      properties: {
                        name: { type: "string" },
                        quantity_grams: { type: "number" }
                      },
                      required: ["name", "quantity_grams"]
                    }
                  },
                  steps: {
                    type: "array",
                    maxItems: 2,
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
}

async function geminiCall({ apiKey, prompt, responseJsonSchema, maxOutputTokens }) {
  const body = {
    contents: [
      { role: "user", parts: [{ text: prompt }] }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0.5,
      maxOutputTokens
    }
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  if (!res.ok) {
    // Intentar devolver algo útil
    let msg = raw;
    try {
      const j = JSON.parse(raw);
      msg = j?.error?.message || raw;
    } catch (_) {}
    throw new Error(msg);
  }

  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = data?.usageMetadata ?? null;

  return { text, usage };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Método no permitido" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      ok: false,
      error: "Falta la variable de entorno GEMINI_API_KEY (o GOOGLE_API_KEY) en Netlify."
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "Body JSON inválido." });
  }

  const mode = (payload.mode === "fridge") ? "fridge" : "ideal";
  const targets = payload.targets || {};
  const numMeals = clamp(payload.numMeals, 3, 5);

  const protein = clamp(targets.protein_g, 0, 400);
  const fat = clamp(targets.fat_g, 0, 200);
  const carbs = clamp(targets.carbs_g, 0, 600);

  const filter = String(payload.filter || "").trim().slice(0, 120);
  const fridge = String(payload.fridge || "").trim().slice(0, 1200);

  const totalKcal = kcalFromMacros(protein, carbs, fat);

  if (mode === "fridge" && fridge.length < 3) {
    return jsonResponse(400, { ok: false, error: "Falta texto en NEVERA para cocinar con tu nevera." });
  }

  const schema = buildSchema(numMeals);

  const instructions = [
    "Eres un chef mediterráneo pragmático. Devuelve SOLO un JSON válido y nada más.",
    "Planifica 1 día con EXACTAMENTE el número de platos indicado.",
    "Ajusta macros aproximados al objetivo diario total; por plato reparte de forma razonable.",
    "Ingredientes en gramos (quantity_grams). Preparación en máximo 2 pasos por plato.",
    "Recetas realistas, sin florituras, con ingredientes comunes en España.",
  ];

  if (filter) instructions.push(`Restricción/filtro: ${filter}`);
  if (mode === "fridge") {
    instructions.push("Modo NEVERA: prioriza usar lo disponible. Si falta algo, añade mínimos complementos en la lista de compra.");
    instructions.push(`Nevera disponible: ${fridge}`);
  }

  const prompt = `
OBJETIVO DIARIO (aprox):
- Proteína: ${protein} g
- Grasas: ${fat} g
- Carbos: ${carbs} g
- Calorías estimadas: ${totalKcal} kcal
- Platos/día: ${numMeals}

INSTRUCCIONES:
${instructions.map(x => `- ${x}`).join("\n")}

FORMATO:
- Responde con un JSON que cumpla el schema.
- Incluye:
  - plan_name (string)
  - days[0].day_name (string)
  - days[0].total_macros (protein_g, fat_g, carbs_g)
  - days[0].meals (array de ${numMeals} platos)
  - shopping_list (array)
  - general_tips (array)
`.trim();

  try {
    // 1ª llamada (principal)
    const first = await geminiCall({
      apiKey,
      prompt,
      responseJsonSchema: schema,
      maxOutputTokens: 1200
    });

    let parsed = safeParseJSON(first.text);
    if (!parsed.ok) {
      // 2ª llamada: reparación
      const repairPrompt = `
Tu salida anterior NO era JSON válido. Devuelve SOLO un JSON válido que cumpla el schema.
Salida anterior (para reparar):
${first.text}
`.trim();

      const second = await geminiCall({
        apiKey,
        prompt: repairPrompt,
        responseJsonSchema: schema,
        maxOutputTokens: 1200
      });

      parsed = safeParseJSON(second.text);
      if (!parsed.ok) {
        return jsonResponse(500, {
          ok: false,
          error: "El modelo devolvió una respuesta no parseable incluso tras reparación."
        });
      }

      return jsonResponse(200, {
        ok: true,
        plan: parsed.data,
        usage: second.usage || first.usage || null
      });
    }

    return jsonResponse(200, {
      ok: true,
      plan: parsed.data,
      usage: first.usage || null
    });
  } catch (e) {
    const msg = String(e?.message || "Error desconocido");
    return jsonResponse(500, { ok: false, error: msg });
  }
};
