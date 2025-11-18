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

  // ---------- HELPERS PARA RESPUESTAS ----------
  const makePlanResponse = (plan) => {
    const safe = {
      mode: plan.mode || 'week',
      plan_name: plan.plan_name || 'Plan diario sugerido por Chef-Bot',
      days: Array.isArray(plan.days) ? plan.days : [],
      shopping_list: Array.isArray(plan.shopping_list) ? plan.shopping_list : [],
      general_tips: Array.isArray(plan.general_tips) ? plan.general_tips : []
    };

    // Aseguramos siempre un mínimo de disclaimers
    if (!safe.general_tips.length) {
      safe.general_tips.push(
        'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
        'Consulta siempre con un profesional antes de realizar cambios importantes en tu alimentación.',
        'Si tienes alergias o intolerancias, revisa cuidadosamente los ingredientes y las etiquetas de los productos.'
      );
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-chefbot-func-version': 'v3-chefbot-2025-11-18'
      },
      body: JSON.stringify(safe)
    };
  };

  const makeErrorPlan = (plan_name, tips) => {
    const general_tips = Array.isArray(tips) ? tips.slice() : [];
    // Añadimos siempre el descargo sanitario
    general_tips.unshift(
      'Este menú (si se genera) es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.'
    );
    general_tips.push(
      'Si tienes patologías, medicación crónica, TCA, embarazo u otras situaciones clínicas, consulta siempre con un profesional antes de seguir cualquier pauta alimentaria.'
    );

    return makePlanResponse({
      mode: 'week',
      plan_name,
      days: [],
      shopping_list: [],
      general_tips
    });
  };

  const stripFences = (t) => {
    let x = (t || '').trim();
    if (x.startsWith('```')) {
      x = x.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    }
    return x.trim();
  };

  const robustParsePlan = (text) => {
    if (!text) return null;
    let t = stripFences(text);

    // 1) JSON directo
    try {
      return JSON.parse(t);
    } catch {}

    // 2) Array raíz -> primer objeto
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
      let end = -1;
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
          if (ch === '"') {
            inStr = true;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
      }
      if (end !== -1) {
        const snippet = t.slice(start, end + 1);
        try {
          return JSON.parse(snippet);
        } catch {}
      }
    }

    return null;
  };

  try {
    // ---------- INPUT ----------
    const body = JSON.parse(event.body || '{}');
    const mode = body.mode || 'week';
    const payload = body.payload || {};

    const daily = payload.dailyMacros || {};
    const protein_g = Number(daily.protein_g) || 0;
    const fat_g = Number(daily.fat_g) || 0;
    const carbs_g = Number(daily.carbs_g) || 0;
    const numMeals = Number(payload.numMeals) || 0;

    const dietaryFilter = (payload.dietaryFilter || '').toString().trim();
    const fridgeIngredients = (payload.fridgeIngredients || '').toString().trim();
    const style = (payload.style || 'mediterranea').toString().trim();

    if (!protein_g || !fat_g || !carbs_g || !numMeals) {
      return makeErrorPlan('Plan no disponible (configuración)', [
        'Chef-Bot no ha recibido macros o número de comidas válidos.',
        'Revisa que los objetivos de proteína, grasas, carbohidratos y número de comidas sean mayores que cero.',
        'Si el problema persiste, puedes escribirnos desde https://metabolismix.com/contacto/.'
      ]);
    }

    // ---------- API KEY ----------
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return makeErrorPlan('Plan no disponible (configuración del servidor)', [
        'Chef-Bot no está bien configurado en el servidor y ahora mismo no puede generar menús automáticos.',
        'Falta la variable de entorno GEMINI_API_KEY en Netlify.',
        'Si eres usuario final, no es culpa tuya; prueba más tarde o contáctanos desde https://metabolismix.com/contacto/.'
      ]);
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres CHEF-BOT, un asistente de cocina que genera EJEMPLOS ORIENTATIVOS de menús de un día.

REGLAS CLAVE (CUMPLE SIEMPRE):
- No eres médico ni dietista-nutricionista.
- No das consejo médico ni nutricional personalizado.
- No haces diagnósticos ni tratas enfermedades.
- Si en el contexto se menciona una patología, medicación, cirugía bariátrica, trastornos de la conducta alimentaria u otra situación clínica:
  - IGNORA esa parte y genera un menú general para un adulto sano.
- No prometas adelgazamiento, control de enfermedad ni beneficios de salud.
- No uses lenguaje que suene a prescripción (“debes”, “tienes que”, “tratamiento”).
- No hables de objetivos extremos de peso, déficit calórico agresivo ni ayunos prolongados.
- Trata cualquier objetivo de macros como una guía numérica general, no como pauta médica.

ESTILO GENERAL:
- Cocina de inspiración mediterránea: verduras, legumbres, fruta, aceite de oliva, frutos secos, cereales integrales, proteínas magras.
- Prioriza combinaciones realistas y habituales para un usuario en España.
- Respeta en la medida de lo posible la idea de “horarios típicos”: por ejemplo, desayunos, comidas y cenas que tengan sentido.

FORMATO DE SALIDA (OBLIGATORIO):
Devuelve SIEMPRE un único JSON con esta forma (sin texto adicional, sin explicaciones fuera del JSON):

{
  "mode": "week",
  "plan_name": "Plan diario sugerido por Chef-Bot",
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
          "recipe_name": "Nombre del plato",
          "short_description": "Descripción muy breve del plato (1-2 frases).",
          "macros": {
            "protein_g": number,
            "fat_g": number,
            "carbs_g": number
          },
          "ingredients": [
            {
              "name": "Nombre del ingrediente",
              "quantity_grams": number,
              "notes": "Notas opcionales, por ejemplo: fresco, congelado, integral."
            }
          ],
          "steps": [
            "Paso 1...",
            "Paso 2..."
          ]
        }
      ]
    }
  ],
  "shopping_list": [
    "Ingrediente 1",
    "Ingrediente 2"
  ],
  "general_tips": [
    "Tip 1",
    "Tip 2"
  ]
}

