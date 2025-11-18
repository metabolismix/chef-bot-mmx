// netlify/functions/verifyMyth.js
// Chef-Bot: generación de recetas y planes semanales con Gemini (gemini-2.5-flash)

exports.handler = async function (event, context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // ---------- CORS / MÉTODO ----------
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." }),
    };
  }

  // ---------- CLAVE Y MODELO ----------
  const GEMINI_API_KEY =
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY_CHEFBOT;

  // Modelo por defecto: gemini-2.5-flash
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        error:
          "Falta la clave de la API de Gemini. Configura GOOGLE_API_KEY o GEMINI_API_KEY en Netlify.",
      }),
    };
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------- UTILIDADES COMUNES ----------

  function makeCardResponse(card) {
    const safeCard = card && typeof card === "object" ? card : {};
    return {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(safeCard),
              },
            ],
          },
        },
      ],
    };
  }

  function stripCodeFences(text) {
    if (!text || typeof text !== "string") return "";
    return text
      .replace(/```json/gi, "```")
      .replace(/```/g, "")
      .trim();
  }

  function robustParse(text) {
    if (!text || typeof text !== "string") return null;
    const cleaned = stripCodeFences(text);

    try {
      return JSON.parse(cleaned);
    } catch {
      // Intento de rescatar el primer objeto JSON que aparezca
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = cleaned.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // ignorar
        }
      }
      return null;
    }
  }

  function normalizeRecipe(raw, forcedMode) {
    const macro =
      raw && typeof raw.macro_estimate === "object"
        ? raw.macro_estimate
        : {};

    const ingredients = Array.isArray(raw?.ingredients)
      ? raw.ingredients
          .filter((i) => i && typeof i === "object")
          .map((i) => ({
            name: String(i.name || "").trim(),
            amount: String(i.amount || "").trim(),
            unit: String(i.unit || "").trim(),
            group: String(i.group || "").trim(),
          }))
          .filter((i) => i.name)
      : [];

    const steps = Array.isArray(raw?.steps)
      ? raw.steps.filter((s) => typeof s === "string" && s.trim())
      : [];

    const warnings = Array.isArray(raw?.warnings)
      ? raw.warnings.filter((s) => typeof s === "string" && s.trim())
      : [];

    const prepMinutes =
      Number.isFinite(raw?.prep_minutes) && raw.prep_minutes >= 0
        ? raw.prep_minutes
        : 10;
    const cookMinutes =
      Number.isFinite(raw?.cook_minutes) && raw.cook_minutes >= 0
        ? raw.cook_minutes
        : 10;
    const servings =
      Number.isFinite(raw?.servings) && raw.servings > 0
        ? raw.servings
        : 1;

    return {
      mode: forcedMode || raw?.mode || "recipe",
      recipe_name: String(
        raw?.recipe_name || raw?.title || "Receta generada por Chef-Bot"
      ).trim(),
      prep_minutes: prepMinutes,
      cook_minutes: cookMinutes,
      difficulty:
        typeof raw?.difficulty === "string" && raw.difficulty.trim()
          ? raw.difficulty.trim()
          : "Fácil",
      servings,
      meal_type:
        typeof raw?.meal_type === "string" && raw.meal_type.trim()
          ? raw.meal_type.trim()
          : "",
      ingredients,
      steps,
      meal_summary:
        typeof raw?.meal_summary === "string" ? raw.meal_summary : "",
      macro_estimate: {
        calories: Number.isFinite(macro.calories) ? macro.calories : null,
        protein_g: Number.isFinite(macro.protein_g) ? macro.protein_g : null,
        carbs_g: Number.isFinite(macro.carbs_g) ? macro.carbs_g : null,
        fat_g: Number.isFinite(macro.fat_g) ? macro.fat_g : null,
      },
      warnings,
    };
  }

  function buildFallbackRecipe(technicalErrorMessage) {
    const warnings = [
      "Chef-Bot no ha podido generar una receta detallada con la IA en este momento.",
      "Los servidores externos de IA (Gemini) están devolviendo errores o están saturados. No es un fallo de Chef-Bot ni de tu configuración. Prueba de nuevo en unos minutos.",
    ];
    if (technicalErrorMessage) {
      warnings.push(
        `Detalle técnico (para depuración): ${technicalErrorMessage}`
      );
    }

    return {
      mode: "recipe",
      recipe_name: "Receta de respaldo - Chef-Bot",
      prep_minutes: 5,
      cook_minutes: 10,
      difficulty: "Fácil",
      servings: 1,
      meal_type: "",
      ingredients: [],
      steps: [
        "En este momento la IA externa (Gemini) no ha podido generar una receta.",
        "Vuelve a intentar la generación en unos minutos, cuando los servidores estén menos saturados.",
      ],
      meal_summary:
        "Receta de respaldo mostrada porque la IA externa no está disponible.",
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
      warnings,
    };
  }

  function buildFallbackPlan(technicalErrorMessage) {
    const base = buildFallbackRecipe(technicalErrorMessage);
    return {
      mode: "week",
      plan_name: "Plan de respaldo - Chef-Bot",
      days: [],
      shopping_list: [],
      general_tips: base.warnings,
    };
  }

  function normalizePlanOrRecipe(mode, raw) {
    if (mode === "week") {
      const safeDays = Array.isArray(raw?.days) ? raw.days : [];
      const days = safeDays
        .filter((d) => d && typeof d === "object")
        .map((d, index) => ({
          day_name:
            typeof d.day_name === "string" && d.day_name.trim()
              ? d.day_name.trim()
              : `Día ${index + 1}`,
          meals: Array.isArray(d.meals)
            ? d.meals.map((m) => normalizeRecipe(m, "recipe"))
            : [],
        }));

      const shoppingList = Array.isArray(raw?.shopping_list)
        ? raw.shopping_list
            .filter((i) => i && typeof i === "object")
            .map((i) => ({
              name: String(i.name || "").trim(),
              quantity: String(i.quantity || "").trim(),
              category: String(i.category || "").trim(),
            }))
            .filter((i) => i.name)
        : [];

      const generalTips = Array.isArray(raw?.general_tips)
        ? raw.general_tips.filter(
            (t) => typeof t === "string" && t.trim()
          )
        : [];

      return {
        mode: "week",
        plan_name:
          typeof raw?.plan_name === "string" && raw.plan_name.trim()
            ? raw.plan_name.trim()
            : "Plan semanal generado por Chef-Bot",
        days,
        shopping_list: shoppingList,
        general_tips: generalTips,
      };
    }

    // Por defecto, tratamos como receta
    return normalizeRecipe(raw, "recipe");
  }

  async function callGemini(requestBody) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const text = await response.text();
      let json = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }

      if (!response.ok) {
        const message =
          (json && json.error && json.error.message) || text || "Unknown error";
        const err = new Error(`Gemini ${response.status}: ${message}`);
        err.statusCode = response.status;
        throw err;
      }

      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- PROMPT DE SISTEMA (EMBUTIDO EN EL MENSAJE DEL USUARIO) ----------

  const systemPrompt = `
Eres Chef-Bot, un asistente de nutrición que genera planes de comidas y recetas en castellano, pensado para dieta mediterránea y vida real.

OBJETIVO GENERAL:
- A partir de los datos del usuario (objetivos de macros, restricciones dietéticas, ingredientes disponibles, tipo de comida, etc.), debes generar:
  - Modo "week": un PLAN SEMANAL completo, coherente y realista.
  - Modo "recipe": una RECETA individual detallada.

ESTILO Y FILOSOFÍA:
- Cocina mediterránea, casera, realista y de diario.
- Evita combinaciones raras o poco apetecibles (por ejemplo, atún con plátano y espinacas en el desayuno).
- Usa combinaciones que una persona realmente comería en un contexto europeo/mediterráneo.
- Respeta las restricciones dietéticas indicadas (vegano, vegetariano, sin lácteos, sin gluten, etc.).
- Respeta al máximo los objetivos de macros, pero siempre priorizando que la receta o el plan tengan sentido culinario y cultural.

REGLAS PARA LOS MACROS:
- Intenta ajustar los macros diarios al objetivo del usuario, sumando todas las comidas del día.
- No hace falta clavar los valores al milímetro, pero intenta que el total diario quede razonablemente cerca del objetivo.
- Si debes desviarte un poco para mantener recetas realistas, hazlo, pero manteniendo un buen equilibrio de proteína, hidratos y grasas.

INGREDIENTES Y NEVERA:
- Si el usuario indica ingredientes disponibles en la nevera o despensa, priorízalos.
- No inventes ingredientes exóticos si el usuario pide cosas simples.
- Usa cantidades razonables y redondas (gramos, cucharadas, unidades).

FORMATO DE RESPUESTA:
- Debes responder SIEMPRE con UN ÚNICO OBJETO JSON VÁLIDO.
- NO incluyas explicaciones fuera del JSON.
- NO añadas texto antes o después del JSON.
- No uses comentarios ni campos adicionales que no se pidan.

ESTRUCTURA JSON ESPERADA:

1) MODO "week" (plan semanal):
{
  "mode": "week",
  "plan_name": "string",
  "days": [
    {
      "day_name": "Lunes",
      "meals": [
        {
          "recipe_name": "string",
          "prep_minutes": number,
          "cook_minutes": number,
          "difficulty": "Fácil" | "Media" | "Difícil",
          "servings": number,
          "meal_type": "desayuno" | "comida" | "cena" | "snack",
          "ingredients": [
            {
              "name": "string",
              "amount": "string",
              "unit": "string",
              "group": "string"
            }
          ],
          "steps": ["string", "..."],
          "meal_summary": "string",
          "macro_estimate": {
            "calories": number,
            "protein_g": number,
            "carbs_g": number,
            "fat_g": number
          },
          "warnings": ["string", "..."]
        }
      ]
    }
  ],
  "shopping_list": [
    {
      "name": "string",
      "quantity": "string",
      "category": "string"
    }
  ],
  "general_tips": ["string", "..."]
}

2) MODO "recipe" (receta individual):
{
  "mode": "recipe",
  "recipe_name": "string",
  "prep_minutes": number,
  "cook_minutes": number,
  "difficulty": "Fácil" | "Media" | "Difícil",
  "servings": number,
  "meal_type": "desayuno" | "comida" | "cena" | "snack",
  "ingredients": [
    {
      "name": "string",
      "amount": "string",
      "unit": "string",
      "group": "string"
    }
  ],
  "steps": ["string", "..."],
  "meal_summary": "string",
  "macro_estimate": {
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number
  },
  "warnings": ["string", "..."]
}

NO uses campos adicionales fuera de estas estructuras. Si algún dato no lo conoces con precisión, puedes aproximarlo o dejarlo en null.
  `.trim();

  // ---------- PARSE DEL BODY ----------
  let parsedBody = {};
  try {
    parsedBody = JSON.parse(event.body || "{}");
  } catch {
    parsedBody = {};
  }

  const mode = parsedBody.mode === "week" ? "week" : "recipe";
  const payload =
    parsedBody && typeof parsedBody.payload === "object" && parsedBody.payload
      ? parsedBody.payload
      : {};

  const userPrompt =
    mode === "week"
      ? `
DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

TAREA:
Genera un plan semanal completo ("mode": "week") siguiendo estrictamente la estructura indicada en las instrucciones de sistema.
Ajusta al máximo los macros diarios objetivo, manteniendo recetas mediterráneas realistas y apetecibles.
Evita combinaciones raras o chocantes.
    `.trim()
      : `
DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

TAREA:
Genera una receta individual ("mode": "recipe") siguiendo estrictamente la estructura indicada en las instrucciones de sistema.
Ajusta la receta a los macros y restricciones del usuario, con ingredientes y pasos realistas.
    `.trim();

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: fullPrompt }],
      },
    ],
    generation_config: {
      temperature: mode === "week" ? 0.55 : 0.4,
      top_p: 0.9,
      top_k: 32,
      max_output_tokens: 2048,
    },
  };

  // ---------- LLAMADA A GEMINI CON REINTENTOS ----------
  const MAX_RETRIES = 3;
  let geminiResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      geminiResponse = await callGemini(requestBody);
      break; // éxito
    } catch (err) {
      lastError = err;
      const status =
        typeof err.statusCode === "number" ? err.statusCode : null;

      // Si es 4xx (excepto 429) no tiene sentido reintentar
      if (status && status >= 400 && status < 500 && status !== 429) {
        break;
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * 600)
        );
      }
    }
  }

  let normalized;

  if (geminiResponse) {
    const rawText =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = robustParse(rawText);

    if (parsed && typeof parsed === "object") {
      normalized = normalizePlanOrRecipe(mode, parsed);
    } else {
      const technical =
        "La IA ha respondido en un formato no JSON parseable.";
      normalized =
        mode === "week"
          ? buildFallbackPlan(technical)
          : buildFallbackRecipe(technical);
    }
  } else {
    const technicalError =
      lastError && lastError.message
        ? lastError.message
        : "Error desconocido en la llamada a Gemini.";
    normalized =
      mode === "week"
        ? buildFallbackPlan(technicalError)
        : buildFallbackRecipe(technicalError);
  }

  const body = JSON.stringify(makeCardResponse(normalized));

  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body,
  };
};
