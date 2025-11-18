// netlify/functions/verifyMyth.js
exports.handler = async function (event, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // ---------- CORS / MÉTODO ----------
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  // ---------- UTILIDADES COMUNES ----------
  const urlLike = /(https?:\/\/|www\.)[^\s)]+/gi;
  const stripUrls = (s) =>
    typeof s === 'string'
      ? s.replace(urlLike, '').replace(/\(\s*\)/g, '').trim()
      : s;

  const stripFences = (t) => {
    let x = (t || '').trim();
    if (x.startsWith('```')) {
      x = x.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    }
    return x.trim();
  };

  const robustParse = (text) => {
    if (!text || typeof text !== 'string') return null;
    const t = text.trim();

    // 1) Intento directo
    try {
      return JSON.parse(t);
    } catch {}

    // 2) Si es array en raíz, coger el primer objeto
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object') {
          return arr[0];
        }
      } catch {}
    }

    // 3) Extraer bloque { ... } balanceado
    const start = t.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) {
            esc = false;
          } else if (ch === '\\') {
            esc = true;
          } else if (ch === '"') {
            inStr = false;
          }
        } else {
          if (ch === '"') inStr = true;
          else if (ch === '{') depth++;
          else if (ch === '}') {
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

  // ---------- FABRICAR RESPUESTA ESTÁNDAR (SOBRE GEMINI) ----------
  const makePlanResponse = (plan) => {
    const safePlan = {
      mode: typeof plan.mode === 'string' ? plan.mode : 'week',
      plan_name: typeof plan.plan_name === 'string' ? plan.plan_name : 'Plan diario Chef-Bot',
      days: Array.isArray(plan.days) ? plan.days : [],
      shopping_list: Array.isArray(plan.shopping_list) ? plan.shopping_list : [],
      general_tips: Array.isArray(plan.general_tips) ? plan.general_tips : []
    };

    const text = JSON.stringify(safePlan);
    const result = {
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ]
    };

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-chefbot-func-version': 'v3-chefbot-1day-2025-11-18b'
      },
      body: JSON.stringify(result)
    };
  };

  try {
    // ---------- INPUT ----------
    const parsedBody = JSON.parse(event.body || '{}');
    const mode = parsedBody.mode || 'week';
    const payload = parsedBody.payload || {};

    // Datos que vienen del front
    const dailyMacros = payload.dailyMacros || {};
    const pTarget = Number.isFinite(dailyMacros.protein_g)
      ? dailyMacros.protein_g
      : 0;
    const fTarget = Number.isFinite(dailyMacros.fat_g) ? dailyMacros.fat_g : 0;
    const cTarget = Number.isFinite(dailyMacros.carbs_g)
      ? dailyMacros.carbs_g
      : 0;

    const numMealsRaw = parseInt(payload.numMeals, 10) || 3;
    const numMeals = Math.min(Math.max(numMealsRaw, 1), 4); // 1–4 comidas

    // SIEMPRE un solo día
    const numDays = 1;

    const dietaryFilter = (payload.dietaryFilter || '').trim();
    const fridgeIngredients = (payload.fridgeIngredients || '').trim();
    const style = (payload.style || 'mediterranea').trim().toLowerCase();

    // 🔴 AQUÍ EL CAMBIO IMPORTANTE: aceptar GEMINI_API_KEY o GOOGLE_API_KEY
    const GEMINI_API_KEY =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!GEMINI_API_KEY) {
      return makePlanResponse({
        mode: 'week',
        plan_name: 'Plan no disponible (configuración)',
        days: [],
        shopping_list: [],
        general_tips: [
          'Chef-Bot no está bien configurado en el servidor y ahora mismo no puede generar menús automáticos.',
          'Revisa que exista GEMINI_API_KEY o GOOGLE_API_KEY en las variables de entorno de Netlify para este sitio.',
          'Si quieres que te ayudemos a diseñar un menú adaptado, puedes escribirnos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
        ]
      });
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres Chef-Bot, una IA que diseña menús cotidianos, realistas y de estilo mediterráneo para usuarios en España.

Tu tarea es devolver SIEMPRE un único objeto JSON con esta estructura de alto nivel:

{
  "mode": "week",
  "plan_name": "string",
  "days": [ { ... } ],
  "shopping_list": [ "..." ],
  "general_tips": [ "..." ]
}

REGLAS IMPORTANTES:
- Genera SOLO 1 día en el array "days".
- En ese día incluye EXACTAMENTE N comidas, donde N te lo indicaré con el parámetro numMeals (1–4).
- Para cada comida genera UNA sola receta (no varias opciones para la misma comida).
- Usa alimentos típicos de dieta mediterránea (adaptada a España): verduras, frutas, legumbres, cereales integrales, aceite de oliva, pescado, huevos, lácteos, algo de carne magra, frutos secos, etc.
- Respeta lo mejor posible los objetivos diarios de proteína, grasa y carbohidratos, distribuidos de forma razonable entre las comidas (no hace falta que sea perfecto al gramo, pero sí coherente).
- Evita combinaciones muy raras o poco apetecibles (por ejemplo, atún con plátano y espinacas en el desayuno).
- Ajusta el contenido a posibles restricciones dietéticas (intolerancias, alergias, sin gluten, etc.) y a una lista de ingredientes prioritarios ("fridgeIngredients") cuando exista.
- No inventes suplementos ni hagas recomendaciones clínicas personalizadas; céntrate en la planificación de comidas.

Estructura orientativa de cada día dentro de "days" (NO hace falta que esté en el response_schema, solo síguela):

{
  "day_name": "Día 1",
  "total_macros": {
    "protein_g": number,
    "fat_g": number,
    "carbs_g": number
  },
  "meals": [
    {
      "meal_type": "Desayuno" | "Comida" | "Cena" | "Snack",
      "recipe_name": "string",
      "short_description": "string",
      "macros": {
        "protein_g": number,
        "fat_g": number,
        "carbs_g": number
      },
      "ingredients": [
        {
          "name": "string",
          "quantity_grams": number,
          "notes": "string opcional"
        }
      ],
      "steps": [
        "paso 1...",
        "paso 2..."
      ]
    }
  ]
}

- No devuelvas explicaciones fuera del JSON.
- NO incluyas recomendaciones médicas individuales; es solo un menú de ejemplo.
- Devuelve únicamente el JSON (sin texto extra).
`.trim();

    const userPromptLines = [];

    userPromptLines.push(
      `Genera un plan de menús para 1 día completo con estilo de dieta mediterránea.`
    );
    userPromptLines.push(
      `Objetivos diarios aproximados (no es obligatorio clavarlos al gramo, pero sí aproximarse):`
    );
    userPromptLines.push(
      `- Proteína: ${pTarget} g/día\n- Grasas: ${fTarget} g/día\n- Carbohidratos: ${cTarget} g/día`
    );
    userPromptLines.push(
      `Número de comidas en el día: ${numMeals} (entre 1 y 4).`
    );
    userPromptLines.push(
      `Restricciones dietéticas: ${
        dietaryFilter || 'Ninguna restricción específica'
      }.`
    );
    userPromptLines.push(
      `Ingredientes prioritarios disponibles en la nevera (si existen): ${
        fridgeIngredients || 'Ninguno concreto'
      }.`
    );
    userPromptLines.push(
      `Estilo solicitado: ${style || 'mediterranea'}. Repite alimentos cotidianos y realistas; nada "gourmet" complejo.`
    );
    userPromptLines.push(
      `Recuerda: solo 1 día en "days", ${numMeals} comidas y una única receta por comida (no generes múltiples alternativas para la misma comida).`
    );

    const userPrompt = userPromptLines.join('\n');

    const responseSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        plan_name: { type: 'string' },
        days: {
          type: 'array',
          items: { type: 'object' }
        },
        shopping_list: {
          type: 'array',
          items: { type: 'string' }
        },
        general_tips: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['mode', 'plan_name', 'days']
    };

    const payloadGemini = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.6,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    // ---------- LLAMADA A GEMINI CON TIMEOUT + RETRIES ----------
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);
    let res;
    let result;
    let attempt = 0;
    const maxRetries = 2;

    while (true) {
      let timedOut = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);

      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadGemini),
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timeoutId);

        if (timedOut) {
          // Timeout duro
          return makePlanResponse({
            mode: 'week',
            plan_name: 'Plan no disponible (tiempo de espera)',
            days: [],
            shopping_list: [],
            general_tips: [
              'Chef-Bot ha tardado demasiado en obtener respuesta del modelo de IA.',
              'Probablemente los servidores externos estén con mucha carga en este momento.',
              'No es un problema de tus datos ni de tu configuración. Prueba a generar el menú de nuevo en unos minutos.',
              'Si prefieres que te ayudemos a diseñar un menú adaptado, puedes escribirnos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
            ]
          });
        }

        // Otros errores de red
        return makePlanResponse({
          mode: 'week',
          plan_name: 'Plan no disponible (conectividad)',
          days: [],
          shopping_list: [],
          general_tips: [
            'Chef-Bot no ha podido contactar correctamente con el modelo de IA.',
            'Puede ser un problema puntual de red o del servicio externo.',
            'Inténtalo de nuevo más tarde y, si ves que se repite, avísanos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
          ]
        });
      }

      clearTimeout(timeoutId);
      result = await res.json().catch(() => ({}));

      if (res.ok) break;

      const msg = result?.error?.message || '';
      const code = result?.error?.code || res.status || 0;

      const isOverloaded =
        res.status === 503 ||
        res.status === 504 ||
        /model is overloaded/i.test(msg) ||
        /overloaded/i.test(msg) ||
        /deadline exceeded/i.test(msg) ||
        /timeout/i.test(msg);

      const isPolicy =
        res.status === 400 ||
        res.status === 403 ||
        /safety/i.test(msg) ||
        /policy/i.test(msg) ||
        /blocked/i.test(msg);

      const isAuth =
        res.status === 401 ||
        res.status === 403 ||
        /api key/i.test(msg) ||
        /unauthorized/i.test(msg) ||
        /permission/i.test(msg);

      // Reintentos si está saturado
      if (isOverloaded && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }

      if (isOverloaded) {
        return makePlanResponse({
          mode: 'week',
          plan_name: 'Plan no disponible (modelo saturado)',
          days: [],
          shopping_list: [],
          general_tips: [
            'Chef-Bot no ha podido generar el menú porque el modelo de IA está saturado.',
            'No es un fallo tuyo ni de la app; es una limitación temporal de los servidores externos.',
            'Prueba de nuevo en unos minutos. Si el problema persiste y quieres que revisemos tu caso, escríbenos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
          ]
        });
      }

      if (isPolicy) {
        return makePlanResponse({
          mode: 'week',
          plan_name: 'Plan no disponible (políticas de contenido)',
          days: [],
          shopping_list: [],
          general_tips: [
            'La petición que has hecho entra en una zona restringida por las políticas del modelo de IA.',
            'Reformula el objetivo del menú de manera más general y sin detalles clínicos personales.',
            'Si tienes dudas sobre cómo usar Chef-Bot, puedes contactarnos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
          ]
        });
      }

      if (isAuth) {
        return makePlanResponse({
          mode: 'week',
          plan_name: 'Plan no disponible (credenciales)',
          days: [],
          shopping_list: [],
          general_tips: [
            'Chef-Bot no tiene ahora mismo permisos correctos para acceder al modelo de IA.',
            'Es un problema interno de configuración que debemos revisar.',
            'Si ves este mensaje de forma persistente, avísanos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
          ]
        });
      }

      // Otros errores genéricos
      return makePlanResponse({
        mode: 'week',
        plan_name: 'Plan no disponible (error de servicio)',
        days: [],
        shopping_list: [],
        general_tips: [
          'Ha ocurrido un problema inesperado al consultar el modelo de IA.',
          `Código aproximado: ${code}.`,
          'Inténtalo de nuevo más tarde y, si sigue ocurriendo, coméntanoslo desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
        ]
      });
    }

    // ---------- CASO ÉXITO: NORMALIZAR ----------
    if (!result?.candidates?.length) {
      return makePlanResponse({
        mode: 'week',
        plan_name: 'Plan no disponible (sin candidatos)',
        days: [],
        shopping_list: [],
        general_tips: [
          'La IA no ha devuelto ningún candidato de respuesta.',
          'Prueba a generar el menú de nuevo en unos minutos.',
          'Si el problema persiste, escríbenos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
        ]
      });
    }

    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = robustParse(stripFences(rawText));

    if (!parsed || typeof parsed !== 'object') {
      return makePlanResponse({
        mode: 'week',
        plan_name: 'Plan no disponible (formato inesperado)',
        days: [],
        shopping_list: [],
        general_tips: [
          'Chef-Bot ha recibido una respuesta que no ha podido interpretar correctamente.',
          'Vuelve a intentarlo y, si ves que se repite, coméntanoslo desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
        ]
      });
    }

    const safePlan = {
      mode: parsed.mode || 'week',
      plan_name: parsed.plan_name || 'Plan diario Chef-Bot',
      days: Array.isArray(parsed.days) ? parsed.days : [],
      shopping_list: Array.isArray(parsed.shopping_list)
        ? parsed.shopping_list
        : [],
      general_tips: Array.isArray(parsed.general_tips)
        ? parsed.general_tips
        : []
    };

    return makePlanResponse(safePlan);
  } catch (error) {
    return makePlanResponse({
      mode: 'week',
      plan_name: 'Plan no disponible (error interno)',
      days: [],
      shopping_list: [],
      general_tips: [
        'Ha ocurrido un problema interno al generar el menú con Chef-Bot.',
        'Vuelve a intentarlo en unos minutos y, si siguiera fallando, coméntanoslo desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
      ]
    });
  }
};
