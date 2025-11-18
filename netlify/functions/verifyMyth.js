// netlify/functions/verifyMyth.js
exports.handler = async function (event, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // --------- CORS / MÉTODO ---------
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

  // --------- CONSTANTES / CONFIG ---------
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);

  const GLOBAL_DISCLAIMERS = [
    'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
    'Si tienes patologías, medicación crónica, TCA, embarazo u otras situaciones clínicas, consulta siempre con un profesional antes de seguir cualquier pauta alimentaria.'
  ];

  // Tabla muy simple de alimentos base para fallback determinista
  const BASE_FOODS = {
    chicken: {
      id: 'chicken',
      name: 'Pechuga de pollo',
      macrosPer100g: { protein_g: 22, fat_g: 3, carbs_g: 0 }
    },
    salmon: {
      id: 'salmon',
      name: 'Salmón',
      macrosPer100g: { protein_g: 20, fat_g: 13, carbs_g: 0 }
    },
    rice: {
      id: 'rice',
      name: 'Arroz integral cocido',
      macrosPer100g: { protein_g: 2.5, fat_g: 0.3, carbs_g: 28 }
    },
    broccoli: {
      id: 'broccoli',
      name: 'Brócoli',
      macrosPer100g: { protein_g: 3, fat_g: 0.4, carbs_g: 7 }
    },
    salad: {
      id: 'salad',
      name: 'Ensalada verde (mezclum)',
      macrosPer100g: { protein_g: 1.5, fat_g: 0.2, carbs_g: 3 }
    },
    oats: {
      id: 'oats',
      name: 'Copos de avena',
      macrosPer100g: { protein_g: 13, fat_g: 7, carbs_g: 60 }
    },
    yogurt: {
      id: 'yogurt',
      name: 'Yogur natural',
      macrosPer100g: { protein_g: 5, fat_g: 3, carbs_g: 4.5 }
    },
    banana: {
      id: 'banana',
      name: 'Plátano',
      macrosPer100g: { protein_g: 1.2, fat_g: 0.3, carbs_g: 23 }
    },
    oliveOil: {
      id: 'oliveOil',
      name: 'Aceite de oliva virgen extra',
      macrosPer100g: { protein_g: 0, fat_g: 100, carbs_g: 0 }
    }
  };

  // --------- UTILIDADES GENERALES ---------
  const safeNumber = (v) => (Number.isFinite(v) ? v : 0);

  const stripText = (s) =>
    typeof s === 'string'
      ? s.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
      : '';

  const robustParse = (text) => {
    if (!text) return null;
    let t = String(text).trim();

    // Quitar fences ```json
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    }

    // 1) Parse directo
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

    // 3) Extraer primer bloque { ... } balanceado
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

  const isMealValid = (m) =>
    m &&
    typeof m.meal_type === 'string' &&
    typeof m.recipe_name === 'string' &&
    Array.isArray(m.ingredients) &&
    m.ingredients.length > 0 &&
    Array.isArray(m.steps) &&
    m.steps.length > 0 &&
    m.macros &&
    typeof m.macros.protein_g === 'number' &&
    typeof m.macros.fat_g === 'number' &&
    typeof m.macros.carbs_g === 'number';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const gramsFromMacro = (targetMacro, macroPer100g) => {
    if (!macroPer100g || macroPer100g <= 0) return 0;
    const grams = (targetMacro / macroPer100g) * 100;
    return clamp(grams, 0, 250);
  };

  const mergeShoppingList = (days) => {
    const acc = new Map(); // key = name, value = grams

    days.forEach((day) => {
      (day.meals || []).forEach((meal) => {
        (meal.ingredients || []).forEach((ing) => {
          const name = stripText(ing.name || '').toLowerCase();
          if (!name) return;
          const grams = safeNumber(ing.quantity_grams || ing.quantity || 0);
          const prev = acc.get(name) || 0;
          acc.set(name, prev + grams);
        });
      });
    });

    const list = [];
    for (const [name, grams] of acc.entries()) {
      const prettyName = name.charAt(0).toUpperCase() + name.slice(1);
      list.push(`${Math.round(grams)} g de ${prettyName}`);
    }
    return list;
  };

  // --------- REPARTO DE MACROS POR COMIDA ---------
  function buildMealSlots(dailyMacros, numMeals) {
    const totalP = safeNumber(dailyMacros.protein_g);
    const totalF = safeNumber(dailyMacros.fat_g);
    const totalC = safeNumber(dailyMacros.carbs_g);

    const n = clamp(numMeals, 1, 4);

    let fractions;
    let mealTypes;

    if (n === 1) {
      fractions = [1];
      mealTypes = ['Comida principal'];
    } else if (n === 2) {
      fractions = [0.55, 0.45];
      mealTypes = ['Comida fuerte (mediodía)', 'Cena ligera'];
    } else if (n === 3) {
      fractions = [0.25, 0.4, 0.35];
      mealTypes = ['Desayuno', 'Comida', 'Cena'];
    } else {
      // 4 comidas
      fractions = [0.25, 0.35, 0.15, 0.25];
      mealTypes = ['Desayuno', 'Comida', 'Merienda', 'Cena'];
    }

    return fractions.map((frac, idx) => ({
      meal_type: mealTypes[idx] || `Comida ${idx + 1}`,
      target_macros: {
        protein_g: totalP * frac,
        fat_g: totalF * frac,
        carbs_g: totalC * frac
      }
    }));
  }

  // --------- FALLBACK DETERMINISTA (SIN IA) ---------
  function buildFallbackMeal(slot) {
    const { meal_type, target_macros } = slot || {};
    const P = safeNumber(target_macros?.protein_g);
    const F = safeNumber(target_macros?.fat_g);
    const C = safeNumber(target_macros?.carbs_g);

    const isBreakfast = /desayuno/i.test(meal_type || '');
    const isSnack = /merienda/i.test(meal_type || '');

    let ingredients = [];
    let macros = { protein_g: 0, fat_g: 0, carbs_g: 0 };
    let recipe_name;
    let steps;

    if (isBreakfast || isSnack) {
      // Desayuno / merienda: yogur + avena + plátano + frutos secos simulados
      const yogurtGr = clamp(150, 80, 250);
      const oatsGr = clamp(40, 20, 80);
      const bananaGr = clamp(80, 50, 120);

      const y = BASE_FOODS.yogurt.macrosPer100g;
      const o = BASE_FOODS.oats.macrosPer100g;
      const b = BASE_FOODS.banana.macrosPer100g;

      macros.protein_g =
        (y.protein_g * yogurtGr) / 100 +
        (o.protein_g * oatsGr) / 100 +
        (b.protein_g * bananaGr) / 100;
      macros.fat_g =
        (y.fat_g * yogurtGr) / 100 +
        (o.fat_g * oatsGr) / 100 +
        (b.fat_g * bananaGr) / 100;
      macros.carbs_g =
        (y.carbs_g * yogurtGr) / 100 +
        (o.carbs_g * oatsGr) / 100 +
        (b.carbs_g * bananaGr) / 100;

      ingredients = [
        { name: 'Yogur natural', quantity_grams: yogurtGr, notes: '' },
        { name: 'Copos de avena', quantity_grams: oatsGr, notes: '' },
        { name: 'Plátano', quantity_grams: bananaGr, notes: 'En rodajas' },
        { name: 'Frutos secos (nueces o almendras)', quantity_grams: 15, notes: 'Opcional' }
      ];

      recipe_name = 'Bol de yogur con avena, plátano y frutos secos';
      steps = [
        'Sirve el yogur en un bol.',
        'Añade por encima los copos de avena.',
        'Corta el plátano en rodajas y repártelo por el bol.',
        'Completa con frutos secos picados. Puedes añadir canela al gusto.'
      ];
    } else {
      // Comida / cena: pollo + arroz + verdura + aceite de oliva
      const p100 = BASE_FOODS.chicken.macrosPer100g;
      const r100 = BASE_FOODS.rice.macrosPer100g;
      const b100 = BASE_FOODS.broccoli.macrosPer100g;
      const o100 = BASE_FOODS.oliveOil.macrosPer100g;

      const chickenGr = clamp(gramsFromMacro(P * 0.75, p100.protein_g), 100, 220);
      const riceGr = clamp(gramsFromMacro(C * 0.75, r100.carbs_g), 60, 200);
      const broccoliGr = clamp(100, 60, 150);
      const oilGr = clamp(F, 5, 15); // 1 g aceite = 1 g grasa aprox.

      macros.protein_g =
        (p100.protein_g * chickenGr) / 100 +
        (r100.protein_g * riceGr) / 100 +
        (b100.protein_g * broccoliGr) / 100;
      macros.fat_g =
        (p100.fat_g * chickenGr) / 100 +
        (r100.fat_g * riceGr) / 100 +
        (b100.fat_g * broccoliGr) / 100 +
        (o100.fat_g * oilGr) / 100;
      macros.carbs_g =
        (p100.carbs_g * chickenGr) / 100 +
        (r100.carbs_g * riceGr) / 100 +
        (b100.carbs_g * broccoliGr) / 100;

      ingredients = [
        { name: 'Pechuga de pollo', quantity_grams: Math.round(chickenGr), notes: 'En dados o tiras' },
        { name: 'Arroz integral cocido', quantity_grams: Math.round(riceGr), notes: '' },
        { name: 'Brócoli', quantity_grams: Math.round(broccoliGr), notes: 'En ramilletes' },
        { name: 'Aceite de oliva virgen extra', quantity_grams: Math.round(oilGr), notes: 'Para cocinar y aliñar' }
      ];

      recipe_name = 'Bol de pollo con arroz integral, brócoli y aceite de oliva';
      steps = [
        'Cocina el arroz integral siguiendo las instrucciones del envase.',
        'Saltea el pollo en una sartén con parte del aceite hasta que esté bien hecho.',
        'Añade el brócoli troceado y saltea unos minutos más, o cuécelo al vapor aparte.',
        'Sirve el arroz en la base del plato, coloca el pollo y el brócoli encima y termina con el resto del aceite en crudo.'
      ];
    }

    return {
      meal_type: meal_type || 'Comida',
      recipe_name,
      short_description:
        'Plato generado de forma automática por Chef-Bot cuando la IA no estaba disponible. Las cantidades son aproximadas.',
      macros: {
        protein_g: Math.round(macros.protein_g),
        fat_g: Math.round(macros.fat_g),
        carbs_g: Math.round(macros.carbs_g)
      },
      ingredients,
      steps
    };
  }

  // --------- LLAMADA A GEMINI (POR COMIDA) ---------
  async function callGeminiForMeal(slot, dietaryFilter, fridgeIngredientsText) {
    if (!GEMINI_API_KEY) {
      // Sin clave -> forzamos fallo para que salte fallback
      throw new Error('Falta GEMINI_API_KEY');
    }

    const { meal_type, target_macros } = slot || {};
    const P = safeNumber(target_macros?.protein_g);
    const F = safeNumber(target_macros?.fat_g);
    const C = safeNumber(target_macros?.carbs_g);

    const dietary = stripText(dietaryFilter || '');
    const fridge = stripText(fridgeIngredientsText || '');

    const systemPrompt = `
Eres un asistente culinario que propone ideas de platos mediterráneos orientativos para personas adultas sanas.
No eres médico ni dietista.
No des consejos médicos, no hables de enfermedades, ni de pérdida de peso, ni de patologías.
Tu tarea es sugerir un único plato realista y casero, con ingredientes sencillos y cantidades aproximadas en gramos.
Respeta cualquier restricción alimentaria que se indique (por ejemplo: sin frutos secos, sin gluten, vegetariano...).
Si no se indican restricciones, asume que la persona no tiene alergias conocidas, pero evita combinaciones raras o poco apetecibles.
No menciones macros, gramos ni calorías en la descripción ni en los pasos; solo en los campos estructurados.
Las cantidades en gramos pueden desviarse algo del objetivo, pero intenta acercarte.
`.trim();

    const userPrompt = `
Genera un único plato para la siguiente comida: "${meal_type || 'Comida'}".

Macros objetivo aproximados:
- Proteína: ${Math.round(P)} g
- Grasas: ${Math.round(F)} g
- Carbohidratos: ${Math.round(C)} g

Restricciones dietéticas (si están vacías, ignóralas): ${dietary || 'ninguna especificada'}.

Ingredientes disponibles en la nevera (si hay, priorízalos, pero puedes añadir otros básicos mediterráneos si hace falta): ${
      fridge || 'no se ha especificado ninguno'
    }.

Condiciones importantes:
- El plato debe ser de estilo mediterráneo (ejemplo: combinaciones con verduras, legumbres, cereales integrales, pescado, aves, aceite de oliva...).
- Evita mezclar ingredientes que, en la práctica, se comerían con dificultad (ejemplos a evitar: atún con plátano en el mismo plato, combinaciones muy dulces con carnes sin sentido culinario).
- Usa ingredientes que se encuentren de forma razonable en un supermercado de España.
- Las cantidades en gramos deben ser coherentes con un plato normal (nada de 500 g de aceite, etc.).

Devuelve SOLO JSON (sin texto adicional) con esta estructura:

{
  "meal_type": "Desayuno" | "Comida" | "Cena" | "Merienda",
  "recipe_name": "Nombre del plato",
  "short_description": "Descripción breve, 2-3 frases, sin macros ni gramos.",
  "macros": {
    "protein_g": número (aprox),
    "fat_g": número (aprox),
    "carbs_g": número (aprox)
  },
  "ingredients": [
    {
      "name": "Nombre del ingrediente",
      "quantity_grams": número (en gramos),
      "notes": "Opcional: breve aclaración"
    }
  ],
  "steps": [
    "Paso 1...",
    "Paso 2..."
  ]
}
`.trim();

    const responseSchema = {
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
          },
          required: ['protein_g', 'fat_g', 'carbs_g']
        },
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity_grams: { type: 'number' },
              notes: { type: 'string' }
            },
            required: ['name', 'quantity_grams']
          }
        },
        steps: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['meal_type', 'recipe_name', 'macros', 'ingredients', 'steps']
    };

    const payload = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.45,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    let res;
    let result;
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
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (timedOut) {
        throw new Error('Timeout al llamar a Gemini');
      }
      throw err;
    }

    clearTimeout(timeoutId);
    result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result?.error?.message || `Error HTTP ${res.status}`;
      throw new Error(msg);
    }

    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = robustParse(rawText);

    if (!parsed || !isMealValid(parsed)) {
      throw new Error('Respuesta de Gemini no válida para meal');
    }

    // Sanitizar mínimamente
    return {
      meal_type: stripText(parsed.meal_type || meal_type || 'Comida'),
      recipe_name: stripText(parsed.recipe_name || 'Plato sugerido por Chef-Bot'),
      short_description: stripText(parsed.short_description || ''),
      macros: {
        protein_g: safeNumber(parsed.macros?.protein_g),
        fat_g: safeNumber(parsed.macros?.fat_g),
        carbs_g: safeNumber(parsed.macros?.carbs_g)
      },
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients
            .map((ing) => ({
              name: stripText(ing.name || ''),
              quantity_grams: safeNumber(ing.quantity_grams || ing.quantity || 0),
              notes: stripText(ing.notes || '')
            }))
            .filter((ing) => ing.name && ing.quantity_grams > 0)
        : [],
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((s) => stripText(s)).filter(Boolean)
        : []
    };
  }

  // --------- HANDLER PRINCIPAL ---------
  try {
    const body = JSON.parse(event.body || '{}');
    const mode = body.mode || 'day';
    const payload = body.payload || {};

    if (mode !== 'day') {
      // Ahora sólo soportamos 1 día
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'day',
          plan_name: 'Plan no disponible (modo no soportado)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...GLOBAL_DISCLAIMERS,
            'Chef-Bot ahora genera únicamente menús de 1 día. Actualiza tu llamada para usar mode: "day".'
          ]
        })
      };
    }

    const dailyMacros = payload.dailyMacros || {};
    const numMeals = clamp(parseInt(payload.numMeals, 10) || 3, 1, 4);
    const dietaryFilter = payload.dietaryFilter || '';
    const fridgeIngredients = payload.fridgeIngredients || '';
    const style = payload.style || 'mediterranea';

    const totalP = safeNumber(dailyMacros.protein_g);
    const totalF = safeNumber(dailyMacros.fat_g);
    const totalC = safeNumber(dailyMacros.carbs_g);

    if (!GEMINI_API_KEY) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'day',
          plan_name: 'Plan no disponible (configuración)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...GLOBAL_DISCLAIMERS,
            'Chef-Bot no está bien configurado en el servidor y ahora mismo no puede generar menús automáticos.',
            'Revisa la variable GEMINI_API_KEY en Netlify o contacta con el equipo si el problema persiste.',
            'Si quieres que te ayudemos a diseñar un menú adaptado, puedes escribirnos desde <a href="https://metabolismix.com/contacto/" target="_blank" rel="noopener noreferrer">https://metabolismix.com/contacto/</a>.'
          ]
        })
      };
    }

    if (totalP <= 0 || totalF <= 0 || totalC <= 0) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'day',
          plan_name: 'Plan no disponible (parámetros inválidos)',
          days: [],
          shopping_list: [],
          general_tips: [
            ...GLOBAL_DISCLAIMERS,
            'Introduce proteínas, grasas y carbohidratos objetivos mayores de 0 para poder generar un menú.',
            'Revisa los campos de macros en Chef-Bot y vuelve a intentarlo.'
          ]
        })
      };
    }

    // 1 día, varios slots (1-4 comidas)
    const slots = buildMealSlots(dailyMacros, numMeals);
    const meals = [];

    for (const slot of slots) {
      let meal;
      try {
        meal = await callGeminiForMeal(slot, dietaryFilter, fridgeIngredients);
      } catch (e) {
        // Si falla IA, usamos fallback determinista
        meal = buildFallbackMeal(slot);
      }
      if (!isMealValid(meal)) {
        // Último salvavidas
        meal = buildFallbackMeal(slot);
      }
      meals.push(meal);
    }

    // Calcular macros totales del día
    const totalDayMacros = meals.reduce(
      (acc, m) => {
        acc.protein_g += safeNumber(m.macros?.protein_g);
        acc.fat_g += safeNumber(m.macros?.fat_g);
        acc.carbs_g += safeNumber(m.macros?.carbs_g);
        return acc;
      },
      { protein_g: 0, fat_g: 0, carbs_g: 0 }
    );

    const day = {
      day_name: 'Día 1',
      total_macros: {
        protein_g: Math.round(totalDayMacros.protein_g),
        fat_g: Math.round(totalDayMacros.fat_g),
        carbs_g: Math.round(totalDayMacros.carbs_g)
      },
      meals
    };

    const days = [day];
    const shopping_list = mergeShoppingList(days);

    const tips = [
      ...GLOBAL_DISCLAIMERS,
      `Este menú ha sido generado combinando IA culinaria y lógica automática de Chef-Bot para aproximarse a tus macros diarios (${Math.round(
        totalP
      )} g proteína, ${Math.round(totalF)} g grasa, ${Math.round(totalC)} g hidratos).`,
      'Algunas comidas pueden haberse generado con un fallback interno si la IA no estaba disponible en el momento de la petición.',
      style === 'mediterranea'
        ? 'El estilo general del día intenta seguir la lógica de una alimentación mediterránea casera (verdura, proteína de calidad, cereales, aceite de oliva...).'
        : 'El menú está pensado como una combinación equilibrada y razonable de platos sencillos.'
    ];

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-chefbot-func-version': 'v3-chefbot-hybrid-2025-11-18'
      },
      body: JSON.stringify({
        mode: 'day',
        plan_name: 'Menú de 1 día generado por Chef-Bot',
        days,
        shopping_list,
        general_tips: tips
      })
    };
  } catch (error) {
    // Cualquier excepción interna
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'day',
        plan_name: 'Plan no disponible (error interno)',
        days: [],
        shopping_list: [],
        general_tips: [
          ...GLOBAL_DISCLAIMERS,
          'Ha ocurrido un problema interno al generar el menú.',
          'Prueba a recargar la página y repetir la petición. Si el problema persiste, revisa la consola de Netlify o contáctanos.',
          `Detalle técnico: ${String(error && error.message ? error.message : 'sin mensaje específico')}`
        ]
      })
    };
  }
};
