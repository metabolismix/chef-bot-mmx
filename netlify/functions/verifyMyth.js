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
  const CONTACT_URL = 'https://metabolismix.com/contacto/';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const safeNumber = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };

  const baseNutritionTips = () => [
    'Este menú es orientativo y no sustituye el consejo de un profesional sanitario ni de un dietista-nutricionista.',
    'Si tienes patologías, medicación crónica, TCA, embarazo u otras situaciones clínicas, consulta siempre con un profesional antes de seguir cualquier pauta alimentaria.',
    'Las cantidades, macros y raciones son aproximadas y deben adaptarse a tu contexto, tolerancias digestivas y sensación de hambre/saciedad.',
    'Si tienes dudas sobre cómo adaptar este menú a tu caso, puedes escribirnos desde ' +
      `<a href="${CONTACT_URL}" target="_blank" rel="noopener noreferrer">${CONTACT_URL}</a>.`
  ];

  const normalizeFridgeTokens = (text) => {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .split(/[^a-záéíóúüñ]+/i)
      .map((t) => t.trim())
      .filter(Boolean);
  };

  const hasToken = (tokens, fragment) =>
    tokens.some((t) => t.includes(fragment));

  const chooseRandom = (arr) =>
    Array.isArray(arr) && arr.length
      ? arr[Math.floor(Math.random() * arr.length)]
      : null;

  const stripFences = (t) => {
    if (!t || typeof t !== 'string') return '';
    let x = t.trim();
    if (x.startsWith('```')) {
      x = x.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    }
    return x.trim();
  };

  const robustParseJSON = (text) => {
    if (!text || typeof text !== 'string') return null;
    const t = stripFences(text);

    // 1) Intento directo
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

    // 3) Buscar primer bloque { ... } balanceado
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

  const buildResponse = (planObject, versionTag) => ({
    statusCode: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'x-chefbot-func-version': versionTag || 'v3-chefbot-2025-11-18'
    },
    body: JSON.stringify(planObject)
  });

  // ---------- PARSE DEL BODY ----------
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    body = {};
  }

  const mode = body.mode || 'day';
  const payload = body.payload || {};

  const dailyMacros = payload.dailyMacros || {};
  const targetProtein = safeNumber(dailyMacros.protein_g, 150);
  const targetFat = safeNumber(dailyMacros.fat_g, 60);
  const targetCarbs = safeNumber(dailyMacros.carbs_g, 180);

  const numMealsRequested = clamp(
    parseInt(payload.numMeals, 10) || 3,
    1,
    4
  );
  const dietaryFilter = (payload.dietaryFilter || '').trim();
  const fridgeText = (payload.fridgeIngredients || '').trim();
  const fridgeTokens = normalizeFridgeTokens(fridgeText);

  // ---------- MACROS PARA CADA COMIDA (FALLBACK) ----------
  function computePerMealMacros() {
    // Distribuciones simples orientativas
    let weights;
    switch (numMealsRequested) {
      case 1:
        weights = [1];
        break;
      case 2:
        weights = [0.55, 0.45]; // comida, cena
        break;
      case 3:
        weights = [0.25, 0.45, 0.30]; // desayuno, comida, cena
        break;
      case 4:
      default:
        weights = [0.20, 0.40, 0.10, 0.30]; // desayuno, comida, snack, cena
        break;
    }

    const perMeal = [];
    let accP = 0;
    let accF = 0;
    let accC = 0;

    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      const isLast = i === weights.length - 1;
      let p = Math.round(targetProtein * w);
      let f = Math.round(targetFat * w);
      let c = Math.round(targetCarbs * w);

      if (isLast) {
        // Ajuste final para que la suma se acerque a los objetivos
        p = Math.max(0, targetProtein - accP);
        f = Math.max(0, targetFat - accF);
        c = Math.max(0, targetCarbs - accC);
      }

      accP += p;
      accF += f;
      accC += c;

      perMeal.push({
        protein_g: p,
        fat_g: f,
        carbs_g: c
      });
    }
    return perMeal;
  }

  // ---------- CARTA FALLBACK (PLANTILLAS) ----------
  function breakfastTemplates() {
    return [
      {
        id: 'desayuno_yogur_avena',
        meal_type: 'Desayuno',
        recipe_name: 'Bol de yogur con avena, fruta y frutos secos',
        short_description:
          'Desayuno tipo mediterráneo con lácteos, cereal integral, fruta y un toque de grasa saludable.',
        ingredients: [
          {
            name: 'Yogur natural o tipo skyr',
            quantity_grams: 180,
            notes: 'Sin azúcar añadido'
          },
          {
            name: 'Copos de avena',
            quantity_grams: 40,
            notes: ''
          },
          {
            name: 'Fruta troceada (plátano, manzana o frutos rojos)',
            quantity_grams: 80,
            notes: ''
          },
          {
            name: 'Frutos secos (nueces o almendras)',
            quantity_grams: 15,
            notes: 'Picados'
          }
        ],
        steps: [
          'Sirve el yogur en un bol.',
          'Añade los copos de avena y mezcla ligeramente.',
          'Incorpora la fruta troceada por encima.',
          'Termina con los frutos secos picados. Puedes añadir canela si te gusta.'
        ]
      },
      {
        id: 'desayuno_tostada_huevo',
        meal_type: 'Desayuno',
        recipe_name: 'Tostadas integrales con huevo y tomate',
        short_description:
          'Desayuno salado sencillo con pan integral, proteína de calidad y tomate.',
        ingredients: [
          {
            name: 'Pan integral',
            quantity_grams: 70,
            notes: 'Preferiblemente de masa madre'
          },
          {
            name: 'Huevo',
            quantity_grams: 60,
            notes: 'Mediano'
          },
          {
            name: 'Tomate triturado o rallado',
            quantity_grams: 80,
            notes: 'Sin azúcar añadido'
          },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 5,
            notes: 'Un chorrito'
          }
        ],
        steps: [
          'Tuesta el pan integral.',
          'Cocina el huevo a la plancha, revuelto o cocido.',
          'Unta el tomate sobre las tostadas.',
          'Coloca el huevo encima y aliña con el aceite de oliva y sal al gusto.'
        ]
      }
    ];
  }

  function lunchTemplates() {
    return [
      {
        id: 'comida_pollo_arroz',
        meal_type: 'Comida',
        recipe_name:
          'Bol de pollo con arroz integral, brócoli y verduras salteadas',
        short_description:
          'Plato de un solo bol con proteína, cereal integral y verduras variadas.',
        ingredients: [
          {
            name: 'Pechuga de pollo',
            quantity_grams: 200,
            notes: 'En dados o tiras'
          },
          {
            name: 'Arroz integral cocido',
            quantity_grams: 150,
            notes: ''
          },
          {
            name: 'Brócoli',
            quantity_grams: 120,
            notes: 'En ramilletes'
          },
          { name: 'Cebolla', quantity_grams: 40, notes: 'Picada' },
          { name: 'Pimiento rojo', quantity_grams: 40, notes: 'En tiras' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 10,
            notes: 'Para cocinar y aliñar'
          }
        ],
        steps: [
          'Cocina el arroz integral siguiendo las instrucciones del envase.',
          'En una sartén, sofríe la cebolla y el pimiento con parte del aceite.',
          'Añade el pollo troceado y cocina hasta que esté bien hecho.',
          'Incorpora el brócoli (salteado o al vapor) y mezcla todo.',
          'Sirve el arroz en la base y coloca el salteado de pollo y verduras por encima. Aliña con el aceite restante.'
        ]
      },
      {
        id: 'comida_salmon_patat',
        meal_type: 'Comida',
        recipe_name: 'Salmón al horno con patata y judías verdes',
        short_description:
          'Plato de pescado azul con tubérculo y verdura, muy típico de un patrón mediterráneo.',
        ingredients: [
          { name: 'Lomo de salmón', quantity_grams: 170, notes: '' },
          { name: 'Patata', quantity_grams: 180, notes: 'En rodajas o dados' },
          {
            name: 'Judías verdes',
            quantity_grams: 120,
            notes: 'Frescas o congeladas'
          },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 10,
            notes: 'Para hornear y aliñar'
          },
          { name: 'Limón', quantity_grams: 20, notes: 'Opcional, en zumo' }
        ],
        steps: [
          'Precalienta el horno a 180–200 °C.',
          'Coloca la patata troceada en una bandeja con parte del aceite y sal. Hornea unos minutos.',
          'Añade el salmón y las judías verdes a la bandeja, aliña con el resto del aceite y el limón.',
          'Hornea hasta que el salmón esté hecho y las verduras tiernas.',
          'Sirve todo junto en un plato.'
        ]
      },
      {
        id: 'comida_pasta_atun',
        meal_type: 'Comida',
        recipe_name: 'Pasta integral con atún, tomate y aceitunas',
        short_description:
          'Plato único de pasta con proteína y verduras, tipo ensalada templada.',
        ingredients: [
          { name: 'Pasta integral', quantity_grams: 80, notes: 'En seco' },
          {
            name: 'Atún al natural o en aceite escurrido',
            quantity_grams: 100,
            notes: ''
          },
          { name: 'Tomate', quantity_grams: 80, notes: 'En trocitos' },
          { name: 'Cebolla', quantity_grams: 30, notes: 'Muy picada' },
          {
            name: 'Aceitunas negras o verdes',
            quantity_grams: 20,
            notes: 'Troceadas'
          },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para aliñar'
          }
        ],
        steps: [
          'Cuece la pasta integral al dente.',
          'Mientras tanto, mezcla en un bol el atún desmigado, el tomate, la cebolla y las aceitunas.',
          'Escurre la pasta y mézclala con el resto de ingredientes.',
          'Aliña con el aceite de oliva y ajusta de sal y especias al gusto.'
        ]
      },
      {
        id: 'comida_albondigas_arroz',
        meal_type: 'Comida',
        recipe_name:
          'Albóndigas de carne magra con arroz integral y ensalada de tomate',
        short_description:
          'Versión casera de albóndigas con guarnición sencilla de cereal integral y ensalada.',
        ingredients: [
          {
            name: 'Albóndigas de carne magra (pavo o ternera magra)',
            quantity_grams: 180,
            notes: 'Ya formadas o caseras'
          },
          {
            name: 'Arroz integral cocido',
            quantity_grams: 150,
            notes: ''
          },
          { name: 'Tomate', quantity_grams: 100, notes: 'En rodajas o dados' },
          { name: 'Lechuga o mezclum', quantity_grams: 40, notes: '' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 10,
            notes: 'Para cocinar y aliñar'
          }
        ],
        steps: [
          'Cocina las albóndigas a la plancha o en una sartén con un poco de aceite hasta que estén hechas por dentro.',
          'Calienta o cocina el arroz integral.',
          'Prepara una ensalada con el tomate y la lechuga, aliñada con parte del aceite.',
          'Sirve las albóndigas junto al arroz y acompaña con la ensalada.'
        ]
      },
      {
        id: 'comida_garbanzo_ensalada',
        meal_type: 'Comida',
        recipe_name: 'Ensalada templada de garbanzos con verduras y huevo',
        short_description:
          'Plato de legumbre tipo ensalada templada, con verdura y algo de proteína extra.',
        ingredients: [
          {
            name: 'Garbanzos cocidos',
            quantity_grams: 160,
            notes: 'Escurridos y aclarados'
          },
          { name: 'Pimiento rojo', quantity_grams: 40, notes: 'En tiras' },
          { name: 'Cebolla', quantity_grams: 30, notes: 'Picada fina' },
          { name: 'Tomate', quantity_grams: 80, notes: 'En dados' },
          { name: 'Huevo cocido', quantity_grams: 60, notes: 'En trozos' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para aliñar'
          }
        ],
        steps: [
          'Enjuaga los garbanzos y escúrrelos bien.',
          'Mezcla los garbanzos con el pimiento, la cebolla y el tomate.',
          'Añade el huevo cocido troceado.',
          'Aliña con el aceite de oliva, sal y especias al gusto.'
        ]
      }
    ];
  }

  function dinnerTemplates() {
    return [
      {
        id: 'cena_lentejas_verduras',
        meal_type: 'Cena',
        recipe_name: 'Bol de lentejas estofadas con verduras y ensalada verde',
        short_description:
          'Plato caliente de legumbre con verduras y un pequeño acompañamiento de ensalada.',
        ingredients: [
          {
            name: 'Lentejas cocidas',
            quantity_grams: 250,
            notes: 'Escurridas'
          },
          { name: 'Cebolla', quantity_grams: 40, notes: 'Picada' },
          { name: 'Pimiento rojo', quantity_grams: 40, notes: 'En tiras' },
          { name: 'Tomate', quantity_grams: 60, notes: 'Trocitos o triturado' },
          {
            name: 'Zanahoria',
            quantity_grams: 40,
            notes: 'En rodajas finas (opcional)'
          },
          {
            name: 'Ensalada verde (mezclum)',
            quantity_grams: 40,
            notes: 'Para acompañar'
          },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 6,
            notes: 'Para sofreír y aliñar'
          }
        ],
        steps: [
          'En una cazuela, sofríe la cebolla y el pimiento con parte del aceite.',
          'Añade la zanahoria y el tomate, y cocina unos minutos.',
          'Incorpora las lentejas cocidas y deja que se calienten a fuego suave.',
          'Sirve las lentejas en un bol y acompaña con la ensalada verde aliñada con el resto del aceite.'
        ]
      },
      {
        id: 'cena_tortilla_ensalada',
        meal_type: 'Cena',
        recipe_name: 'Tortilla de huevos con patata ligera y ensalada verde',
        short_description:
          'Cena clásica de tortilla con una ración moderada de patata y ensalada.',
        ingredients: [
          { name: 'Huevo', quantity_grams: 120, notes: '2 medianos' },
          { name: 'Patata', quantity_grams: 120, notes: 'En láminas finas' },
          {
            name: 'Cebolla',
            quantity_grams: 30,
            notes: 'Opcional, muy picada'
          },
          {
            name: 'Ensalada verde (mezclum)',
            quantity_grams: 50,
            notes: 'Para acompañar'
          },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para cocinar y aliñar'
          }
        ],
        steps: [
          'Pocha la patata (y la cebolla si la usas) en una sartén con parte del aceite a fuego suave.',
          'Bate los huevos y mézclalos con la patata escurrida de exceso de aceite.',
          'Cuaja la tortilla en la sartén por ambos lados.',
          'Sirve una ración de tortilla acompañada de ensalada verde aliñada.'
        ]
      },
      {
        id: 'cena_pescado_verduras',
        meal_type: 'Cena',
        recipe_name: 'Pescado blanco a la plancha con calabacín y berenjena',
        short_description:
          'Cena ligera con proteína magra y verdura a la plancha.',
        ingredients: [
          { name: 'Filete de pescado blanco', quantity_grams: 160, notes: '' },
          { name: 'Calabacín', quantity_grams: 80, notes: 'En rodajas' },
          { name: 'Berenjena', quantity_grams: 80, notes: 'En rodajas' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para la plancha'
          }
        ],
        steps: [
          'Corta el calabacín y la berenjena en rodajas.',
          'Cocina las verduras a la plancha con parte del aceite.',
          'En la misma plancha o sartén, cocina el pescado blanco con el resto del aceite.',
          'Sirve el pescado acompañado de las verduras a la plancha.'
        ]
      },
      {
        id: 'cena_pollo_ensalada',
        meal_type: 'Cena',
        recipe_name: 'Pollo a la plancha con ensalada completa',
        short_description:
          'Cena sencilla a base de pollo a la plancha y ensalada con verduras variadas.',
        ingredients: [
          { name: 'Pechuga de pollo', quantity_grams: 150, notes: 'En filetes' },
          {
            name: 'Ensalada verde (mezclum)',
            quantity_grams: 60,
            notes: ''
          },
          { name: 'Tomate', quantity_grams: 60, notes: 'En dados o rodajas' },
          { name: 'Zanahoria', quantity_grams: 30, notes: 'Rallada' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para cocinar y aliñar'
          }
        ],
        steps: [
          'Cocina la pechuga de pollo a la plancha con parte del aceite.',
          'Prepara una ensalada con el mezclum, el tomate y la zanahoria.',
          'Aliña la ensalada con el resto del aceite y ajusta de sal.',
          'Sirve el pollo junto a la ensalada.'
        ]
      },
      {
        id: 'cena_albondigas_verduras',
        meal_type: 'Cena',
        recipe_name: 'Albóndigas de carne magra con verduras salteadas',
        short_description:
          'Cena con albóndigas acompañadas de un salteado ligero de verduras.',
        ingredients: [
          {
            name: 'Albóndigas de carne magra (pavo o ternera magra)',
            quantity_grams: 160,
            notes: ''
          },
          { name: 'Calabacín', quantity_grams: 70, notes: 'En dados' },
          { name: 'Pimiento rojo', quantity_grams: 40, notes: 'En tiras' },
          { name: 'Cebolla', quantity_grams: 30, notes: 'Picada' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 8,
            notes: 'Para saltear y terminar'
          }
        ],
        steps: [
          'Cocina las albóndigas en una sartén con parte del aceite hasta que estén bien hechas.',
          'En otra sartén, saltea el calabacín, el pimiento y la cebolla con el resto del aceite.',
          'Sirve las albóndigas acompañadas del salteado de verduras.'
        ]
      }
    ];
  }

  function snackTemplates() {
    return [
      {
        id: 'snack_yogur_fruta',
        meal_type: 'Merienda / Snack',
        recipe_name: 'Yogur con fruta troceada y semillas',
        short_description:
          'Pequeño snack proteico con lácteo y fruta para completar el día.',
        ingredients: [
          { name: 'Yogur natural', quantity_grams: 120, notes: '' },
          { name: 'Fruta troceada', quantity_grams: 60, notes: '' },
          { name: 'Semillas (chía o sésamo)', quantity_grams: 5, notes: '' }
        ],
        steps: [
          'Sirve el yogur en un bol.',
          'Añade la fruta troceada.',
          'Espolvorea las semillas por encima.'
        ]
      },
      {
        id: 'snack_tostada_queso',
        meal_type: 'Merienda / Snack',
        recipe_name: 'Tostada integral con queso fresco y tomate',
        short_description:
          'Snack sencillo de pan integral con lácteo fresco y verdura.',
        ingredients: [
          { name: 'Pan integral', quantity_grams: 40, notes: '' },
          { name: 'Queso fresco tipo burgos', quantity_grams: 60, notes: '' },
          { name: 'Tomate', quantity_grams: 40, notes: 'En rodajas' },
          {
            name: 'Aceite de oliva virgen extra',
            quantity_grams: 3,
            notes: 'Un chorrito'
          }
        ],
        steps: [
          'Tuesta ligeramente el pan integral.',
          'Coloca el queso fresco y el tomate encima.',
          'Aliña con un poco de aceite de oliva.'
        ]
      }
    ];
  }

  // ---------- SELECCIÓN DE PLATO FALLBACK CON NEVERA ----------
  function pickBreakfastFromFallback() {
    const list = breakfastTemplates();
    // Para desayunos no forzamos nevera; mantenemos platos tipo estándar.
    return chooseRandom(list) || list[0];
  }

  function pickLunchFromFallback() {
    let list = lunchTemplates();
    if (!list.length) return null;

    // Preferencias según nevera
    const prefs = [
      { token: 'albondig', ids: ['comida_albondigas_arroz'] },
      { token: 'salmon', ids: ['comida_salmon_patat'] },
      { token: 'atun', ids: ['comida_pasta_atun'] },
      { token: 'garbanzo', ids: ['comida_garbanzo_ensalada'] },
      { token: 'lentej', ids: ['comida_garbanzo_ensalada'] }, // legumbre alternativa
      { token: 'pollo', ids: ['comida_pollo_arroz'] }
    ];

    for (const pref of prefs) {
      if (hasToken(fridgeTokens, pref.token)) {
        const filtered = list.filter((m) => pref.ids.includes(m.id));
        if (filtered.length) return chooseRandom(filtered);
      }
    }

    return chooseRandom(list) || list[0];
  }

  function pickDinnerFromFallback() {
    let list = dinnerTemplates();
    if (!list.length) return null;

    const prefs = [
      { token: 'albondig', ids: ['cena_albondigas_verduras'] },
      { token: 'salmon', ids: ['cena_pescado_verduras'] },
      { token: 'merluza', ids: ['cena_pescado_verduras'] },
      { token: 'pescad', ids: ['cena_pescado_verduras'] },
      { token: 'lentej', ids: ['cena_lentejas_verduras'] },
      { token: 'pollo', ids: ['cena_pollo_ensalada'] },
      { token: 'huevo', ids: ['cena_tortilla_ensalada'] }
    ];

    for (const pref of prefs) {
      if (hasToken(fridgeTokens, pref.token)) {
        const filtered = list.filter((m) => pref.ids.includes(m.id));
        if (filtered.length) return chooseRandom(filtered);
      }
    }

    return chooseRandom(list) || list[0];
  }

  function pickSnackFromFallback() {
    const list = snackTemplates();
    return chooseRandom(list) || list[0];
  }

  // ---------- CONSTRUCCIÓN DEL PLAN FALLBACK COMPLETO ----------
  function buildFallbackDayPlan(technicalReason) {
    const perMealMacros = computePerMealMacros();
    const meals = [];

    if (numMealsRequested === 1) {
      // Solo una comida principal (tipo comida)
      const m = pickLunchFromFallback();
      if (m) {
        meals.push({
          ...m,
          source: 'fallback',
          macros: perMealMacros[0]
        });
      }
    } else if (numMealsRequested === 2) {
      const lunch = pickLunchFromFallback();
      const dinner = pickDinnerFromFallback();
      if (lunch) {
        meals.push({
          ...lunch,
          source: 'fallback',
          macros: perMealMacros[0]
        });
      }
      if (dinner) {
        meals.push({
          ...dinner,
          source: 'fallback',
          macros: perMealMacros[1]
        });
      }
    } else if (numMealsRequested === 3) {
      const b = pickBreakfastFromFallback();
      const l = pickLunchFromFallback();
      const d = pickDinnerFromFallback();
      if (b) {
        meals.push({
          ...b,
          source: 'fallback',
          macros: perMealMacros[0]
        });
      }
      if (l) {
        meals.push({
          ...l,
          source: 'fallback',
          macros: perMealMacros[1]
        });
      }
      if (d) {
        meals.push({
          ...d,
          source: 'fallback',
          macros: perMealMacros[2]
        });
      }
    } else {
      // 4 comidas: desayuno, comida, snack, cena
      const b = pickBreakfastFromFallback();
      const l = pickLunchFromFallback();
      const s = pickSnackFromFallback();
      const d = pickDinnerFromFallback();
      if (b) {
        meals.push({
          ...b,
          source: 'fallback',
          macros: perMealMacros[0]
        });
      }
      if (l) {
        meals.push({
          ...l,
          source: 'fallback',
          macros: perMealMacros[1]
        });
      }
      if (s) {
        meals.push({
          ...s,
          source: 'fallback',
          macros: perMealMacros[2]
        });
      }
      if (d) {
        meals.push({
          ...d,
          source: 'fallback',
          macros: perMealMacros[3]
        });
      }
    }

    // Recalcular macros totales a partir de los de cada comida
    const total_macros = meals.reduce(
      (acc, m) => {
        const mm = m.macros || {};
        acc.protein_g += safeNumber(mm.protein_g, 0);
        acc.fat_g += safeNumber(mm.fat_g, 0);
        acc.carbs_g += safeNumber(mm.carbs_g, 0);
        return acc;
      },
      { protein_g: 0, fat_g: 0, carbs_g: 0 }
    );

    // Lista de la compra
    const shopping_map = new Map();
    for (const meal of meals) {
      const ings = Array.isArray(meal.ingredients) ? meal.ingredients : [];
      for (const ing of ings) {
        const key = ing.name;
        const qty = safeNumber(ing.quantity_grams, 0);
        if (!key || qty <= 0) continue;
        shopping_map.set(key, (shopping_map.get(key) || 0) + qty);
      }
    }
    const shopping_list = [];
    for (const [name, qty] of shopping_map.entries()) {
      shopping_list.push(`${Math.round(qty)} g de ${name}`);
    }

    const tips = baseNutritionTips();
    if (technicalReason) {
      tips.push(
        'Este menú se ha generado usando el modo automático de Chef-Bot sin depender totalmente de la IA (motivo técnico: ' +
          technicalReason +
          ').'
      );
    }
    tips.push(
      `Los objetivos diarios introducidos eran aproximadamente: ${Math.round(
        targetProtein
      )} g de proteína, ${Math.round(
        targetFat
      )} g de grasa y ${Math.round(
        targetCarbs
      )} g de hidratos de carbono.`
    );

    if (fridgeText) {
      tips.push(
        `Se ha intentado tener en cuenta algunos de los ingredientes de tu nevera: "${fridgeText}".`
      );
    }

    return {
      mode: 'day',
      plan_name: 'Menú de 1 día generado por Chef-Bot',
      days: [
        {
          day_name: 'Menú del día',
          total_macros,
          meals
        }
      ],
      shopping_list,
      general_tips: tips
    };
  }

  // ---------- SI NO HAY API KEY → FALLBACK DIRECTO ----------
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    const plan = buildFallbackDayPlan('configuración: falta GEMINI_API_KEY');
    return buildResponse(plan, 'v3-chefbot-fallback-no-key');
  }

