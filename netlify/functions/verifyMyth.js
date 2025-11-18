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

  // ---------- UTILIDAD RESPUESTA ESTÁNDAR (ENVUELTA EN candidates[...] COMO AHORA) ----------
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
        "x-chefbot-func-version": "v2-chefbot-g1_5-flash-2025-11-18",
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

  // ---------- FALLBACKS ----------
  const buildFallbackPlan = (reason) => {
    return {
      mode: "week",
      plan_name: "Plan de respaldo",
      days: [],
      shopping_list: [],
      general_tips: [
        "La IA no ha devuelto un plan estructurado completo. Se ha generado un plan mínimo de respaldo.",
        reason || "Error genérico al llamar a la API de Gemini.",
      ],
      warnings: [],
    };
  };

  const buildFallbackRecipe = (payload, reason) => {
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
      prep_minutes: 5,
      cook_minutes: 10,
      difficulty: "Fácil",
      servings: (payload && payload.servings) || 1,
      meal_type: (payload && payload.mealType) || "Comida",
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
    let parsedBody = {};
    try {
      parsedBody = JSON.parse(event.body || "{}");
    } catch {
      parsedBody = {};
    }

    // Soportamos dos patrones:
    // 1) { mode, payload }  -> para plan semanal
    // 2) { recipeRequest }  -> para receta individual
    let mode = parsedBody.mode === "week" ? "week" : "recipe";

    let payload = null;
    if (mode === "week" && parsedBody && typeof parsedBody.payload === "object") {
      payload = parsedBody.payload;
    } else if (parsedBody && typeof parsedBody.recipeRequest === "object") {
      mode = "recipe";
      payload = parsedBody.recipeRequest;
    }

    if (typeof payload !== "object" || payload === null) {
      payload = {};
    }

    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      const fb =
        mode === "week"
          ? buildFallbackPlan(
              "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
            )
          : buildFallbackRecipe(
              payload,
              "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
            );
      return makeCardResponse(fb);
    }

    // ---------- MODELO: GEMINI 1.5 FLASH ----------
    const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // ---------- PROMPTS ----------
    const systemPrompt = `
Actúas como CHEF-BOT, un asistente de cocina en español.

Tu misión:
- Generar planes de comidas y recetas realistas, sencillas y coherentes con la dieta mediterránea.
- Ajustar lo mejor posible los macronutrientes objetivo (proteínas, grasas, carbohidratos).
- Respetar SIEMPRE:
  - Restricciones dietéticas indicadas (alergias, intolerancias, preferencias).
  - Ingredientes disponibles en la nevera cuando se proporcionan.
- No inventar platos absurdos (ej: gambas con leche de almendras para merendar, atún con plátano y espinacas para desayunar, etc.).

Formato de salida:
- Debes responder SIEMPRE con UN ÚNICO JSON VÁLIDO.
- Sin texto fuera del JSON.
- Sin backticks.
- Sin comentarios.
- Sin campos sorpresa fuera de los descritos.

Para modo "week" (plan semanal), un ejemplo de estructura que debes imitar es:
{
  "mode": "week",
  "plan_name": "Plan semanal ajustado a tus macros",
  "days": [
    {
      "day_name": "Lunes",
      "meals": [
        {
          "meal_type": "Desayuno",
          "recipe_name": "Tostadas integrales con aguacate y huevo",
          "short_description": "Desayuno rico en proteína y grasa saludable con pan integral, aguacate y huevo."
        }
      ]
    }
  ],
  "shopping_list": ["pan integral", "aguacate", "huevos"],
  "general_tips": [
    "Consejo general sobre organización del batch cooking, hidratación, etc."
  ],
  "warnings": [
    "Alguna advertencia relevante si procede."
  ]
}

Para modo "recipe", un ejemplo de estructura que debes imitar es:
{
  "mode": "recipe",
  "recipe_name": "Pechuga de pollo a la plancha con patata y ensalada",
  "prep_minutes": 10,
  "cook_minutes": 15,
  "difficulty": "Fácil",
  "servings": 1,
  "meal_type": "Almuerzo",
  "ingredients": [
    { "name": "pechuga de pollo", "quantity_grams": 150, "notes": "a la plancha" },
    { "name": "patata cocida", "quantity_grams": 200, "notes": "en dados" },
    { "name": "ensalada mixta", "quantity_grams": 80, "notes": "lechuga, tomate, cebolla" }
  ],
  "steps": [
    "Paso 1...",
    "Paso 2..."
  ],
  "meal_summary": "Resumen corto y amigable del plato.",
  "macro_estimate": {
    "calories": 600,
    "protein_g": 40,
    "carbs_g": 60,
    "fat_g": 18
  },
  "warnings": [
    "Advertencias relevantes si las hay."
  ]
}
`;

    let userPrompt;
    if (mode === "week") {
      const {
        targetProtein,
        targetFat,
        targetCarbs,
        numMeals,
        numDays,
        dietaryFilter,
        fridgeIngredients,
      } = payload;

      userPrompt = `
MODO: week (plan semanal)

OBJETIVOS DIARIOS (aprox):
- Proteína (g/día): ${targetProtein ?? "no indicado"}
- Grasas (g/día): ${targetFat ?? "no indicado"}
- Carbohidratos (g/día): ${targetCarbs ?? "no indicado"}

NÚMERO DE COMIDAS AL DÍA: ${numMeals ?? "no indicado"}
NÚMERO DE DÍAS A PLANIFICAR: ${numDays ?? "no indicado"}

RESTRICCIONES DIETÉTICAS / PREFERENCIAS:
${dietaryFilter || "Ninguna restricción específica."}

INGREDIENTES EN LA NEVERA (para priorizar cuando tenga sentido):
${fridgeIngredients || "No se ha especificado nada, puedes usar alimentos típicos de dieta mediterránea."}

Instrucciones clave:
- Genera un plan semanal realista de estilo mediterráneo.
- No hagas combinaciones raras (nada de mezclas forzadas dulce-salado tipo atún con plátano).
- Ajusta lo mejor posible los macros a nivel de día (no hace falta cuadrar al gramo cada comida, pero sí que el total del día se acerque a los objetivos).
- Devuélvelo TODO en un único JSON siguiendo el esquema de "week".
`;
    } else {
      // mode === "recipe"
      const {
        comida,
        descripcion,
        ingredientes,
        macrosObjetivo,
        restricciones,
        notas,
      } = payload;

      userPrompt = `
MODO: recipe (receta individual)

TIPO DE COMIDA: ${comida || "No especificado"}
DESCRIPCIÓN DE LA COMIDA: ${descripcion || "No especificada"}

INGREDIENTES DISPONIBLES (con gramos):
${JSON.stringify(ingredientes || [], null, 2)}

MACROS OBJETIVO APROXIMADOS PARA ESTA COMIDA:
${JSON.stringify(macrosObjetivo || {}, null, 2)}

RESTRICCIONES DIETÉTICAS / PREFERENCIAS:
${restricciones || "Ninguna restricción específica."}

NOTAS ADICIONALES:
${notas || "Sin notas adicionales."}

Instrucciones clave:
- Usa SOLO los ingredientes listados con cantidades coherentes.
- No añadas ingredientes nuevos.
- Respeta las restricciones dietéticas.
- Ajusta lo mejor posible la receta a los macros objetivo.
- Haz una receta realista, sencilla y estilo mediterráneo.
- Devuélvelo TODO en un único JSON siguiendo el esquema de "recipe".
`;
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\n" + userPrompt }],
        },
      ],
      generationConfig: {
        temperature: mode === "week" ? 0.5 : 0.4,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: mode === "week" ? 2048 : 1024,
      },
    };

    // ---------- LLAMADA A GEMINI ----------
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "10000", 10);
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
      const fb =
        mode === "week"
          ? buildFallbackPlan(
              "La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo configurado."
            )
          : buildFallbackRecipe(
              payload,
              "La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo configurado."
            );
      return makeCardResponse(fb);
    }

    clearTimeout(timeoutId);
    result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result?.error?.message || "";
      const code = result?.error?.code || res.status || 0;
      const fb =
        mode === "week"
          ? buildFallbackPlan(
              `La API de Gemini ha devuelto un error: Gemini ${code}: ${msg || "sin detalle"}.`
            )
          : buildFallbackRecipe(
              payload,
              `La API de Gemini ha devuelto un error: Gemini ${code}: ${msg || "sin detalle"}.`
            );
      return makeCardResponse(fb);
    }

    // ---------- PARSEO RESPUESTA DEL MODELO ----------
    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = robustParse(stripFences(rawText));

    if (!parsed || typeof parsed !== "object") {
      const fb =
        mode === "week"
          ? buildFallbackPlan(
              "La respuesta original del modelo no se ha podido convertir a un JSON válido."
            )
          : buildFallbackRecipe(
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
      meal_type: parsed.meal_type || payload.comida || "Comida",
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
        payload,
        "La respuesta de la IA no incluía suficientes ingredientes o pasos estructurados."
      );
      return makeCardResponse(fb);
    }

    return makeCardResponse(recipe);
  } catch (error) {
    const fb = buildFallbackPlan(
      `Se produjo una excepción interna en la función del servidor: ${
        error?.message || String(error)
      }.`
    );
    return makeCardResponse(fb);
  }
};
