// netlify/functions/verifyMyth.js
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

  // ---------- UTILIDAD RESPUESTA ESTÁNDAR ----------
  const makeCardResponse = (card) => {
    const safe = {
      // Modo: "recipe" o "week"
      mode: card.mode === "week" ? "week" : "recipe",

      // ---- Campos de receta individual ----
      recipe_name: card.recipe_name || "",
      prep_minutes:
        typeof card.prep_minutes === "number" && card.prep_minutes >= 0
          ? card.prep_minutes
          : 0,
      cook_minutes:
        typeof card.cook_minutes === "number" && card.cook_minutes >= 0
          ? card.cook_minutes
          : 0,
      difficulty: card.difficulty || "Fácil",
      servings:
        typeof card.servings === "number" && card.servings > 0
          ? card.servings
          : 1,
      meal_type: card.meal_type || "",
      ingredients: Array.isArray(card.ingredients) ? card.ingredients : [],
      steps: Array.isArray(card.steps) ? card.steps : [],
      meal_summary: card.meal_summary || "",
      macro_estimate:
        typeof card.macro_estimate === "object" && card.macro_estimate !== null
          ? card.macro_estimate
          : {
              calories: null,
              protein_g: null,
              carbs_g: null,
              fat_g: null,
            },
      warnings: Array.isArray(card.warnings) ? card.warnings : [],

      // ---- Campos de plan semanal ----
      plan_name: card.plan_name || "",
      days: Array.isArray(card.days) ? card.days : [],
      shopping_list: Array.isArray(card.shopping_list)
        ? card.shopping_list
        : [],
      general_tips: Array.isArray(card.general_tips)
        ? card.general_tips
        : [],
    };

    // IMPORTANTE: mantenemos este formato tipo "candidates" porque tu frontend ya lo espera así
    const text = JSON.stringify(safe);
    const result = {
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    };

    return {
      statusCode: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "x-chefbot-func-version": "v2-chefbot-2025-11-18",
      },
      body: JSON.stringify(result),
    };
  };

  // ---------- UTILIDADES DE PARSEO ----------
  const stripFences = (t) => {
    if (!t || typeof t !== "string") return "";
    let x = t.trim();
    if (x.startsWith("```")) {
      x = x.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    }
    return x.trim();
  };

  const robustParse = (text) => {
    if (!text || typeof text !== "string") return null;
    const t = text.trim();
    if (!t) return null;

    // 1) intento directo
    try {
      return JSON.parse(t);
    } catch {}

    // 2) array raíz -> primer objeto
    if (t.startsWith("[")) {
      try {
        const a = JSON.parse(t);
        if (Array.isArray(a) && a.length && typeof a[0] === "object") {
          return a[0];
        }
      } catch {}
    }

    // 3) extraer bloque { ... } balanceado
    const start = t.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) {
            esc = false;
          } else if (ch === "\\") {
            esc = true;
          } else if (ch === '"') {
            inStr = false;
          }
        } else {
          if (ch === '"') inStr = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
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

  const buildFallbackRecipe = (mode, payload, reason) => {
    if (mode === "week") {
      return {
        mode: "week",
        plan_name: "Plan semanal simplificado",
        days: [],
        shopping_list: [],
        general_tips: [
          "No he podido estructurar correctamente el plan semanal a partir de la respuesta de la IA.",
          reason ||
            "Se ha generado un plan de respaldo mínimo para no interrumpir la experiencia de uso.",
        ],
        warnings: [],
      };
    }

    const ingText = (payload && payload.ingredientsText) || "";
    const items = ingText
      ? ingText
          .split(/[,\n]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : ["Ingredientes que ya tienes a mano"];

    return {
      mode: "recipe",
      recipe_name: "Receta simplificada",
      prep_minutes: 0,
      cook_minutes: 0,
      difficulty: "Fácil",
      servings: (payload && payload.servings) || 1,
      ingredients: items.map((name) => ({
        name,
        quantity_grams: null,
        notes: "",
      })),
      steps: [
        "Prepara una comida sencilla utilizando los ingredientes que ya tienes a mano.",
        "Cuando la configuración del servidor esté corregida, vuelve a intentar generar una receta con IA.",
      ],
      meal_summary:
        "No he podido estructurar la respuesta de la IA, así que te propongo una receta simplificada basada en los ingredientes.",
      warnings: [
        reason ||
          "La respuesta original del modelo no se ha podido convertir a un JSON válido.",
        "Se ha generado una receta de respaldo para no interrumpir la experiencia de uso.",
      ],
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
    };
  };

  try {
    // ---------- INPUT ----------
    const parsedBody = JSON.parse(event.body || "{}");
    const mode = parsedBody.mode === "week" ? "week" : "recipe";
    const payload =
      typeof parsedBody.payload === "object" && parsedBody.payload !== null
        ? parsedBody.payload
        : {};

    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      const fb = buildFallbackRecipe(
        mode,
        payload,
        "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
      );
      return makeCardResponse(fb);
    }

    const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Actúas como CHEF-BOT, un asistente de cocina en español.

Tu tarea es generar SIEMPRE una respuesta en formato JSON ESTRICTO, sin texto adicional, sin backticks y sin explicaciones fuera del JSON.

Hay dos modos:
1) "recipe"  -> una receta individual detallada.
2) "week"    -> un plan semanal simple.

