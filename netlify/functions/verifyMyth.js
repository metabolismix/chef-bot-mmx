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

  // ---------- HELPERS GENERALES ----------
  const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const clampInt = (v, min, max) => Math.round(clamp(v, min, max));
  const gramsFromMacro = (macroTarget, per100g) => {
    if (!per100g || per100g <= 0) return 0;
    return (macroTarget * 100) / per100g;
  };

  const stripCodeFences = (text) => {
    let t = (text || '').trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    }
    return t.trim();
  };

  const robustParseJSON = (text) => {
    if (!text) return null;
    const t = text.trim();
    // 1) Intento directo
    try {
      return JSON.parse(t);
    } catch {}

    // 2) Si empieza por [, probar array
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object') {
          return arr[0];
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

  // ---------- TABLA DE ALIMENTOS BÁSICOS (MEDITERRÁNEOS) ----------
  const BASE_FOODS = {
    chicken: {
      id: 'chicken',
      name: 'Pechuga de pollo',
      macrosPer100g: { protein_g: 22, fat_g: 3, carbs_g: 0 }
    },
    turkey: {
      id: 'turkey',
      name: 'Pavo',
      macrosPer100g: { protein_g: 24, fat_g: 2, carbs_g: 0 }
    },
    salmon: {
      id: 'salmon',
      name: 'Salmón',
      macrosPer100g: { protein_g: 20, fat_g: 13, carbs_g: 0 }
    },
    tuna: {
      id: 'tuna',
      name: 'Atún en conserva al natural',
      macrosPer100g: { protein_g: 23, fat_g: 1, carbs_g: 0 }
    },
    eggs: {
      id: 'eggs',
      name: 'Huevo',
      macrosPer100g: { protein_g: 13, fat_g: 11, carbs_g: 1 }
    },
    eggwhites: {
      id: 'eggwhites',
      name: 'Clara de huevo',
      macrosPer100g: { protein_g: 11, fat_g: 0, carbs_g: 1 }
    },
    yogurt: {
      id: 'yogurt',
      name: 'Yogur natural',
      macrosPer100g: { protein_g: 5, fat_g: 3, carbs_g: 4.5 }
    },
    cottage: {
      id: 'cottage',
      name: 'Queso fresco batido / requesón',
      macrosPer100g: { protein_g: 8, fat_g: 4, carbs_g: 4 }
    },
    oats: {
      id: 'oats',
      name: 'Copos de avena',
      macrosPer100g: { protein_g: 13, fat_g: 7, carbs_g: 60 }
    },
    rice: {
      id: 'rice',
      name: 'Arroz integral cocido',
      macrosPer100g: { protein_g: 2.5, fat_g: 0.3, carbs_g: 28 }
    },
    pasta: {
      id: 'pasta',
      name: 'Pasta integral cocida',
      macrosPer100g: { protein_g: 6, fat_g: 1.5, carbs_g: 30 }
    },
    bread: {
      id: 'bread',
      name: 'Pan integral',
      macrosPer100g: { protein_g: 9, fat_g: 3, carbs_g: 45 }
    },
    chickpeas: {
      id: 'chickpeas',
      name: 'Garbanzos cocidos',
      macrosPer100g: { protein_g: 7, fat_g: 2, carbs_g: 20 }
    },
    lentils: {
      id: 'lentils',
      name: 'Lentejas cocidas',
      macrosPer100g: { protein_g: 8, fat_g: 0.8, carbs_g: 18 }
    },
    broccoli: {
      id: 'broccoli',
      name: 'Brócoli',
      macrosPer100g: { protein_g: 3, fat_g: 0.4, carbs_g: 7 }
    },
    tomato: {
      id: 'tomato',
      name: 'Tomate',
      macrosPer100g: { protein_g: 1, fat_g: 0.2, carbs_g: 3 }
    },
    courgette: {
      id: 'courgette',
      name: 'Calabacín',
      macrosPer100g: { protein_g: 1.2, fat_g: 0.3, carbs_g: 3 }
    },
    pepper: {
      id: 'pepper',
      name: 'Pimiento rojo',
      macrosPer100g: { protein_g: 1.3, fat_g: 0.3, carbs_g: 6 }
    },
    onion: {
      id: 'onion',
      name: 'Cebolla',
      macrosPer100g: { protein_g: 1.1, fat_g: 0.1, carbs_g: 9 }
    },
    salad: {
      id: 'salad',
      name: 'Ensalada verde (mezclum)',
      macrosPer100g: { protein_g: 1.5, fat_g: 0.2, carbs_g: 3 }
    },
    banana: {
      id: 'banana',
      name: 'Plátano',
      macrosPer100g: { protein_g: 1.2, fat_g: 0.3, carbs_g: 23 }
    },
    apple: {
      id: 'apple',
      name: 'Manzana',
      macrosPer100g: { protein_g: 0.3, fat_g: 0.2, carbs_g: 14 }
    },
    oliveOil: {
      id: 'oliveOil',
      name: 'Aceite de oliva virgen extra',
      macrosPer100g: { protein_g: 0, fat_g: 100, carbs_g: 0 }
    },
    nuts: {
      id: 'nuts',
      name: 'Frutos secos (nueces/almendras)',
      macrosPer100g: { protein_g: 18, fat_g: 55, carbs_g: 13 }
    },
    potato: {
      id: 'potato',
      name: 'Patata cocida',
      macrosPer100g: { protein_g: 2, fat_g: 0.1, carbs_g: 17 }
    }
  };

  // ---------- FALLBACK DETERMINISTA (DESAYUNO / COMIDA / CENA) ----------
  function buildFallbackMeal(slot) {
    const { meal_type, target_macros } = slot || {};
    const P = safeNumber(target_macros?.protein_g);
    const F = safeNumber(target_macros?.fat_g);
    const C = safeNumber(target_macros?.carbs_g);

    const label = meal_type || '';
    const isBreakfast = /desayuno/i.test(label);
    const isSnack = /merienda/i.test(label);
    const isLunch = /comida/i.test(label);
    const isDinner = /cena/i.test(label);

    let ingredients = [];
    let macros = { protein_g: 0, fat_g: 0, carbs_g: 0 };
    let recipe_name;
    let steps;

    // --- Desayuno / Merienda: bol de yogur + avena + plátano ---
    if (isBreakfast || isSnack) {
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

      return {
        meal_type: meal_type || 'Desayuno',
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

    // --- Comida: pollo + arroz integral + brócoli + aceite ---
    if (isLunch || (!isDinner && !isBreakfast && !isSnack)) {
      const p100 = BASE_FOODS.chicken.macrosPer100g;
      const r100 = BASE_FOODS.rice.macrosPer100g;
      const b100 = BASE_FOODS.broccoli.macrosPer100g;
      const o100 = BASE_FOODS.oliveOil.macrosPer100g;

      const chickenGr = clamp(gramsFromMacro(P * 0.75, p100.protein_g), 120, 230);
      const riceGr = clamp(gramsFromMacro(C * 0.7, r100.carbs_g), 80, 220);
      const broccoliGr = clamp(120, 60, 180);
      const oilGr = clamp(F, 5, 15);

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

    // --- Cena: salmón + patata + brócoli + aceite ---
    const s100 = BASE_FOODS.salmon.macrosPer100g;
    const p100 = BASE_FOODS.potato.macrosPer100g;
    const b100 = BASE_FOODS.broccoli.macrosPer100g;
    const o100 = BASE_FOODS.oliveOil.macrosPer100g;

    const salmonGr = clamp(gramsFromMacro(P * 0.75, s100.protein_g), 120, 220);
    const potatoGr = clamp(gramsFromMacro(C * 0.7, p100.carbs_g), 120, 260);
    const broccoliGr = clamp(100, 60, 180);
    const oilGr = clamp(F, 5, 15);

    macros.protein_g =
      (s100.protein_g * salmonGr) / 100 +
      (p100.protein_g * potatoGr) / 100 +
      (b100.protein_g * broccoliGr) / 100;
    macros.fat_g =
      (s100.fat_g * salmonGr) / 100 +
      (p100.fat_g * potatoGr) / 100 +
      (b100.fat_g * broccoliGr) / 100 +
      (o100.fat_g * oilGr) / 100;
    macros.carbs_g =
      (s100.carbs_g * salmonGr) / 100 +
      (p100.carbs_g * potatoGr) / 100 +
      (b100.carbs_g * broccoliGr) / 100;

    ingredients = [
      { name: 'Salmón', quantity_grams: Math.round(salmonGr), notes: 'Lomo o filete' },
      { name: 'Patata cocida', quantity_grams: Math.round(potatoGr), notes: 'En dados o rodajas' },
      { name: 'Brócoli', quantity_grams: Math.round(broccoliGr), notes: 'En ramilletes' },
      { name: 'Aceite de oliva virgen extra', quantity_grams: Math.round(oilGr), notes: 'Para cocinar y aliñar' }
    ];

    recipe_name = 'Salmón con patata y brócoli al horno';
    steps = [
      'Precalienta el horno a unos 180–200 ºC.',
      'Coloca el salmón en una bandeja con parte del aceite, sal y las especias que prefieras.',
      'Añade la patata cocida troceada y el brócoli alrededor, rocía con el resto del aceite y mezcla ligeramente.',
      'Hornea hasta que el salmón esté hecho y las verduras ligeramente doradas.'
    ];

    return {
      meal_type: meal_type || 'Cena',
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

  // ---------- ¿ES VÁLIDA UNA COMIDA DEVUELTA POR LA IA? ----------
  function isValidMealObject(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.meal_type || !obj.recipe_name) return false;
    if (!obj.macros || typeof obj.macros !== 'object') return false;
    if (!Array.isArray(obj.ingredients) || !obj.ingredients.length) return false;
    if (!Array.isArray(obj.steps) || !obj.steps.length) return false;
    if (
      !Number.isFinite(Number(obj.macros.protein_g)) ||
      !Number.isFinite(Number(obj.macros.fat_g)) ||
      !Number.isFinite(Number(obj.macros.carbs_g))
    ) {
      return false;
    }
    return true;
  }

  // ---------- LLAMADA A GEMINI PARA UNA COMIDA ----------
  async function callGeminiForMeal(slot, apiKey, model, timeoutMs) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const { meal_type, target_macros, dietaryFilter, fridgeIngredients, style } = slot;
    const P = safeNumber(target_macros?.protein_g);
    const F = safeNumber(target_macros?.fat_g);
    const C = safeNumber(target_macros?.carbs_g);

    const styleLabel = style || 'mediterránea';

    const prompt = `
Eres un asistente CULINARIO (no médico). 
Tu tarea es proponer UNA sola receta sencilla estilo ${styleLabel}, apta para una persona adulta sana, a partir de estos objetivos aproximados de macronutrientes:

- Proteína objetivo: ~${Math.round(P)} g
- Grasas objetivo: ~${Math.round(F)} g
- Hidratos objetivo: ~${Math.round(C)} g

Tipo de comida: "${meal_type || 'Comida'}".

Restricciones dietéticas declaradas por el usuario (texto libre, NO es consejo médico): "${dietaryFilter || 'ninguna específica'}".

Ingredientes en la nevera (texto libre, úsalo solo como guía si ayuda): "${fridgeIngredients || 'no especificado'}".

REGLAS IMPORTANTES:
- No des consejos médicos ni nutricionales personalizados.
- No menciones enfermedades, medicación, TCA, embarazo ni ajustes clínicos.
- El menú es general y orientativo, para población adulta sana.
- Devuelve SOLO un objeto JSON válido, sin texto adicional, sin comentarios y SIN bloques de código.
- Usa cantidades en GRAMOS enteros para los ingredientes.
- Mantén la receta casera, corta y realista.

ESQUEMA JSON QUE DEBES DEVOLVER, SIN NINGÚN TEXTO MÁS:

{
  "meal_type": "Desayuno" | "Comida" | "Merienda" | "Cena",
  "recipe_name": "string",
  "short_description": "string (1–2 frases, aclarando que es orientativo y no sustituye consejo profesional)",
  "macros": {
    "protein_g": number,
    "fat_g": number,
    "carbs_g": number
  },
  "ingredients": [
    {
      "name": "string",
      "quantity_grams": number,
      "notes": "string"
    }
  ],
  "steps": [
    "string",
    "string"
  ]
}
`.trim();

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 512
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Gemini error: ${msg}`);
    }

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text.trim()) {
      throw new Error('Gemini devolvió texto vacío');
    }

    const cleaned = stripCodeFences(text);
    const obj = robustParseJSON(cleaned);

    if (!isValidMealObject(obj)) {
      throw new Error('Gemini devolvió JSON no válido para comida');
    }

    return obj;
  }

  // ---------- CONSTRUCCIÓN DE SLOTS DE COMIDAS ----------
  function buildMealSlots(numMeals, dailyMacros) {
    const P = safeNumber(dailyMacros.protein_g);
    const F = safeNumber(dailyMacros.fat_g);
    const C = safeNumber(dailyMacros.carbs_g);

    const slots = [];

    if (numMeals === 1) {
      slots.push({
        meal_type: 'Comida',
        target_macros: { protein_g: P, fat_g: F, carbs_g: C }
      });
      return slots;
    }

    if (numMeals === 2) {
      slots.push({
        meal_type: 'Comida',
        target_macros: { protein_g: P * 0.55, fat_g: F * 0.55, carbs_g: C * 0.55 }
      });
      slots.push({
        meal_type: 'Cena',
        target_macros: { protein_g: P * 0.45, fat_g: F * 0.45, carbs_g: C * 0.45 }
      });
      return slots;
    }

    if (numMeals === 3) {
      slots.push({
        meal_type: 'Desayuno',
        target_macros: { protein_g: P * 0.25, fat_g: F * 0.25, carbs_g: C * 0.25 }
      });
      slots.push({
        meal_type: 'Comida',
        target_macros: { protein_g: P * 0.45, fat_g: F * 0.45, carbs_g: C * 0.45 }
      });
      slots.push({
        meal_type: 'Cena',
        target_macros: { protein_g: P * 0.30, fat_g: F * 0.30, carbs_g: C * 0.30 }
      });
      return slots;
    }

    // numMeals === 4
    slots.push({
      meal_type: 'Desayuno',
      target_macros: { protein_g: P * 0.20, fat_g: F * 0.20, carbs_g: C * 0.20 }
    });
    slots.push({
      meal_type: 'Comida',
      target_macros: { protein_g: P * 0.40, fat_g: F * 0.40, carbs_g: C * 0.40 }
    });
    slots.push({
      meal_type: 'Merienda',
      target_macros: { protein_g: P * 0.15, fat_g: F * 0.15, carbs_g: C * 0.15 }
    });
    slots.push({
      meal_type: 'Cena',
      target_macros: { protein_g: P * 0.25, fat_g: F * 0.25, carbs_g: C * 0.25 }
    });

    return slots;
  }

  // ---------- GENERAR UNA COMIDA (IA + FALLBACK) ----------
  async function generateMealWithAIOrFallback(slot, apiKey, model, timeoutMs) {
    // Si no hay API key, vamos directo a fallback “bonito”
    if (!apiKey) {
      return buildFallbackMeal(slot);
    }

    try {
      const aiMeal = await callGeminiForMeal(slot, apiKey, model, timeoutMs);
      if (isValidMealObject(aiMeal)) {
        // Normalización mínima
        aiMeal.meal_type = aiMeal.meal_type || slot.meal_type;
        aiMeal.short_description =
          aiMeal.short_description ||
          'Plato generado con ayuda de IA de forma orientativa. No sustituye el consejo de un profesional sanitario.';
        return aiMeal;
      }
      // Si por lo que sea no pasa la validación, caemos a fallback
      return buildFallbackMeal(slot);
    } catch (err) {
      // Cualquier error de red, timeout, políticas, formato... → fallback
      return buildFallbackMeal(slot);
    }
  }

  // ---------- AGREGAR LISTA DE LA COMPRA ----------
  function buildShoppingList(meals) {
    const map = new Map();
    for (const meal of meals) {
      const ings = Array.isArray(meal.ingredients) ? meal.ingredients : [];
      for (const ing of ings) {
        const name = ing.name || '';
        const q = safeNumber(ing.quantity_grams);
        if (!name || !q) continue;
        const prev = map.get(name) || 0;
        map.set(name, prev + q);
      }
    }
    return Array.from(map.entries()).map(
      ([name, total]) => `${Math.round(total)} g de ${name}`
    );
  }

  // ---------- LÓGICA PRINCIPAL ----------
  try {
    const body = JSON.parse(event.body || '{}');
    const mode = body.mode || 'day';
    const payload = body.payload || {};

    const dailyMacros = payload.dailyMacros || {};
    const numMeals = clampInt(payload.numMeals || 3, 1, 4);
    const dietaryFilter = payload.dietaryFilter || '';
    const fridgeIngredients = payload.fridgeIngredients || '';
    const style = payload.style || 'mediterránea';

    const P = safeNumber(dailyMacros.protein_g);
    const F = safeNumber(dailyMacros.fat_g);
    const C = safeNumber(dailyMacros.carbs_g);

    if (P <= 0 || F <= 0 || C <= 0) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Macros diarios no válidos. Asegúrate de introducir proteína, grasas e hidratos mayores que 0.'
        })
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '12000', 10);

    // Construir slots de comidas
    const slots = buildMealSlots(numMeals, { protein_g: P, fat_g: F, carbs_g: C });

    // Generar cada comida (IA + fallback)
    const meals = [];
    for (const slot of slots) {
      const fullSlot = {
        ...slot,
        dietaryFilter,
        fridgeIngredients,
        style
      };
      const meal = await generateMealWithAIOrFallback(
        fullSlot,
        GEMINI_API_KEY,
        GEMINI_MODEL,
        GEMINI_TIMEOUT_MS
      );
      meals.push(meal);
    }

    // Construir plan final tipo "día"
    const shopping_list = buildShoppingList(meals);

    const general_tips = [
      'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
      'Si tienes patologías, medicación crónica, TCA, embarazo u otras situaciones clínicas, consulta siempre con un profesional antes de seguir cualquier pauta alimentaria.',
      `Este menú intenta aproximarse a tus macros diarios (~${Math.round(
        P
      )} g proteína, ~${Math.round(F)} g grasa, ~${Math.round(C)} g hidratos) mediante una combinación de IA y lógica automática de Chef-Bot.`,
      'Algunas comidas pueden haberse generado con un fallback interno cuando la IA no estaba disponible o la respuesta no era válida.',
      'El estilo general del día intenta seguir una alimentación mediterránea casera (verdura, proteína de calidad, cereales, legumbre, aceite de oliva...).'
    ];

    const plan = {
      mode: mode === 'day' ? 'day' : 'day',
      plan_name: 'Menú de 1 día generado por Chef-Bot',
      days: [
        {
          day_name: 'Día 1',
          total_macros: {
            protein_g: Math.round(P),
            fat_g: Math.round(F),
            carbs_g: Math.round(C)
          },
          meals
        }
      ],
      shopping_list,
      general_tips
    };

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan)
    };
  } catch (err) {
    const fallbackPlan = {
      mode: 'day',
      plan_name: 'Plan no disponible (error interno)',
      days: [],
      shopping_list: [],
      general_tips: [
        'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
        'Ha ocurrido un error interno al generar el menú con Chef-Bot.',
        'Revisa la configuración de la función en Netlify o vuelve a intentarlo en unos minutos.',
        'Si quieres que te ayudemos a diseñar un menú adaptado, puedes escribirnos desde https://metabolismix.com/contacto/.'
      ]
    };

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackPlan)
    };
  }
};
