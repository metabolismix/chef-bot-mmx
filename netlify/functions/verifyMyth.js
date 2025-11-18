// netlify/functions/verifyMyth.js
// Función Netlify para CHEF-BOT: genera plan semanal (mode:"week") o receta individual (mode:"recipe") usando Gemini

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
    return jsonResponse(
      405,
      { error: "Method Not Allowed. Use POST." },
      cors
    );
  }

  // ---------- PARSEO DEL BODY ----------
  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || "{}");
  } catch (err) {
    return jsonResponse(
      400,
      { error: "Body must be valid JSON." },
      cors
    );
  }

  const mode = parsedBody.mode === "recipe" ? "recipe" : "week";
  const payload =
    typeof parsedBody.payload === "object" && parsedBody.payload !== null
      ? parsedBody.payload
      : {};

  const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GEMINI_API_KEY) {
    const fallback =
      mode === "week"
        ? buildFallbackWeek(
            payload,
            "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
          )
        : buildFallbackRecipe(
            payload,
            "Falta GOOGLE_API_KEY en las variables de entorno del servidor."
          );
    return jsonResponse(200, fallback, cors);
  }

  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------- PROMPT A GEMINI ----------
  const systemAndTaskPrompt = buildPrompt(mode, payload);

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemAndTaskPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 2048,
    },
  };

  // ---------- LLAMADA A GEMINI CON TIMEOUT ----------
  const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "8000", 10);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let result;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result?.error?.message || "";
      const code = result?.error?.code || res.status || 0;
      const fallback =
        mode === "week"
          ? buildFallbackWeek(
              payload,
              `La API de Gemini ha devuelto un error (código ${code}): ${
                msg || "sin detalle"
              }.`
            )
          : buildFallbackRecipe(
              payload,
              `La API de Gemini ha devuelto un error (código ${code}): ${
                msg || "sin detalle"
              }.`
            );
      return jsonResponse(200, fallback, cors);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const fallback =
      mode === "week"
        ? buildFallbackWeek(
            payload,
            "La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo configurado."
          )
        : buildFallbackRecipe(
            payload,
            "La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo configurado."
          );
    return jsonResponse(200, fallback, cors);
  }

  // ---------- PARSEO ROBUSTO DE LA RESPUESTA ----------
  const rawText =
    result?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const parsed = robustParse(stripFences(rawText));

  if (!parsed || typeof parsed !== "object") {
    const fallback =
      mode === "week"
        ? buildFallbackWeek(
            payload,
            "La respuesta original del modelo no se ha podido convertir a un JSON válido."
          )
        : buildFallbackRecipe(
            payload,
            "La respuesta original del modelo no se ha podido convertir a un JSON válido."
          );
    return jsonResponse(200, fallback, cors);
  }

  // ---------- NORMALIZACIÓN SUAVE ----------
  let safe;
  if (mode === "week") {
    safe = normalizeWeekPlan(parsed, payload);
  } else {
    safe = normalizeRecipe(parsed, payload);
  }

  return jsonResponse(200, safe, cors);
};

// ---------- UTILIDADES GENERALES ----------

function jsonResponse(statusCode, obj, cors) {
  return {
    statusCode,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "x-chefbot-func-version": "v3-chefbot-2025-11-17",
    },
    body: JSON.stringify(obj),
  };
}

function stripFences(t) {
  if (!t || typeof t !== "string") return "";
  let x = t.trim();
  if (x.startsWith("```")) {
    x = x.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  }
  return x.trim();
}

function robustParse(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  // 1) intento directo
  try {
    return JSON.parse(t);
  } catch {}

  // 2) si empieza por [ ... ], probar array
  if (t.startsWith("[")) {
    try {
      const a = JSON.parse(t);
      if (Array.isArray(a) && a.length && typeof a[0] === "object") {
        return a[0];
      }
    } catch {}
  }

  // 3) buscar primer bloque { ... } balanceado
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
}