- "general_tips" debe incluir SIEMPRE, como mínimo:
  1) "Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista."
  2) Un recordatorio sobre alergias e intolerancias y la importancia de revisar etiquetas.
- No incluyas HTML, enlaces ni URLs en el JSON.
- No añadas campos adicionales fuera de los definidos.
`;

    const userPrompt = `
Genera un ejemplo de MENÚ PARA 1 DÍA con ${numMeals} comidas, siguiendo estas pautas:

- Macros diarios objetivo aproximados:
  - Proteína: ${protein_g} g
  - Grasas: ${fat_g} g
  - Carbohidratos: ${carbs_g} g

- Estilo culinario: "${style}" (inspiración mediterránea, cocina cotidiana en España).

- Restricciones dietéticas declaradas por el usuario (texto libre, NO lo interpretes como diagnóstico médico):
  "${dietaryFilter || 'Ninguna especificada'}"

- Ingredientes disponibles en la nevera/despensa (texto libre, úsalo como sugerencia, no como obligación rígida):
  "${fridgeIngredients || 'No especificado'}"

REQUISITOS:
- Ajusta los macros de cada comida de forma razonable, pero sin obsesión matemática; es una aproximación educativa.
- Evita combinaciones absurdas (por ejemplo, "atún con plátano y espinacas" en el desayuno, salvo que la receta tenga sentido cultural/culinario).
- Usa platos que puedan imaginarse y cocinarse en un entorno doméstico normal.
- Respeta estrictamente el formato JSON indicado por el sistema.
`;

    const geminiPayload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        role: 'user',
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
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
          body: JSON.stringify(geminiPayload),
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timeoutId);

        if (timedOut) {
          return makeErrorPlan('Plan no disponible (tiempo de espera)', [
            'Chef-Bot no ha podido generar el plan porque la petición ha tardado demasiado.',
            'Probablemente los servidores de IA tengan mucha carga en este momento.',
            'No es culpa tuya ni de tu configuración; prueba a generar el plan de nuevo en unos minutos.'
          ]);
        }

        return makeErrorPlan('Plan no disponible (conectividad)', [
          'Ha habido un problema de conexión al servicio externo de IA.',
          'Puedes revisar tu conexión a internet y volver a intentarlo.',
          'Si el problema persiste, contáctanos desde https://metabolismix.com/contacto/.'
        ]);
      }

      clearTimeout(timeoutId);
      result = await res.json().catch(() => ({}));

      if (res.ok) {
        break; // Salimos del bucle: éxito
      }

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

      // Reintentos en caso de sobrecarga
      if (isOverloaded && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }

      // Saturación / timeout tras reintentos
      if (isOverloaded) {
        return makeErrorPlan('Plan no disponible (saturación del modelo)', [
          'Los servidores externos de IA (Gemini) están saturados o devolviendo errores de carga.',
          'No es culpa tuya ni de tus datos; simplemente vuelve a intentarlo más tarde.',
          `Detalle técnico (código ${code}): ${msg || 'error de sobrecarga sin detalle adicional.'}`
        ]);
      }

      // Errores de políticas / contenido
      if (isPolicy) {
        return makeErrorPlan('Plan no disponible (políticas de contenido)', [
          'La petición que has hecho entra en una zona restringida por las políticas del modelo de IA.',
          'Puedes probar a reformular el objetivo del menú de manera más general y sin detalles clínicos personales.',
          'Si tienes dudas sobre cómo usar Chef-Bot, puedes escribirnos desde https://metabolismix.com/contacto/.'
        ]);
      }

      // Errores de autenticación / permisos
      if (isAuth) {
        return makeErrorPlan('Plan no disponible (credenciales)', [
          'Ahora mismo Chef-Bot no tiene permisos correctos para acceder al modelo de IA.',
          'Como usuario final, no puedes resolverlo tú mismo; depende de la configuración del servidor.',
          `Detalle técnico (código ${code}): ${msg || 'error de autenticación/permiso sin detalle adicional.'}`
        ]);
      }

      // Otros errores 4xx/5xx
      return makeErrorPlan('Plan no disponible (error de servicio)', [
        'Ha ocurrido un problema inesperado al consultar el modelo de IA.',
        'No se ha podido generar un menú estructurado en este momento.',
        `Detalle técnico (status ${res.status}, código ${code}): ${msg || 'sin detalle proporcionado.'}`
      ]);
    }

    // ---------- ÉXITO: NORMALIZAR PLAN ----------
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsedPlan = robustParsePlan(rawText);

    if (!parsedPlan || typeof parsedPlan !== 'object' || !Array.isArray(parsedPlan.days)) {
      return makeErrorPlan('Plan no disponible (formato de respuesta)', [
        'El modelo de IA ha respondido, pero no en el formato esperado.',
        'No se ha podido extraer un plan de menús estructurado.',
        'Prueba de nuevo en unos minutos; si el error persiste, contáctanos desde https://metabolismix.com/contacto/.'
      ]);
    }

    // Forzamos valores por defecto y disclaimers
    const safePlan = {
      mode: parsedPlan.mode || mode || 'week',
      plan_name: parsedPlan.plan_name || 'Plan diario sugerido por Chef-Bot',
      days: Array.isArray(parsedPlan.days) ? parsedPlan.days : [],
      shopping_list: Array.isArray(parsedPlan.shopping_list) ? parsedPlan.shopping_list : [],
      general_tips: Array.isArray(parsedPlan.general_tips) ? parsedPlan.general_tips.slice() : []
    };

    return makePlanResponse(safePlan);
  } catch (error) {
    return makeErrorPlan('Plan no disponible (error interno)', [
      'Ha ocurrido un problema interno al procesar la petición de Chef-Bot.',
      'No se ha podido generar un menú en este momento.',
      `Detalle técnico interno: ${error && error.message ? error.message : 'error desconocido.'}`
    ]);
  }
};
