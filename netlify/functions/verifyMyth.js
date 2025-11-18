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

  // ---------- UTILIDAD: RESPUESTA ESTÁNDAR DE PLAN ----------
  const makePlanResponse = (plan) => {
    const safe = {
      mode: plan.mode || 'week',
      plan_name: plan.plan_name || 'Plan generado por Chef-Bot',
      days: Array.isArray(plan.days) ? plan.days : [],
      shopping_list: Array.isArray(plan.shopping_list) ? plan.shopping_list : [],
      general_tips: Array.isArray(plan.general_tips) ? plan.general_tips : []
    };

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-chefbot-func-version': 'v4-chefbot-2025-11-18'
      },
      body: JSON.stringify(safe)
    };
  };

  // ---------- UTILIDADES DE PARSEO ROBUSTO ----------
  const stripFences = (t) => {
    let x = (t || '').trim();
    if (x.startsWith('```')) {
      x = x.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    }
    return x.trim();
  };

  const robustParse = (text) => {
    // 1) JSON directo
    try {
      return JSON.parse(text);
    } catch {}

    const t = (text || '').trim();

    // 2) Array raíz -> primer objeto
    if (t.startsWith('[')) {
      try {
        const a = JSON.parse(t);
        if (Array.isArray(a) && a.length && typeof a[0] === 'object') {
          return a[0];
        }
      } catch {}
    }

    // 3) Buscar bloque { ... } balanceado
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

  // ---------- DESCARGO DE RESPONSABILIDAD (para mensajes de error) ----------
  const DISCLAIMER_LINES = [
    'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
    'Si tienes patologías, medicación crónica, TCA, embarazo u otras situaciones clínicas, consulta siempre con un profesional antes de seguir cualquier pauta alimentaria.'
  ];

  const CONTACT_HTML =
    'Si quieres que te ayudemos a diseñar un menú adaptado, puedes escribirnos desde ' +
    '<a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">' +
    'https://metabolismix.com/contacto/' +
    '</a>.';

  // ---------- PARSEO INPUT ----------
  try {
    const body = JSON.parse(event.body || '{}');
    const mode = body.mode || 'week'; // el front manda "week", pero generamos 1 día
    const payload = body.payload || {};

    const dailyMacros = payload.dailyMacros || {};
    const numMeals = Number.isFinite(payload.numMeals)
      ? Math.max(1, Math.min(4, payload.numMeals))
      : 3;
    const dietaryFilter = (payload.dietaryFilter || '').toString().trim();
    const fridgeIngredients = (payload.fridgeIngredients || '').toString().trim();
    const style = (payload.style || 'mediterranea').toString().trim();

    const pTarget = Number(dailyMacros.protein_g) || 0;
    const fTarget = Number(dailyMacros.fat_g) || 0;
    const cTarget = Number(dailyMacros.carbs_g) || 0;

    if (pTarget <= 0 || fTarget <= 0 || cTarget <= 0) {
      return makePlanResponse({
        mode,
        plan_name: 'Plan no disponible (parámetros inválidos)',
        days: [],
        shopping_list: [],
        general_tips: [
          ...DISCLAIMER_LINES,
          'Los macros diarios (proteína, grasas y carbohidratos) deben ser mayores que cero.',
          'Revisa los valores introducidos en Chef-Bot e inténtalo de nuevo.'
        ]
      });
    }

    // ---------- API KEY ----------
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return makePlanResponse({
        mode,
        plan_name: 'Plan no disponible (configuración)',
        days: [],
        shopping_list: [],
        general_tips: [
          ...DISCLAIMER_LINES,
          'Chef-Bot no está bien configurado en el servidor y ahora mismo no puede generar menús automáticos.',
          'Revisa la variable GEMINI_API_KEY en Netlify o contacta con el equipo si el problema persiste.',
          CONTACT_HTML
        ]
      });
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres un asistente de planificación de menús llamado "Chef-Bot".

Tu tarea:
- Generar SOLO un plan de 1 día con entre 1 y 4 comidas (según numMeals).
- Ajustar de forma aproximada los macros diarios objetivo (proteína, grasas y carbohidratos) repartidos entre las comidas.
- Usar un estilo de dieta mediterránea: verduras, fruta, legumbres, aceite de oliva, pescado, algo de carne blanca, cereales integrales, frutos secos.
- Respetar en la medida de lo posible las restricciones dietéticas indicadas (si las hay).
- Si se dan ingredientes de "nevera", intentar priorizarlos dentro de lo razonable.
- Mantener la receta realista para una persona en España (platos habituales, nada extravagante).

Limitaciones importantes:
- No hagas recomendaciones médicas personalizadas ni ajustes específicos para patologías concretas.
- El menú es orientativo y NO sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.
- No incluyas contenido ofensivo, sexual, violento ni promocionado como "milagroso".
- No indiques pérdidas de peso concretas ni promesas de salud.

Estructura de salida (JSON):
{
  "mode": "week",
  "plan_name": "Plan de 1 día generado por Chef-Bot",
  "days": [
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
          "recipe_name": string,
          "short_description": string,
          "macros": {
            "protein_g": number,
            "fat_g": number,
            "carbs_g": number
          },
          "ingredients": [
            {
              "name": string,
              "quantity_grams": number,
              "notes": string
            }
          ],
          "steps": [string, string, string]
        }
      ]
    }
  ],
  "shopping_list": [string],
  "general_tips": [string]
}