// ---------- PROMPT ----------

function buildPrompt(mode, payload) {
  const daily = payload.dailyMacros || {};
  const numMeals = payload.numMeals || 4;
  const numDays = payload.numDays || 7;
  const dietaryFilter = (payload.dietaryFilter || "").trim();
  const fridge = (payload.fridgeIngredients || "").trim();
  const style = (payload.style || "mediterranea").trim();

  const macrosText = `
Objetivos diarios aproximados del usuario (si faltan valores, puedes estimar):
- Proteína (g/día): ${daily.protein_g || "desconocido"}
- Grasas (g/día): ${daily.fat_g || "desconocido"}
- Carbohidratos (g/día): ${daily.carbs_g || "desconocido"}
`;

  const restrictionsText = dietaryFilter
    ? `Restricciones dietéticas indicadas (texto libre del usuario): "${dietaryFilter}". Respétalas estrictamente.`
    : `No se han indicado restricciones dietéticas específicas. Usa sentido común, pero asume tolerancia estándar.`;

  const fridgeText = fridge
    ? `Ingredientes disponibles en nevera/despensa (priorízalos cuando tenga sentido, pero no los fuerces si no encajan): "${fridge}".`
    : `No se han indicado ingredientes concretos en la nevera.`;

  const styleText = `
Estilo de cocina deseado: "${style}".
En la práctica, interpreta esto como:
- Cocina tipo dieta mediterránea, propia de España.
- Platos sencillos, realistas y fáciles de preparar.
- Evita combinaciones raras o culturalmente extrañas (no mezcles, por ejemplo, atún con plátano, pescado con leche vegetal sin sentido, marisco con zumos dulces, etc.).
`;

  const commonRules = `
REGLAS GENERALES IMPORTANTES (CUMPLE SIEMPRE):
- Responde SIEMPRE en **español**.
- Responde **ÚNICAMENTE** con UN OBJETO JSON VÁLIDO. Nada de texto fuera del JSON, sin comentarios, sin explicaciones adicionales, sin backticks.
- Usa ingredientes sencillos y habituales en un supermercado español.
- Ajusta los macros de cada comida lo mejor posible a los objetivos diarios, repartidos de forma razonable entre las comidas. Se permite un margen aproximado de ±10–15 %.
- Evita hacer recomendaciones médicas. Solo hablas de cocina, organización de comidas y pautas culinarias generales.
- Intenta que cada receta tenga:
  - Un nombre claro.
  - Una breve descripción.
  - Lista de ingredientes con cantidades en gramos.
  - Varios pasos de elaboración detallados y concretos (no pongas un único paso genérico).
`;

  const weekInstructions = `
MODO: "week"

Tu tarea:
- Generar un **plan semanal** con esta estructura JSON:

{
  "mode": "week",
  "plan_name": "Plan semanal mediterráneo (o similar)",
  "days": [
    {
      "day_name": "Lunes",
      "total_macros": {
        "protein_g": 180,
        "fat_g": 80,
        "carbs_g": 250
      },
      "meals": [
        {
          "meal_type": "Desayuno",
          "recipe_name": "Tostadas integrales con aguacate y huevo",
          "short_description": "Desayuno rico en proteína y grasas saludables.",
          "macros": {
            "protein_g": 30,
            "fat_g": 20,
            "carbs_g": 40
          },
          "ingredients": [
            {
              "name": "pan integral",
              "quantity_grams": 60,
              "notes": ""
            },
            {
              "name": "aguacate",
              "quantity_grams": 50,
              "notes": ""
            },
            {
              "name": "huevo",
              "quantity_grams": 100,
              "notes": ""
            }
          ],
          "steps": [
            "Tuesta el pan integral.",
            "Aplasta el aguacate y repártelo sobre las tostadas.",
            "Cocina el huevo a la plancha o escalfado y colócalo encima del pan con aguacate.",
            "Añade una pizca de sal y pimienta al gusto."
          ]
        }
      ]
    }
  ],
  "shopping_list": [
    "pan integral",
    "avena",
    "huevos",
    "pechuga de pollo",
    "arroz integral",
    "verduras variadas",
    "fruta fresca"
  ],
  "general_tips": [
    "Bebe agua a lo largo del día.",
    "Intenta mantener horarios regulares de comida.",
    "Ajusta ligeramente las raciones según tu sensación de hambre y saciedad."
  ]
}

- "days" debe contener exactamente ${numDays} días.
- Cada día debe tener ${numMeals} comidas (por ejemplo: Desayuno, Media mañana, Almuerzo, Merienda, Cena, etc.; adapta los nombres a un patrón razonable si el número de comidas es diferente).
- Usa nombres de comidas y platos que suenen naturales en España.
- Ajusta los macros de cada comida para aproximar los objetivos diarios dentro de un margen razonable.
`;

  const recipeInstructions = `
MODO: "recipe"

Tu tarea:
- Generar una **receta individual detallada** con esta estructura JSON:

{
  "mode": "recipe",
  "recipe_name": "Nombre claro de la receta",
  "meal_type": "Desayuno | Almuerzo | Cena | etc.",
  "short_description": "Una frase que resuma el plato.",
  "macros": {
    "protein_g": 30,
    "fat_g": 20,
    "carbs_g": 40
  },
  "ingredients": [
    {
      "name": "alimento",
      "quantity_grams": 80,
      "notes": ""
    }
  ],
  "steps": [
    "Paso 1 detallado...",
    "Paso 2 detallado...",
    "Paso 3 detallado..."
  ]
}

- La receta debe ser coherente con una comida del día (por ejemplo desayuno, comida o cena) y con la dieta mediterránea.
- Ajusta los macros de la receta a los objetivos por comida que se hayan indicado o que estimes razonables.
`;

  const payloadText = `
DATOS DEL USUARIO (PAYLOAD JSON):
${JSON.stringify(payload, null, 2)}
`;

  const modeSpecific =
    mode === "week" ? weekInstructions : recipeInstructions;

  return `
Actúas como CHEF-BOT, un asistente de cocina en español especializado en planificación de menús y recetas coherentes con la dieta mediterránea.

${macrosText}
Número de días a planificar (si aplica): ${numDays}
Número de comidas por día (si aplica): ${numMeals}

${restrictionsText}

${fridgeText}

${styleText}

${commonRules}

${modeSpecific}

${payloadText}

Recuerda: la salida debe ser ÚNICAMENTE un objeto JSON válido siguiendo la estructura descrita para el modo "${mode}". No añadas explicaciones fuera del JSON.
  `.trim();
}

