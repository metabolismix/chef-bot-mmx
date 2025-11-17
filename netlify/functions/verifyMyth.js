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
  const makeCardResponse = (card, extraHeaders = {}) => {
    const safe = {
      // modo: "recipe" | "week"
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
        "x-chefbot-func-version": "v1-chefbot-2025-11-17",
        ...extraHeaders,
      },
      body: JSON.stringify(result),
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

    // payload mínimo para no devolver recetas "a ciegas"
    const baseText = (payload.ingredientsText || payload.notes || "").trim();
    if (!baseText && mode === "recipe") {
      return {
        statusCode: 400,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            'Faltan datos mínimos para generar la receta. Añade al menos algunos ingredientes en "Ingredientes disponibles".',
        }),
      };
    }

    // ---------- API KEY ----------
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      // Mensaje amable si la clave no está configurada en Netlify
      return makeCardResponse({
        mode,
        recipe_name: "Receta simplificada",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: payload.servings || 1,
        ingredients: [
          {
            name: "Ingredientes introducidos por el usuario",
            quantity_grams: null,
            notes: "No se ha configurado GOOGLE_API_KEY en el servidor.",
          },
        ],
        steps: [
          "Añade la variable de entorno GOOGLE_API_KEY en la configuración de Netlify.",
          "Vuelve a desplegar el proyecto y prueba de nuevo a generar la receta.",
        ],
        warnings: [
          "Falta GOOGLE_API_KEY en las variables de entorno del servidor.",
          "Es necesario configurar la clave de la API de Gemini antes de poder usar el modelo.",
        ],
      });
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Actúas como CHEF-BOT, un asistente de cocina en español.

Tu tarea es generar SIEMPRE una respuesta en formato JSON ESTRICTO, sin texto adicional, sin backticks y sin explicaciones fuera del JSON.

Hay dos modos:
1) "recipe"  -> una receta individual detallada.
2) "week"    -> un plan semanal simple.

Respeta SIEMPRE el esquema JSON que se define por la propiedad "responseSchema" de la llamada. No inventes campos nuevos.

REGLAS IMPORTANTES:
- No añadas texto fuera del JSON.
- No uses comentarios, ni \`//\`, ni bloques tipo \`\`\`json.
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
      },
      required: ["mode", "recipe_name", "prep_minutes", "cook_minutes", "difficulty", "ingredients", "steps"],
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
      },
      required: ["mode", "plan_name", "days"],
    };

    const responseSchema = mode === "week" ? weekSchema : recipeSchema;

    // Texto que verá el modelo con los datos reales
    const userPrompt = `
MODO: ${mode}

DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