REGLAS IMPORTANTES:
- No añadas texto fuera del JSON.
- No uses comentarios, ni //, ni bloques tipo \`\`\`json.
- Si la información nutricional no es fiable, deja los campos de macros en null.
- No hagas recomendaciones médicas; limítate a cocina y organización de comidas.
`;

    const recipeSchema = {
      type: "object",
      properties: {
        mode: { type: "string" },
        recipe_name: { type: "string" },
        prep_minutes: { type: "integer" },
        cook_minutes: { type: "integer" },
        difficulty: { type: "string" },
        servings: { type: "integer" },
        meal_type: { type: "string" },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity_grams: { type: "number" },
              notes: { type: "string" },
            },
            required: ["name"],
          },
        },
        steps: {
          type: "array",
          items: { type: "string" },
        },
        meal_summary: { type: "string" },
        macro_estimate: {
          type: "object",
          properties: {
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
        },
        warnings: { type: "array", items: { type: "string" } },
        plan_name: { type: "string" }, // tolerado, aunque no se use
        days: { type: "array" },
        shopping_list: { type: "array" },
        general_tips: { type: "array" },
      },
      required: [
        "mode",
        "recipe_name",
        "prep_minutes",
        "cook_minutes",
        "difficulty",
        "ingredients",
        "steps",
      ],
    };

    const weekSchema = {
      type: "object",
      properties: {
        mode: { type: "string" },
        plan_name: { type: "string" },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day_name: { type: "string" },
              meals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    meal_type: { type: "string" },
                    recipe_name: { type: "string" },
                    short_description: { type: "string" },
                  },
                  required: ["meal_type", "recipe_name"],
                },
              },
            },
            required: ["day_name", "meals"],
          },
        },
        shopping_list: { type: "array", items: { type: "string" } },
        general_tips: { type: "array", items: { type: "string" } },

        // campos de receta tolerados pero no obligatorios
        recipe_name: { type: "string" },
        ingredients: { type: "array" },
        steps: { type: "array" },
        warnings: { type: "array" },
      },
      required: ["mode", "plan_name", "days"],
    };

    const responseSchema = mode === "week" ? weekSchema : recipeSchema;

    const userPrompt = `
MODO: ${mode}

DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

Objetivo:
- Si el modo es "recipe", genera una RECETA CONCRETA en español, sencilla y realista, respetando en lo posible sus preferencias, restricciones y macros objetivo, con marcado carácter de dieta mediterránea.
- Si el modo es "week", genera un PLAN SEMANAL resumen con varios platos por día (no hace falta dar el paso a paso completo, solo títulos y descripciones breves) siguiendo patrones de dieta mediterránea y respetando macros objetivos globales.

