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

  // ---------- RESPUESTA ESTÁNDAR TIPO "CARD" ----------
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
        "x-chefbot-func-version": "v2-chefbot-2025-11-18-retries",
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

  // ---------- PLAN / RECETA DE RESPALDO CON MENSAJE CLARO ----------
  const buildFallbackCard = (mode, payload, reason) => {
    const reasonMsg = reason
      ? `Detalle técnico (para ti, no para el usuario final): ${reason}`
      : "No hay más detalles técnicos disponibles.";

    if (mode === "week") {
      return {
        mode: "week",
        plan_name: "Plan de respaldo",
        days: [],
        shopping_list: [],
        general_tips: [
          "Chef-Bot no ha podido generar el plan semanal con la IA en este momento.",
          "Los servidores externos de IA (Gemini) están devolviendo errores o están saturados. No es un fallo de Chef-Bot, de tu configuración ni de tus datos. Prueba a generar el plan de nuevo en unos minutos.",
          reasonMsg,
        ],
        warnings: [],
      };
    }

    // Fallback de receta individual (por si en el futuro usas modo 'recipe')
    const ingText = (payload && payload.ingredientsText) || "";
    const items = ingText
      ? ingText
          .split(/[,\n]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : ["Ingredientes que ya tienes a mano"];

    return {
      mode: "recipe",
      recipe_name: "Receta de respaldo",
      prep_minutes: 0,
      cook_minutes: 0,
      difficulty: "Fácil",
      servings: (payload && payload.servings) || 1,
      meal_type: payload && payload.mealType ? payload.mealType : "",
      ingredients: items.map((name) => ({
        name,
        quantity_grams: null,
        notes: "",
      })),
      steps: [
        "Prepara una comida sencilla utilizando estos ingredientes de la forma que te resulte más cómoda.",
        "Cuando los servidores de la IA estén disponibles de nuevo, vuelve a intentar generar una receta con Chef-Bot.",
      ],
      meal_summary:
        "No he podido estructurar la respuesta de la IA, así que te propongo una receta muy básica basada en los ingredientes.",
      warnings: [
        "La generación automática de la receta con IA ha fallado por un problema externo (servidores de Gemini).",
        "No es un error de Chef-Bot ni de tu configuración. Intenta de nuevo más tarde.",
        reasonMsg,
      ],
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
    };
  };

  // --------------------------------------------------
  //  LÓGICA PRINCIPAL
  // --------------------------------------------------
  let mode = "recipe"; // por defecto, para poder usarlo en el catch

  try {
    // ---------- INPUT ----------
    const parsedBody = JSON.parse(event.body || "{}");
    mode = parsedBody.mode === "week" ? "week" : "recipe";

    const payload =
      typeof parsedBody.payload === "object" && parsedBody.payload !== null
        ? parsedBody.payload
        : {};

    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      const fb = buildFallbackCard(
        mode,
        payload,
        "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
      );
      return makeCardResponse(fb);
    }

    // Modelo Gemini (puedes sobreescribirlo con GEMINI_MODEL en Netlify si quieres)
    const MODEL =
      process.env.GEMINI_MODEL || "models/gemini-1.5-flash-latest";

    const API_URL = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // ---------- PROMPTS ----------
    const systemPrompt = `
Actúas como CHEF-BOT, un asistente de cocina en español especializado en dieta mediterránea y menús realistas.

Tu tarea es generar SIEMPRE una respuesta en formato JSON ESTRICTO, sin texto adicional, sin backticks y sin explicaciones fuera del JSON.

Hay dos modos:
1) "recipe"  -> una receta individual detallada.
2) "week"    -> un plan semanal (o de varios días) con comidas y platos realistas.

REGLAS GENERALES:
- Cocina basada en dieta mediterránea: platos sencillos, ingredientes habituales, combinaciones coherentes (nada de mezclas raras tipo "gambas con leche de almendras para merendar").
- Ajusta lo mejor posible los macros objetivo (proteínas, grasas, carbohidratos), pero en caso de duda prioriza que la receta sea realista y comestible.
- Respeta las restricciones dietéticas indicadas (alergias, intolerancias, vegano, vegetariano, sin gluten, etc.).
- Si se facilitan ingredientes de "nevera", intenta priorizarlos sin forzar combinaciones absurdas.

MODO "recipe":
- Devuelve un objeto JSON con:
  - mode: "recipe"
  - recipe_name: string
  - prep_minutes: number
  - cook_minutes: number
  - difficulty: string
  - servings: number
  - meal_type: string (por ejemplo "Desayuno", "Almuerzo", etc.)
  - ingredients: array de objetos { "name": string, "quantity_grams": number, "notes": string }
  - steps: array de strings con instrucciones claras y numeradas
  - meal_summary: resumen breve del plato
  - macro_estimate: { calories, protein_g, carbs_g, fat_g } (puedes estimar grosso modo; si no eres capaz, pon null)
  - warnings: lista de avisos opcionales

MODO "week":
- Devuelve un objeto JSON con:
  - mode: "week"
  - plan_name: string
  - days: array de objetos, cada uno:
      {
        "day_name": "Lunes" | "Martes" | ...,
        "meals": [
          {
            "meal_type": "Desayuno" | "Almuerzo" | "Cena" | "Merienda" | ...,
            "recipe_name": string,
            "short_description": string,
            "macro_estimate": { "calories": number | null, "protein_g": number | null, "carbs_g": number | null, "fat_g": number | null }
          }
        ]
      }
  - shopping_list: array de strings (lista de la compra agrupada por alimentos, no por gramos exactos)
  - general_tips: array de strings con recomendaciones generales de organización y cocina
  - warnings: array de strings con avisos (por ejemplo, sobre restricciones, variabilidad de macros, etc.)

REGLAS IMPORTANTES:
- NO añadas texto fuera del JSON.
- NO uses comentarios ni bloques \`\`\`.
- NO inventes endpoints, claves ni nada técnico; solo cocina y organización de comidas.
    `.trim();

    const userPrompt = `
MODO SOLICITADO: ${mode}

DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

Objetivo:
- Si el modo es "recipe", genera UNA RECETA CONCRETA en español, realista, basada en dieta mediterránea y alineada con las macros objetivo y restricciones.
- Si el modo es "week", genera un PLAN de varios días con comidas realistas, intentando respetar las macros objetivo totales por día y las restricciones. El número de días y comidas por día puede tomarse de los campos que te paso (por ejemplo, numDaysToPlan, numMeals) si están presentes.

Recuerda:
- Ajusta los macros lo mejor posible, pero prioriza platos normales que una persona realmente cocinaría y comería.
- Nada de combinaciones raras: piensa en sentido común gastronómico.
- Devuelve SOLO un JSON válido.
    `.trim();

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: mode === "week" ? 0.5 : 0.4,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
      },
    };

    // ---------- LLAMADA A GEMINI CON REINTENTOS ----------
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "7000", 10);
    const MAX_ATTEMPTS = 3;

    let result = null;
    let lastErrorMessage = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const json = await res.json().catch(() => ({}));

        if (res.ok) {
          result = json;
          break;
        }

        const code = json?.error?.code || res.status || 0;
        const msg = json?.error?.message || "";
        lastErrorMessage = `Gemini ${code}: ${msg || "error desconocido"}`;

        // Errores transitorios típicos: 503, 500, 429 -> reintentar
        if ((code === 503 || code === 500 || code === 429) && attempt < MAX_ATTEMPTS) {
          const delay = attempt * 400;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        } else {
          // Error no transitorio o último intento
          break;
        }
      } catch (err) {
        lastErrorMessage = err && err.message ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS) {
          const delay = attempt * 400;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
    }

    // Si después de los reintentos no tenemos resultado -> fallback
    if (!result) {
      const fb = buildFallbackCard(
        mode,
        payload,
        lastErrorMessage
          ? `La API de Gemini ha devuelto un error: ${lastErrorMessage}.`
          : "No ha sido posible contactar con la API de Gemini."
      );
      return makeCardResponse(fb);
    }

    // ---------- PARSEO DE LA RESPUESTA DEL MODELO ----------
    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = robustParse(stripFences(rawText));

    if (!parsed || typeof parsed !== "object") {
      const fb = buildFallbackCard(
        mode,
        payload,
        "La respuesta de la IA no se ha podido interpretar como JSON estructurado."
      );
      return makeCardResponse(fb);
    }

    // ---------- NORMALIZACIÓN SUAVE ----------
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

      if (!plan.days.length) {
        const fb = buildFallbackCard(
          mode,
          payload,
          "La IA no ha devuelto un plan estructurado completo (lista de días vacía)."
        );
        return makeCardResponse(fb);
      }

      return makeCardResponse(plan);
    }

    // MODO "recipe"
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
      meal_type: parsed.meal_type || payload.mealType || "",
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
      const fb = buildFallbackCard(
        mode,
        payload,
        "La respuesta de la IA no incluía ingredientes o pasos suficientes."
      );
      return makeCardResponse(fb);
    }

    return makeCardResponse(recipe);
  } catch (error) {
    const fb = buildFallbackCard(
      mode,
      null,
      `Se produjo una excepción interna en la función del servidor: ${
        error?.message || String(error)
      }.`
    );
    return makeCardResponse(fb);
  }
};
