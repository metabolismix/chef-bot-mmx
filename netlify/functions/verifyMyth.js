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
        typeof card.macro_estimate === "object" &&
        card.macro_estimate !== null
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
        "x-chefbot-func-version": "v2-chefbot-2025-11-18d",
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

  const buildFallback = (mode, payload, reason) => {
    if (mode === "week") {
      return {
        mode: "week",
        plan_name: "Plan de respaldo",
        days: [],
        shopping_list: [],
        general_tips: [
          "Chef-Bot no ha podido generar el plan semanal con la IA en este momento.",
          "Los servidores externos de IA (Gemini) están devolviendo errores o están saturados. No es un fallo de Chef-Bot, de tu configuración ni de tus datos. Prueba a generar el plan de nuevo en unos minutos.",
          reason || "Error desconocido al llamar a la API de IA.",
        ],
        warnings: [],
      };
    }

    // Fallback receta (por compatibilidad, aunque ahora chef-bot usa modo week)
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
        "Cuando la configuración de la IA esté corregida, vuelve a intentar generar una receta con Chef-Bot.",
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

    // Compatibilidad: si viene el formato viejo { recipeRequest: ... }, lo tratamos como receta
    let mode = "week";
    let payload = {};

    if (parsedBody && parsedBody.mode === "recipe") {
      mode = "recipe";
      payload =
        typeof parsedBody.payload === "object" && parsedBody.payload !== null
          ? parsedBody.payload
          : {};
    } else if (parsedBody && parsedBody.mode === "week") {
      mode = "week";
      payload =
        typeof parsedBody.payload === "object" && parsedBody.payload !== null
          ? parsedBody.payload
          : {};
    } else if (parsedBody && parsedBody.recipeRequest) {
      mode = "recipe";
      payload = parsedBody.recipeRequest;
    }

    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      const fb = buildFallback(
        mode,
        payload,
        "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
      );
      return makeCardResponse(fb);
    }

    // ---------- CONFIG GEMINI v1 ----------
    const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Actúas como CHEF-BOT, un asistente de cocina en español.

Tu tarea es generar SIEMPRE una respuesta en formato JSON ESTRICTO, sin texto adicional, sin backticks y sin explicaciones fuera del JSON.

Hay dos modos:
1) "recipe"  -> una receta individual detallada.
2) "week"    -> un plan semanal simple con varias comidas por día.

REGLAS IMPORTANTES:
- No añadas texto fuera del JSON.
- No uses comentarios, ni //, ni bloques tipo \`\`\`json.
- Si la información nutricional no es fiable, deja los campos de macros en null.
- No hagas recomendaciones médicas; limítate a cocina y organización de comidas.
- Respeta la dieta mediterránea y recetas realistas, evitando combinaciones raras.
`;

    const userPrompt = `
MODO: ${mode}

DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

Objetivo:
- Si el modo es "recipe", genera una RECETA CONCRETA en español, sencilla y realista, respetando en lo posible sus preferencias, restricciones y macros objetivo.
- Si el modo es "week", genera un PLAN SEMANAL resumen con varios platos por día (no hace falta dar el paso a paso de todas las recetas, pero sí títulos y descripciones coherentes con macros y restricciones).

Recuerda: responde SOLO con un JSON válido. Nada de texto fuera del JSON.
`;

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      // ⚠️ NOMBRE CORRECTO EN v1: system_instruction (snake_case)
      system_instruction: { role: "system", parts: [{ text: systemPrompt }] },
      generation_config: {
        temperature: mode === "week" ? 0.4 : 0.35,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
      },
    };

    // ---------- LLAMADA A GEMINI CON PEQUEÑO SISTEMA DE REINTENTOS ----------
    const MAX_RETRIES = 2;
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "8000", 10);

    let lastError = null;
    let result = null;
    let ok = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          TIMEOUT_MS
        );

        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = json?.error?.message || "";
          const code = json?.error?.code || res.status || 0;

          // Guardamos el último error legible
          lastError = `La API de Gemini ha devuelto un error: Gemini ${code}: ${msg || "sin detalle"}.`;

          // Si es 503/overloaded o 500, intentamos reintentar
          if (code === 503 || code === 500) {
            if (attempt < MAX_RETRIES) {
              continue;
            }
          }

          // Otros códigos (400 etc.) no se van a arreglar con reintentos
          break;
        }

        // Si res.ok
        result = json;
        ok = true;
        break;
      } catch (err) {
        lastError =
          lastError ||
          `La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo configurado. Detalle: ${
            err?.message || String(err)
          }`;

        // Si es timeout / abort, reintentamos hasta MAX_RETRIES
        if (attempt < MAX_RETRIES) {
          continue;
        }
      }
    }

    if (!ok || !result) {
      const fb = buildFallback(mode, payload, lastError);
      return makeCardResponse(fb);
    }

    // ---------- PARSEO DE LA RESPUESTA DEL MODELO ----------
    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = robustParse(stripFences(rawText));

    if (!parsed || typeof parsed !== "object") {
      const fb = buildFallback(
        mode,
        payload,
        "La respuesta original del modelo no se ha podido convertir a un JSON válido."
      );
      return makeCardResponse(fb);
    }

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

      // Si no hay días, consideramos que la IA ha fallado estructuralmente
      if (!plan.days.length) {
        const fb = buildFallback(
          mode,
          payload,
          "La IA no ha devuelto un plan estructurado completo (sin días)."
        );
        return makeCardResponse(fb);
      }

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
          : (payload.servings || 1),
      meal_type: parsed.meal_type || payload.mealType || "Comida",
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients
        : [],
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
      const fb = buildFallback(
        mode,
        payload,
        "La respuesta de la IA no incluía suficientes ingredientes o pasos estructurados."
      );
      return makeCardResponse(fb);
    }

    return makeCardResponse(recipe);
  } catch (error) {
    const fb = buildFallback(
      "week",
      null,
      `Se produjo una excepción interna en la función del servidor: ${
        error?.message || String(error)
      }.`
    );
    return makeCardResponse(fb);
  }
};