Recuerda: responde SOLO con un JSON válido que cumpla el esquema.
`;

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: mode === "week" ? 0.5 : 0.4,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema,
      },
    };

    // ---------- LLAMADA A GEMINI ----------
    // Subimos el timeout interno a 9000 ms por defecto (configurable)
    const TIMEOUT_MS = parseInt(
      process.env.GEMINI_TIMEOUT_MS || "9000",
      10
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    let result;

    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      // Log para ver el error en los logs de Netlify
      console.error("Error al llamar a la API de Gemini:", err);

      const isTimeout = err && err.name === "AbortError";
      const reason = isTimeout
        ? "La llamada a la API de Gemini ha excedido el tiempo máximo configurado (timeout interno de la función)."
        : `La llamada a la API de Gemini ha fallado: ${
            err && err.message ? err.message : "error desconocido"
          }.`;

      const fb = buildFallbackRecipe(mode, payload, reason);
      return makeCardResponse(fb);
    }

    clearTimeout(timeoutId);
    result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result && result.error && result.error.message
        ? result.error.message
        : "";
      const code =
        (result && result.error && result.error.code) || res.status || 0;

      console.error(
        "Respuesta no OK de Gemini:",
        JSON.stringify(result || {}, null, 2)
      );

      const fb = buildFallbackRecipe(
        mode,
        payload,
        `La API de Gemini ha devuelto un error (código ${code}): ${
          msg || "sin detalle"
        }.`
      );
      return makeCardResponse(fb);
    }

    // ---------- PARSEO DE LA RESPUESTA DEL MODELO ----------
    const rawText =
      result &&
      result.candidates &&
      result.candidates[0] &&
      result.candidates[0].content &&
      result.candidates[0].content.parts &&
      result.candidates[0].content.parts[0] &&
      result.candidates[0].content.parts[0].text
        ? result.candidates[0].content.parts[0].text
        : "";

    const parsed = robustParse(stripFences(rawText));

    if (!parsed || typeof parsed !== "object") {
      const fb = buildFallbackRecipe(
        mode,
        payload,
        "La respuesta original del modelo no se ha podido convertir a un JSON válido."
      );
      return makeCardResponse(fb);
    }

    // Normalización suave:
    if (mode === "week") {
      const plan = {
        mode: "week",
        plan_name: parsed.plan_name || "Plan semanal",
        days: Array.isArray(parsed.days) ? parsed.days : [],
        shopping_list: Array.isArray(parsed.shopping_list)
          ? parsed.shopping_list
          : [],
        general_tips: Array.isArray(parsed.general_tips)
          ? parsed.general_tips
          : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      };
      return makeCardResponse(plan);
    }

    // mode === "recipe"
    const recipe = {
      mode: "recipe",
      recipe_name: parsed.recipe_name || "Receta sin título",
      prep_minutes:
        typeof parsed.prep_minutes === "number" ? parsed.prep_minutes : 0,
      cook_minutes:
        typeof parsed.cook_minutes === "number" ? parsed.cook_minutes : 0,
      difficulty: parsed.difficulty || "Fácil",
      servings:
        typeof parsed.servings === "number" && parsed.servings > 0
          ? parsed.servings
          : payload.servings || 1,
      meal_type: parsed.meal_type || payload.mealType || "Comida",
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      meal_summary: parsed.meal_summary || "",
      macro_estimate:
        typeof parsed.macro_estimate === "object" &&
        parsed.macro_estimate !== null
          ? parsed.macro_estimate
          : {
              calories: null,
              protein_g: null,
              carbs_g: null,
              fat_g: null,
            },
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };

    if (!recipe.ingredients.length || !recipe.steps.length) {
      const fb = buildFallbackRecipe(
        mode,
        payload,
        "La respuesta de la IA no incluía suficientes ingredientes o pasos estructurados."
      );
      return makeCardResponse(fb);
    }

    return makeCardResponse(recipe);
  } catch (error) {
    console.error(
      "Excepción interna en la función verifyMyth:",
      error && error.stack ? error.stack : error
    );

    const fb = buildFallbackRecipe(
      "recipe",
      null,
      `Se produjo una excepción interna en la función del servidor: ${
        (error && error.message) || String(error)
      }.`
    );
    return makeCardResponse(fb);
  }
};