// ---------- NORMALIZACIÓN Y FALLBACKS ----------

function normalizeWeekPlan(obj, payload) {
  const numDays = payload.numDays || 7;
  const days = Array.isArray(obj.days) ? obj.days : [];
  const safeDays = days.slice(0, numDays).map((d, idx) => {
    const meals = Array.isArray(d.meals) ? d.meals : [];
    return {
      day_name: typeof d.day_name === "string" && d.day_name.trim()
        ? d.day_name.trim()
        : `Día ${idx + 1}`,
      total_macros: normalizeMacros(d.total_macros),
      meals: meals.map(normalizeMeal),
    };
  });

  return {
    mode: "week",
    plan_name:
      typeof obj.plan_name === "string" && obj.plan_name.trim()
        ? obj.plan_name.trim()
        : "Plan semanal sugerido por Chef-Bot",
    days: safeDays,
    shopping_list: Array.isArray(obj.shopping_list)
      ? obj.shopping_list.map((x) => String(x))
      : [],
    general_tips: Array.isArray(obj.general_tips)
      ? obj.general_tips.map((x) => String(x))
      : [],
  };
}

function normalizeRecipe(obj, payload) {
  return {
    mode: "recipe",
    recipe_name:
      typeof obj.recipe_name === "string" && obj.recipe_name.trim()
        ? obj.recipe_name.trim()
        : "Receta sugerida por Chef-Bot",
    meal_type:
      typeof obj.meal_type === "string" && obj.meal_type.trim()
        ? obj.meal_type.trim()
        : (payload.meal_type || "Comida"),
    short_description:
      typeof obj.short_description === "string"
        ? obj.short_description.trim()
        : "",
    macros: normalizeMacros(obj.macros),
    ingredients: Array.isArray(obj.ingredients)
      ? obj.ingredients.map((ing) => ({
          name: String(ing.name || "").trim(),
          quantity_grams: isFiniteNumber(ing.quantity_grams)
            ? Number(ing.quantity_grams)
            : null,
          notes:
            typeof ing.notes === "string" ? ing.notes.trim() : "",
        }))
      : [],
    steps: Array.isArray(obj.steps)
      ? obj.steps.map((s) => String(s).trim()).filter(Boolean)
      : [],
  };
}