Restricciones adicionales:
- Máximo 8 ingredientes por receta.
- Máximo 3 pasos por receta.
- No generes listas de la compra ni consejos excesivamente largos.
- Respeta la estructura JSON indicada.
`;

    const responseSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        plan_name: { type: 'string' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day_name: { type: 'string' },
              total_macros: {
                type: 'object',
                properties: {
                  protein_g: { type: 'number' },
                  fat_g: { type: 'number' },
                  carbs_g: { type: 'number' }
                }
              },
              meals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    meal_type: { type: 'string' },
                    recipe_name: { type: 'string' },
                    short_description: { type: 'string' },
                    macros: {
                      type: 'object',
                      properties: {
                        protein_g: { type: 'number' },
                        fat_g: { type: 'number' },
                        carbs_g: { type: 'number' }
                      }
                    },
                    ingredients: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          quantity_grams: { type: 'number' },
                          notes: { type: 'string' }
                        }
                      }
                    },
                    steps: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        shopping_list: { type: 'array', items: { type: 'string' } },
        general_tips: { type: 'array', items: { type: 'string' } }
      },
      required: ['days']
    };

    const generationConfig = {
      temperature: 0.4,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 768,
      responseMimeType: 'application/json',
      responseSchema
    };

    const userContent = {
      mode: 'week',
      dailyMacros: { protein_g: pTarget, fat_g: fTarget, carbs_g: cTarget },
      numMeals,
      dietaryFilter,
      fridgeIngredients,
      style
    };

    const geminiPayload = {
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userContent) }] }],
      generationConfig
    };

    // ---------- LLAMADA A GEMINI CON TIMEOUT + REINTENTOS ----------
    const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);
    const maxRetries = 1;
    let attempt = 0;
    let result;

    while (true) {
      let timedOut = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);

      let res;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timeoutId);

        if (timedOut) {
          return makePlanResponse({
            mode,
            plan_name: 'Plan no disponible (tiempo de espera)',
            days: [],
            shopping_list: [],
            general_tips: [
              ...DISCLAIMER_LINES,
              'Chef-Bot no ha podido generar el plan porque la petición ha tardado demasiado.',
              'Probablemente los servidores de IA tengan mucha carga en este momento.',
              'No es culpa tuya ni de tu configuración; prueba a generar el plan de nuevo en unos minutos.'
            ]
          });
        }

        return makePlanResponse({
          mode,
          plan_name: 'Plan no disponible (conectividad)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...DISCLAIMER_LINES,
            'Ha ocurrido un problema de conexión al intentar contactar con el modelo de IA.',
            'Revisa tu conexión a Internet o inténtalo de nuevo en unos minutos.',
            CONTACT_HTML
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
        /overloaded/i.test(msg) ||
        /unavailable/i.test(msg) ||
        /timeout/i.test(msg) ||
        /deadline exceeded/i.test(msg);

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

      if (isOverloaded && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }

      if (isOverloaded) {
        return makePlanResponse({
          mode,
          plan_name: 'Plan no disponible (modelo saturado)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...DISCLAIMER_LINES,
            'Los servidores externos de IA (Gemini) están devolviendo errores de saturación.',
            'No es un fallo de Chef-Bot ni de tus datos. Prueba a generar el plan de nuevo en unos minutos.',
            CONTACT_HTML
          ]
        });
      }

      if (isPolicy) {
        return makePlanResponse({
          mode,
          plan_name: 'Plan no disponible (políticas de contenido)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...DISCLAIMER_LINES,
            'La petición que has hecho entra en una zona restringida por las políticas del modelo de IA.',
            'Reformula el objetivo del menú de manera más general y sin detalles clínicos personales.',
            CONTACT_HTML,
            `Detalle técnico: código ${code}, mensaje: ${msg || 'sin detalle proporcionado.'}`
          ]
        });
      }

      if (isAuth) {
        return makePlanResponse({
          mode,
          plan_name: 'Plan no disponible (credenciales)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...DISCLAIMER_LINES,
            'Ahora mismo Chef-Bot no tiene permisos correctos para acceder al modelo de IA.',
            'Revisa la clave GEMINI_API_KEY o los permisos del proyecto en Google AI Studio.',
            CONTACT_HTML,
            `Detalle técnico: código ${code}, mensaje: ${msg || 'sin detalle proporcionado.'}`
          ]
        });
      }

      // Otros errores 4xx/5xx
      return makePlanResponse({
        mode,
        plan_name: 'Plan no disponible (error de servicio)',
        days: [],
        shopping_list: [],
        general_tips: [
          ...DISCLAIMER_LINES,
          'Ha ocurrido un problema inesperado al consultar el modelo de IA.',
          'Inténtalo de nuevo en unos minutos. Si el problema persiste, revisa la configuración de Chef-Bot o contáctanos.',
          CONTACT_HTML,
          `Detalle técnico: código ${code}, mensaje: ${msg || 'sin detalle proporcionado.'}`
        ]
      });
    }

    // ---------- PARSEO DE RESPUESTA CORRECTA ----------
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = robustParse(stripFences(rawText));
    const plan = parsed && typeof parsed === 'object' ? parsed : null;

    if (!plan || !Array.isArray(plan.days)) {
      return makePlanResponse({
        mode,
        plan_name: 'Plan no disponible (respuesta no válida)',
        days: [],
        shopping_list: [],
        general_tips: [
          ...DISCLAIMER_LINES,
          'La IA ha devuelto una respuesta que no se ajusta al formato esperado.',
          'Prueba a generar de nuevo el plan con una descripción más sencilla.',
          CONTACT_HTML
        ]
      });
    }

    // Normalizamos un poco pero sin tocar demasiado la estructura
    plan.mode = 'week';
    if (!plan.plan_name) {
      plan.plan_name = 'Plan de 1 día generado por Chef-Bot';
    }

    return makePlanResponse(plan);
  } catch (error) {
    return makePlanResponse({
      mode: 'week',
      plan_name: 'Plan no disponible (error interno)',
      days: [],
      shopping_list: [],
      general_tips: [
        ...DISCLAIMER_LINES,
        'Ha ocurrido un problema interno al procesar tu solicitud.',
        'Inténtalo de nuevo en unos minutos. Si el error persiste, revisa la consola de Netlify Functions.',
        CONTACT_HTML,
        `Detalle técnico (handler): ${String(error && error.message ? error.message : error)}`
      ]
    });
  }
};
