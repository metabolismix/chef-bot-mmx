// netlify/functions/verifyMyth.js
// CHEF-BOT: generación de recetas y planes semanales con Gemini (stack tipo Mito-Bot)

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

  // ---------- FUNCIÓN AUXILIAR PARA RESPUESTA TIPO CHEF-BOT ----------
  const makeCardResponse = (card) => {
    const mode = card && card.mode === "recipe" ? "recipe" : "week";

    if (mode === "week") {
      const safe = {
        mode: "week",
        plan_name: card?.plan_name || "Plan semanal generado por Chef-Bot",
        days: Array.isArray(card?.days) ? card.days : [],
        shopping_list: Array.isArray(card?.shopping_list)
          ? card.shopping_list
          : [],
        general_tips: Array.isArray(card?.general_tips)
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
          "x-chefbot-func-version": "v1-chefbot-2025-11-18",
        },
        body: JSON.stringify(result),
      };
    }

    // Modo receta individual
    const macro =
      card && typeof card.macro_estimate === "object"
        ? card.macro_estimate
        : {};
    const safeRecipe = {
      mode: "recipe",
      recipe_name:
        card?.recipe_name ||
        card?.title ||
        "Receta generada por Chef-Bot",
      prep_minutes:
        Number.isFinite(card?.prep_minutes) && card.prep_minutes >= 0
          ? card.prep_minutes
          : 10,
      cook_minutes:
        Number.isFinite(card?.cook_minutes) && card.cook_minutes >= 0
          ? card.cook_minutes
          : 10,
      difficulty:
        typeof card?.difficulty === "string" && card.difficulty.trim()
          ? card.difficulty.trim()
          : "Fácil",
      servings:
        Number.isFinite(card?.servings) && card.servings > 0
          ? card.servings
          : 1,
      meal_type:
        typeof card?.meal_type === "string" && card.meal_type.trim()
          ? card.meal_type.trim()
          : "",
      ingredients: Array.isArray(card?.ingredients)
        ? card.ingredients
        : [],
      steps: Array.isArray(card?.steps) ? card.steps : [],
      meal_summary:
        typeof card?.meal_summary === "string"
          ? card.meal_summary
          : "",
      macro_estimate: {
        calories: Number.isFinite(macro.calories) ? macro.calories : null,
        protein_g: Number.isFinite(macro.protein_g) ? macro.protein_g : null,
        carbs_g: Number.isFinite(macro.carbs_g) ? macro.carbs_g : null,
        fat_g: Number.isFinite(macro.fat_g) ? macro.fat_g : null,
      },
      warnings: Array.isArray(card?.warnings) ? card.warnings : [],
    };

    const text = JSON.stringify(safeRecipe);
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
        "x-chefbot-func-version": "v1-chefbot-2025-11-18",
      },
      body: JSON.stringify(result),
    };
  };

  // ---------- PARSEO BODY ----------
  let parsedBody = {};
  try {
    parsedBody = JSON.parse(event.body || "{}");
  } catch {
    parsedBody = {};
  }

  const mode = parsedBody.mode === "recipe" ? "recipe" : "week";
  const payload =
    parsedBody && typeof parsedBody.payload === "object"
      ? parsedBody.payload
      : {};

  // ---------- CLAVE Y URL GEMINI (MISMO STACK QUE MITO-BOT) ----------
  const GEMINI_API_KEY =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_API_KEY_CHEFBOT;

  if (!GEMINI_API_KEY) {
    // Fallback si falta API key
    if (mode === "week") {
      return makeCardResponse({
        mode: "week",
        plan_name: "Plan no disponible (configuración servidor)",
        days: [],
        shopping_list: [],
        general_tips: [
          "Chef-Bot no está bien configurado en el servidor (falta la API key de Gemini).",
          "Configura GEMINI_API_KEY o GOOGLE_API_KEY en las variables de entorno de Netlify.",
        ],
      });
    }
    return makeCardResponse({
      mode: "recipe",
      recipe_name: "Receta no disponible (configuración servidor)",
      prep_minutes: 0,
      cook_minutes: 0,
      difficulty: "Fácil",
      servings: 1,
      meal_type: "",
      ingredients: [],
      steps: [],
      meal_summary:
        "Chef-Bot no está bien configurado en el servidor (falta la API key de Gemini).",
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
      warnings: [
        "Configura GEMINI_API_KEY o GOOGLE_API_KEY en las variables de entorno de Netlify.",
      ],
    });
  }

  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------- PROMPT DE SISTEMA (TEXTO) ----------
  const systemPrompt = `
Eres Chef-Bot, un asistente de nutrición que genera planes de comidas y recetas en castellano.

OBJETIVO GENERAL:
- A partir de los datos del usuario (objetivos de macros, restricciones dietéticas, ingredientes disponibles, tipo de comida, etc.), debes generar:
  - Modo "week": un PLAN SEMANAL completo, coherente y realista.
  - Modo "recipe": una RECETA individual detallada.

ESTILO Y FILOSOFÍA:
- Cocina mediterránea, casera, realista y de diario.
- Evita combinaciones raras o poco apetecibles (por ejemplo, atún con plátano y espinacas en el desayuno).
- Usa combinaciones que una persona realmente comería en un contexto europeo/mediterráneo.
- Respeta las restricciones dietéticas indicadas (vegano, vegetariano, sin lácteos, sin gluten, etc.).
- Respeta al máximo los objetivos de macros, pero siempre priorizando que las recetas y planes tengan sentido culinario y cultural.

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

ESTRUCTURAS JSON ESPERADAS:

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

  // ---------- RESPONSE SCHEMAS PARA v1beta ----------
  const responseSchemaWeek = {
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
                  recipe_name: { type: "string" },
                  prep_minutes: { type: "number" },
                  cook_minutes: { type: "number" },
                  difficulty: { type: "string" },
                  servings: { type: "number" },
                  meal_type: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        amount: { type: "string" },
                        unit: { type: "string" },
                        group: { type: "string" },
                      },
                      required: ["name"],
                    },
                  },
                  steps: { type: "array", items: { type: "string" } },
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
                required: ["recipe_name", "ingredients", "steps"],
              },
            },
          },
          required: ["day_name", "meals"],
        },
      },
      shopping_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            quantity: { type: "string" },
            category: { type: "string" },
          },
          required: ["name"],
        },
      },
      general_tips: { type: "array", items: { type: "string" } },
    },
    required: ["mode", "plan_name", "days"],
  };

  const responseSchemaRecipe = {
    type: "object",
    properties: {
      mode: { type: "string" },
      recipe_name: { type: "string" },
      prep_minutes: { type: "number" },
      cook_minutes: { type: "number" },
      difficulty: { type: "string" },
      servings: { type: "number" },
      meal_type: { type: "string" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            amount: { type: "string" },
            unit: { type: "string" },
            group: { type: "string" },
          },
          required: ["name"],
        },
      },
      steps: { type: "array", items: { type: "string" } },
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
    required: [
      "mode",
      "recipe_name",
      "ingredients",
      "steps",
      "macro_estimate",
    ],
  };

  const responseSchema =
    mode === "week" ? responseSchemaWeek : responseSchemaRecipe;

  // ---------- UTILIDAD: PARSEO ROBUSTO DEL TEXTO DEVUELTO ----------
  const stripFences = (t) => {
    let x = (t || "").trim();
    if (x.startsWith("```"))
      x = x
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/, "")
        .trim();
    return x.trim();
  };

  const robustParse = (text) => {
    // 1) parse directo
    try {
      return JSON.parse(text);
    } catch {}
    const t = text.trim();

    // 2) array raíz
    if (t.startsWith("[")) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr) && arr.length && typeof arr[0] === "object") {
          return arr[0];
        }
      } catch {}
    }

    // 3) buscar bloque { ... } balanceado
    const start = t.indexOf("{");
    if (start >= 0) {
      let depth = 0,
        inStr = false,
        esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
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

  const parseCandidateJSON = (text) => {
    const cleaned = stripFences(text || "");
    const parsed = robustParse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : null;
  };

  // ---------- CONSTRUCCIÓN DEL PROMPT DE USUARIO ----------
  const userPrompt =
    mode === "week"
      ? `
DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

TAREA:
Genera un plan semanal completo ("mode": "week") siguiendo estrictamente la estructura indicada en las instrucciones de sistema.
- Ajusta al máximo los macros diarios objetivo.
- Mantén recetas mediterráneas realistas y apetecibles (desayuno, comida, cena y snacks).
- Evita combinaciones raras o chocantes (por ejemplo, atún con plátano en el desayuno).
- Respeta las restricciones dietéticas y los ingredientes disponibles indicados.
    `.trim()
      : `
DATOS DEL USUARIO (JSON):
${JSON.stringify(payload, null, 2)}

TAREA:
Genera una receta individual ("mode": "recipe") siguiendo estrictamente la estructura indicada en las instrucciones de sistema.
- Ajusta la receta a los macros y restricciones del usuario.
- Usa ingredientes y pasos realistas, de dieta mediterránea.
    `.trim();

  const requestPayload = {
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    systemInstruction: {
      role: "user",
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: mode === "week" ? 0.55 : 0.4,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  // ---------- LLAMADA A GEMINI CON TIMEOUT + RETRIES (MISMOS PATRONES QUE MITO-BOT) ----------
  const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "8000", 10);
  const maxRetries = 2;
  let attempt = 0;

  try {
    let res;
    let result;

    while (true) {
      let timedOut = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);

      try {
        res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);

        if (timedOut) {
          // Timeout: devolvemos plan de respaldo
          const tips = [
            "Chef-Bot no ha podido generar el plan porque la petición ha tardado demasiado.",
            "Probablemente los servidores de IA tengan mucha carga en este momento. Prueba a generar el plan de nuevo en unos minutos.",
          ];
          if (mode === "week") {
            return makeCardResponse({
              mode: "week",
              plan_name: "Plan de respaldo - Timeout",
              days: [],
              shopping_list: [],
              general_tips: tips,
            });
          }
          return makeCardResponse({
            mode: "recipe",
            recipe_name: "Receta de respaldo - Timeout",
            prep_minutes: 0,
            cook_minutes: 0,
            difficulty: "Fácil",
            servings: 1,
            meal_type: "",
            ingredients: [],
            steps: [],
            meal_summary:
              "Chef-Bot no ha podido generar esta receta porque la petición ha tardado demasiado.",
            macro_estimate: {
              calories: null,
              protein_g: null,
              carbs_g: null,
              fat_g: null,
            },
            warnings: tips,
          });
        }

        // Otros errores de red
        const tips = [
          "Chef-Bot no ha podido contactar con el servicio de IA.",
          "Puede ser un problema puntual de conexión. Prueba de nuevo en unos minutos.",
        ];
        if (mode === "week") {
          return makeCardResponse({
            mode: "week",
            plan_name: "Plan de respaldo - Conectividad",
            days: [],
            shopping_list: [],
            general_tips: tips,
          });
        }
        return makeCardResponse({
          mode: "recipe",
          recipe_name: "Receta de respaldo - Conectividad",
          prep_minutes: 0,
          cook_minutes: 0,
          difficulty: "Fácil",
          servings: 1,
          meal_type: "",
          ingredients: [],
          steps: [],
          meal_summary:
            "Chef-Bot no ha podido contactar con el servicio de IA.",
          macro_estimate: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
          },
          warnings: tips,
        });
      }

      clearTimeout(timeoutId);
      result = await res.json().catch(() => ({}));

      if (res.ok) {
        break; // éxito -> salimos del bucle
      }

      const msg = result?.error?.message || "";
      const code = result?.error?.code || res.status || 0;

      const isOverloaded =
        res.status === 503 ||
        res.status === 504 ||
        /model is overloaded/i.test(msg) ||
        /overloaded/i.test(msg) ||
        /deadline exceeded/i.test(msg) ||
        /timeout/i.test(msg);

      const isAuth =
        res.status === 401 ||
        res.status === 403 ||
        /api key/i.test(msg) ||
        /unauthorized/i.test(msg) ||
        /permission/i.test(msg);

      const isPolicy =
        res.status === 400 ||
        res.status === 403 ||
        /safety/i.test(msg) ||
        /policy/i.test(msg) ||
        /blocked/i.test(msg);

      // Si está sobrecargado y quedan reintentos -> backoff
      if (isOverloaded && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }

      // Saturación tras reintentos -> plan de respaldo
      if (isOverloaded) {
        const tips = [
          "Chef-Bot no ha podido generar el plan semanal con la IA en este momento.",
          "Los servidores externos de IA (Gemini) están saturados o devolviendo errores. No es un fallo de Chef-Bot ni de tu configuración.",
          "Prueba a generar el plan de nuevo en unos minutos.",
        ];
        if (mode === "week") {
          return makeCardResponse({
            mode: "week",
            plan_name: "Plan de respaldo - Saturación",
            days: [],
            shopping_list: [],
            general_tips: tips,
          });
        }
        return makeCardResponse({
          mode: "recipe",
          recipe_name: "Receta de respaldo - Saturación",
          prep_minutes: 0,
          cook_minutes: 0,
          difficulty: "Fácil",
          servings: 1,
          meal_type: "",
          ingredients: [],
          steps: [],
          meal_summary:
            "Chef-Bot no ha podido generar esta receta porque los servidores de IA están saturados.",
          macro_estimate: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
          },
          warnings: tips,
        });
      }

      // Errores de credenciales
      if (isAuth) {
        const tips = [
          "Ahora mismo Chef-Bot no tiene permisos correctos para acceder al modelo de IA.",
          "Revisa la clave de API y los permisos del proyecto Gemini.",
        ];
        if (mode === "week") {
          return makeCardResponse({
            mode: "week",
            plan_name: "Plan de respaldo - Credenciales",
            days: [],
            shopping_list: [],
            general_tips: tips,
          });
        }
        return makeCardResponse({
          mode: "recipe",
          recipe_name: "Receta de respaldo - Credenciales",
          prep_minutes: 0,
          cook_minutes: 0,
          difficulty: "Fácil",
          servings: 1,
          meal_type: "",
          ingredients: [],
          steps: [],
          meal_summary:
            "Chef-Bot no puede usar el modelo de IA por un problema de credenciales.",
          macro_estimate: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
          },
          warnings: tips,
        });
      }

      // Errores de políticas / safety
      if (isPolicy) {
        const tips = [
          "La petición ha sido bloqueada por las políticas de seguridad o contenido de la API.",
          `Código: ${code}. Mensaje: ${msg || "sin detalle específico"}.`,
        ];
        if (mode === "week") {
          return makeCardResponse({
            mode: "week",
            plan_name: "Plan de respaldo - Políticas",
            days: [],
            shopping_list: [],
            general_tips: tips,
          });
        }
        return makeCardResponse({
          mode: "recipe",
          recipe_name: "Receta de respaldo - Políticas",
          prep_minutes: 0,
          cook_minutes: 0,
          difficulty: "Fácil",
          servings: 1,
          meal_type: "",
          ingredients: [],
          steps: [],
          meal_summary:
            "La petición ha sido bloqueada por las políticas de seguridad o contenido de la API.",
          macro_estimate: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
          },
          warnings: tips,
        });
      }

      // Otros errores de servicio
      const tips = [
        "Ha ocurrido un problema inesperado al consultar el modelo de IA.",
        `Código: ${code}. Mensaje: ${msg || "sin detalle específico"}.`,
      ];
      if (mode === "week") {
        return makeCardResponse({
          mode: "week",
          plan_name: "Plan de respaldo - Error de servicio",
          days: [],
          shopping_list: [],
          general_tips: tips,
        });
      }
      return makeCardResponse({
        mode: "recipe",
        recipe_name: "Receta de respaldo - Error de servicio",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: 1,
        meal_type: "",
        ingredients: [],
        steps: [],
        meal_summary:
          "Ha ocurrido un problema inesperado al consultar el modelo de IA.",
        macro_estimate: {
          calories: null,
          protein_g: null,
          carbs_g: null,
          fat_g: null,
        },
        warnings: tips,
      });
    }

    // ---------- ÉXITO: PARSEAR Y NORMALIZAR ----------
    if (!result?.candidates?.length) {
      const tips = [
        "La API no ha devuelto candidatos (0 resultados).",
        "Puede deberse a un bloqueo de políticas o a un problema interno.",
      ];
      if (mode === "week") {
        return makeCardResponse({
          mode: "week",
          plan_name: "Plan de respaldo - Sin candidatos",
          days: [],
          shopping_list: [],
          general_tips: tips,
        });
      }
      return makeCardResponse({
        mode: "recipe",
        recipe_name: "Receta de respaldo - Sin candidatos",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: 1,
        meal_type: "",
        ingredients: [],
        steps: [],
        meal_summary:
          "La API no ha devuelto candidatos. No se ha podido generar la receta.",
        macro_estimate: {
          calories: null,
          protein_g: null,
          carbs_g: null,
          fat_g: null,
        },
        warnings: tips,
      });
    }

    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = parseCandidateJSON(rawText);

    if (!parsed) {
      const tips = [
        "La IA ha respondido en un formato que no se puede interpretar como JSON.",
        "Prueba a ajustar ligeramente los parámetros o vuelve a intentarlo en unos minutos.",
      ];
      if (mode === "week") {
        return makeCardResponse({
          mode: "week",
          plan_name: "Plan de respaldo - Formato no válido",
          days: [],
          shopping_list: [],
          general_tips: tips,
        });
      }
      return makeCardResponse({
        mode: "recipe",
        recipe_name: "Receta de respaldo - Formato no válido",
        prep_minutes: 0,
        cook_minutes: 0,
        difficulty: "Fácil",
        servings: 1,
        meal_type: "",
        ingredients: [],
        steps: [],
        meal_summary:
          "La IA ha respondido en un formato que no se puede interpretar como JSON.",
        macro_estimate: {
          calories: null,
          protein_g: null,
          carbs_g: null,
          fat_g: null,
        },
        warnings: tips,
      });
    }

    // Si todo ha ido bien, devolvemos el objeto tal cual (normalizado mínimamente)
    if (mode === "week") {
      const normalized = {
        mode: "week",
        plan_name:
          typeof parsed.plan_name === "string" && parsed.plan_name.trim()
            ? parsed.plan_name.trim()
            : "Plan semanal generado por Chef-Bot",
        days: Array.isArray(parsed.days) ? parsed.days : [],
        shopping_list: Array.isArray(parsed.shopping_list)
          ? parsed.shopping_list
          : [],
        general_tips: Array.isArray(parsed.general_tips)
          ? parsed.general_tips
          : [],
      };
      return makeCardResponse(normalized);
    }

    const normalizedRecipe = {
      mode: "recipe",
      recipe_name:
        typeof parsed.recipe_name === "string" && parsed.recipe_name.trim()
          ? parsed.recipe_name.trim()
          : "Receta generada por Chef-Bot",
      prep_minutes:
        Number.isFinite(parsed.prep_minutes) && parsed.prep_minutes >= 0
          ? parsed.prep_minutes
          : 10,
      cook_minutes:
        Number.isFinite(parsed.cook_minutes) && parsed.cook_minutes >= 0
          ? parsed.cook_minutes
          : 10,
      difficulty:
        typeof parsed.difficulty === "string" && parsed.difficulty.trim()
          ? parsed.difficulty.trim()
          : "Fácil",
      servings:
        Number.isFinite(parsed.servings) && parsed.servings > 0
          ? parsed.servings
          : 1,
      meal_type:
        typeof parsed.meal_type === "string" && parsed.meal_type.trim()
          ? parsed.meal_type.trim()
          : "",
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients
        : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      meal_summary:
        typeof parsed.meal_summary === "string"
          ? parsed.meal_summary
          : "",
      macro_estimate:
        typeof parsed.macro_estimate === "object"
          ? parsed.macro_estimate
          : {
              calories: null,
              protein_g: null,
              carbs_g: null,
              fat_g: null,
            },
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };

    return makeCardResponse(normalizedRecipe);
  } catch (error) {
    // Cualquier excepción inesperada
    const tips = [
      "Ha ocurrido un problema interno en Chef-Bot al procesar la petición.",
      "Si el error se repite, revisa la configuración del servidor o vuelve a intentarlo más adelante.",
    ];
    if (mode === "week") {
      return makeCardResponse({
        mode: "week",
        plan_name: "Plan de respaldo - Error interno",
        days: [],
        shopping_list: [],
        general_tips: tips,
      });
    }
    return makeCardResponse({
      mode: "recipe",
      recipe_name: "Receta de respaldo - Error interno",
      prep_minutes: 0,
      cook_minutes: 0,
      difficulty: "Fácil",
      servings: 1,
      meal_type: "",
      ingredients: [],
      steps: [],
      meal_summary:
        "Ha ocurrido un problema interno en Chef-Bot al procesar la petición.",
      macro_estimate: {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
      warnings: tips,
    });
  }
};