Objetivo:
- Si el modo es "recipe", genera una RECETA CONCRETA en español, sencilla y realista, respetando en lo posible sus preferencias, restricciones y macros objetivo.
- Si el modo es "week", genera un PLAN SEMANAL resumen con varios platos por día (no hace falta dar el paso a paso completo, solo títulos y descripciones breves).

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

    // ---------- LLAMADA A GEMINI (SENCILLA, CON TIMEOUT) ----------
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "8000", 10);

    let result;
    let res;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Error de red o timeout: devolvemos receta/plán simplificado
      if (mode === "week") {
        return makeCardResponse({
          mode: "week",
          plan_name: "Plan semanal simplificado",
          days: [],
          shopping_list: [],
          general_tips: [
            "Ha habido un problema de conexión con el servicio de IA.",
            "Organiza la semana reutilizando tus recetas habituales y vuelve a intentarlo más tarde.",
          ],
          warnings: [
            "La llamada a la API de Gemini ha fallado o ha excedido el tiempo máximo.",
          ],
        });
      }

      return makeCardResponse({
        mode: "recipe",
        recipe_name: "Receta simplificada",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: payload.servings || 1,
        ingredients: [
          {
            name: "Ingredientes que ya tienes a mano",
            quantity_grams: null,
            notes:
              "La respuesta original no se ha podido obtener por un problema de conexión.",
          },
        ],
        steps: [
          "Prepara una comida sencilla utilizando los ingredientes que ya tienes disponibles.",
          "Cuando la conexión con el servicio de IA funcione correctamente, vuelve a intentar generar una receta con Chef-Bot.",
        ],
        warnings: [
          "Ha habido un problema de conexión con el servicio de IA.",
        ],
      });
    } finally {
      clearTimeout(timeoutId);
    }

    result = await res.json().catch(() => ({}));

    // Si la API responde con error HTTP, generamos fallback amable
    if (!res.ok) {
      const msg = result?.error?.message || "";
      const code = result?.error?.code || res.status || 0;

      if (mode === "week") {
        return makeCardResponse({
          mode: "week",
          plan_name: "Plan semanal simplificado",
          days: [],
          shopping_list: [],
          general_tips: [
            "La API de Gemini ha devuelto un error.",
            `Código: ${code}. Mensaje: ${msg || "sin detalle"}.`,
            "Puedes organizar tus comidas semanalmente usando tus propias recetas mientras tanto.",
          ],
          warnings: [
            "La respuesta del modelo no se ha podido usar para un plan semanal completo.",
          ],
        });
      }

      return makeCardResponse({
        mode: "recipe",
        recipe_name: "Receta simplificada",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: payload.servings || 1,
        ingredients: [
          {
            name: "Ingredientes que ya tienes a mano",
            quantity_grams: null,
            notes:
              "La API de Gemini ha devuelto un error y no se ha podido generar la receta original.",
          },
        ],
        steps: [
          "Prepara una comida sencilla reutilizando tus ingredientes principales (por ejemplo, saltear proteína con verduras y acompañar con una fuente de hidratos).",
          "Cuando el error de la API esté resuelto, vuelve a intentar generar una receta completa con Chef-Bot.",
        ],
        warnings: [
          `Error devuelto por la API de Gemini (status ${code}): ${msg || "sin detalle"}.`,
        ],
      });
    }

    // Si todo va bien, la propia API ya respeta el esquema y devuelve JSON
    // Lo envolvemos en el formato "candidates" que espera el front-end,
    // pero sin tocar el texto (para no introducir errores de parseo).
    //
    // generateContent con responseMimeType="application/json" devuelve
    // el JSON directamente en parts[0].text.
    const text =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      JSON.stringify(
        mode === "week"
          ? {
              mode: "week",
              plan_name: "Plan semanal simplificado",
              days: [],
              shopping_list: [],
              general_tips: [],
            }
          : {
              mode: "recipe",
              recipe_name: "Receta simplificada",
              prep_minutes: 0,
              cook_minutes: 0,
              difficulty: "Fácil",
              ingredients: [],
              steps: [],
            }
      );

    return {
      statusCode: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "x-chefbot-func-version": "v1-chefbot-2025-11-17",
      },
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text }],
            },
          },
        ],
      }),
    };
  } catch (error) {
    // ---------- EXCEPCIÓN INTERNA NO ESPERADA ----------
    return makeCardResponse({
      mode: "recipe",
      recipe_name: "Receta simplificada",
      prep_minutes: 0,
      cook_minutes: 0,
      difficulty: "Fácil",
      servings: (parsedBody && parsedBody.payload && parsedBody.payload.servings) || 1,
      ingredients: [
        {
          name: "Ingredientes que ya tienes a mano",
          quantity_grams: null,
          notes:
            "Ha ocurrido un problema interno en la función del servidor y no se ha podido obtener la receta original.",
        },
      ],
      steps: [
        "Prepara una comida sencilla utilizando los ingredientes que ya tienes disponibles.",
        "Cuando el problema esté solucionado, vuelve a intentar generar una receta con Chef-Bot.",
      ],
      warnings: [
        `Excepción interna en la función del servidor: ${
          error?.message || String(error)
        }`,
      ],
    });
  }
};