function normalizeMeal(meal) {
  return {
    meal_type:
      typeof meal.meal_type === "string" && meal.meal_type.trim()
        ? meal.meal_type.trim()
        : "Comida",
    recipe_name:
      typeof meal.recipe_name === "string" && meal.recipe_name.trim()
        ? meal.recipe_name.trim()
        : "Plato sugerido por Chef-Bot",
    short_description:
      typeof meal.short_description === "string"
        ? meal.short_description.trim()
        : "",
    macros: normalizeMacros(meal.macros),
    ingredients: Array.isArray(meal.ingredients)
      ? meal.ingredients.map((ing) => ({
          name: String(ing.name || "").trim(),
          quantity_grams: isFiniteNumber(ing.quantity_grams)
            ? Number(ing.quantity_grams)
            : null,
          notes:
            typeof ing.notes === "string" ? ing.notes.trim() : "",
        }))
      : [],
    steps: Array.isArray(meal.steps)
      ? meal.steps.map((s) => String(s).trim()).filter(Boolean)
      : [],
  };
}

function normalizeMacros(m) {
  if (!m || typeof m !== "object") {
    return {
      protein_g: null,
      fat_g: null,
      carbs_g: null,
    };
  }
  return {
    protein_g: isFiniteNumber(m.protein_g)
      ? Number(m.protein_g)
      : null,
    fat_g: isFiniteNumber(m.fat_g)
      ? Number(m.fat_g)
      : null,
    carbs_g: isFiniteNumber(m.carbs_g)
      ? Number(m.carbs_g)
      : null,
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildFallbackWeek(payload, reason) {
  const daily = payload.dailyMacros || {};
  const numDays = payload.numDays || 7;
  return {
    mode: "week",
    plan_name: "Plan semanal simplificado (fallback)",
    days: Array.from({ length: numDays }).map((_, idx) => ({
      day_name: `Día ${idx + 1}`,
      total_macros: normalizeMacros(daily),
      meals: [],
    })),
    shopping_list: [],
    general_tips: [
      "No he podido estructurar correctamente el plan semanal a partir de la respuesta de la IA.",
      reason ||
        "Se ha generado un plan de respaldo mínimo para no interrumpir la experiencia de uso.",
    ],
  };
}

function buildFallbackRecipe(payload, reason) {
  return {
    mode: "recipe",
    recipe_name: "Receta simplificada (fallback)",
    meal_type: payload.meal_type || "Comida",
    short_description:
      "No he podido generar una receta detallada con la IA. Te propongo una receta simplificada.",
    macros: normalizeMacros(payload.target_macros || {}),
    ingredients: [],
    steps: [
      "Prepara una comida sencilla usando ingredientes habituales que encajen con tus restricciones dietéticas.",
      "Cuando la configuración de la IA esté corregida, vuelve a intentar generar una receta con Chef-Bot.",
    ],
  };
}