// ---------- LLAMADA A GEMINI ----------
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;


  const systemPrompt = `
Eres un planificador de menús diarios orientativos, no un profesional sanitario.
Tu tarea es generar UN MENÚ DE 1 DÍA en formato JSON para una persona adulta sana,
ajustando lo máximo posible los macros diarios indicados.

Reglas importantes:
- El menú es genérico y nunca sustituye el consejo de un profesional sanitario o un dietista-nutricionista.
- Ajusta los macros de cada comida de forma que el total del día se acerque lo más posible a los objetivos indicados (proteínas, grasas, hidratos).
- Estilo preferente: patrón mediterráneo casero (verdura, legumbre, cereales integrales, proteína de calidad, aceite de oliva…).
- Si fridgeIngredients NO está vacío, al menos una de las comidas (preferentemente COMIDA o CENA) debe usar explícitamente uno de esos ingredientes como principal o acompañamiento,
  salvo que vaya contra restricciones dietéticas de forma coherente con los hábitos habituales de la gente (por ejemplo, no pongas carne roja en el desayuno).
- Puedes inventar platos nuevos siempre que sean realistas y conocidos o razonables dentro de un contexto mediterráneo.
- No des consejos médicos ni ajustes farmacológicos. No menciones enfermedades, tratamientos ni pruebas diagnósticas.

Formato de salida (JSON plano, sin texto extra):
{
  "mode": "day",
  "plan_name": string,
  "days": [
    {
      "day_name": string,
      "total_macros": { "protein_g": number, "fat_g": number, "carbs_g": number },
      "meals": [
        {
          "meal_type": string,        // p.ej. "Desayuno", "Comida", "Cena", "Merienda / Snack"
          "recipe_name": string,
          "short_description": string,
          "macros": { "protein_g": number, "fat_g": number, "carbs_g": number },
          "ingredients": [
            { "name": string, "quantity_grams": number, "notes": string }
          ],
          "steps": [ string, ... ],
          "source": "ai"
        }
      ]
    }
  ],
  "shopping_list": [ string, ... ],
  "general_tips": [ string, ... ]
}

Devuelve ÚNICAMENTE ese JSON, sin explicaciones alrededor.
`;

  const userPrompt = `
Objetivos diarios aproximados:
- Proteína: ~${Math.round(targetProtein)} g
- Grasas: ~${Math.round(targetFat)} g
- Hidratos: ~${Math.round(targetCarbs)} g

Número de comidas deseado: ${numMealsRequested}.
Restricciones dietéticas o preferencias declaradas: ${
    dietaryFilter || 'no especificadas'
  }.
Ingredientes disponibles en la nevera (puedes usarlos si encajan): ${
    fridgeText || 'no especificados'
  }.

Genera un único menú de 1 día que siga las reglas anteriores y el formato JSON indicado.
`;

  const TIMEOUT_MS = Math.min(
    parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10),
    9500
  );

  let apiJson;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 900
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const raw = await res.text();
    if (!res.ok) {
      // Si Gemini responde con error (incluyendo 503), pasamos a fallback
      const reason = `error API (${res.status})`;
      const plan = buildFallbackDayPlan(reason);
      return buildResponse(plan, 'v3-chefbot-fallback-api-error');
    }

    apiJson = raw ? JSON.parse(raw) : {};
  } catch (err) {
    const reason =
      err && err.name === 'AbortError'
        ? 'timeout al llamar a la IA'
        : 'error de red al llamar a la IA';
    const plan = buildFallbackDayPlan(reason);
    return buildResponse(plan, 'v3-chefbot-fallback-timeout');
  }

  // ---------- NORMALIZACIÓN DE LA RESPUESTA IA ----------
  const textCandidate =
    apiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = robustParseJSON(textCandidate);

  const tipsBase = baseNutritionTips();

  if (
    !parsed ||
    !Array.isArray(parsed.days) ||
    !parsed.days.length ||
    !Array.isArray(parsed.days[0].meals) ||
    !parsed.days[0].meals.length
  ) {
    const plan = buildFallbackDayPlan('respuesta IA no válida o vacía');
    return buildResponse(plan, 'v3-chefbot-fallback-invalid-json');
  }

  // Aseguramos campos mínimos y añadimos source: "ai" a cada comida
  const day0 = parsed.days[0];
  const meals = day0.meals.map((m) => ({
    ...m,
    source: 'ai'
  }));

  // Recalcular totales si faltan o son incoherentes
  const total_macros = meals.reduce(
    (acc, m) => {
      const mm = m.macros || {};
      acc.protein_g += safeNumber(mm.protein_g, 0);
      acc.fat_g += safeNumber(mm.fat_g, 0);
      acc.carbs_g += safeNumber(mm.carbs_g, 0);
      return acc;
    },
    { protein_g: 0, fat_g: 0, carbs_g: 0 }
  );

  const dayNormalized = {
    day_name: day0.day_name || 'Menú del día',
    total_macros: {
      protein_g: total_macros.protein_g,
      fat_g: total_macros.fat_g,
      carbs_g: total_macros.carbs_g
    },
    meals
  };

  // Lista de la compra (por si el modelo no la ha calculado bien)
  const shopping_map = new Map();
  for (const meal of meals) {
    const ings = Array.isArray(meal.ingredients) ? meal.ingredients : [];
    for (const ing of ings) {
      const key = ing.name;
      const qty = safeNumber(ing.quantity_grams, 0);
      if (!key || qty <= 0) continue;
      shopping_map.set(key, (shopping_map.get(key) || 0) + qty);
    }
  }
  const shopping_list = [];
  for (const [name, qty] of shopping_map.entries()) {
    shopping_list.push(`${Math.round(qty)} g de ${name}`);
  }

  const extraTips = Array.isArray(parsed.general_tips)
    ? parsed.general_tips.filter((t) => typeof t === 'string' && t.trim())
    : [];

  const planFromAi = {
    mode: 'day',
    plan_name:
      parsed.plan_name || 'Menú de 1 día generado por Chef-Bot con IA',
    days: [dayNormalized],
    shopping_list: shopping_list.length
      ? shopping_list
      : parsed.shopping_list || [],
    general_tips: [
      ...tipsBase,
      `Los objetivos diarios introducidos eran aproximadamente: ${Math.round(
        targetProtein
      )} g de proteína, ${Math.round(
        targetFat
      )} g de grasa y ${Math.round(
        targetCarbs
      )} g de hidratos de carbono.`,
      ...(fridgeText
        ? [
            `Se ha intentado utilizar al menos uno de los ingredientes de tu nevera en alguna de las comidas: "${fridgeText}".`
          ]
        : []),
      ...extraTips
    ]
  };

  return buildResponse(planFromAi, 'v3-chefbot-ai-ok');
};



