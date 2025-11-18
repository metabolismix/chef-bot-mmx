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

  // ======================================================
  //   MMX_FOOD_DB: REPOSITORIO DE ALIMENTOS POR 100 g
  //   (valores aproximados, orientativos, no clínicos)
  // ======================================================

  const MMX_FOOD_DB = {
    // ===== LÁCTEOS / PROTEÍNAS LÁCTEAS =====
    yogur_natural_0: {
      label: 'Yogur natural 0% (sin azúcar)',
      protein: 4,
      fat: 0,
      carbs: 4,
      cooked: false
    },
    yogur_entero: {
      label: 'Yogur natural entero',
      protein: 4,
      fat: 3,
      carbs: 5,
      cooked: false
    },
    yogur_skyr_natural: {
      label: 'Yogur tipo skyr natural',
      protein: 10,
      fat: 0,
      carbs: 4,
      cooked: false
    },
    queso_fresco_batido_0: {
      label: 'Queso fresco batido 0%',
      protein: 8,
      fat: 0,
      carbs: 4,
      cooked: false
    },
    queso_fresco_burgos: {
      label: 'Queso fresco tipo Burgos',
      protein: 14,
      fat: 10,
      carbs: 3,
      cooked: false
    },
    queso_manchego_curado: {
      label: 'Queso manchego curado',
      protein: 25,
      fat: 33,
      carbs: 1,
      cooked: false
    },
    queso_semicurado: {
      label: 'Queso semicurado',
      protein: 24,
      fat: 28,
      carbs: 1,
      cooked: false
    },
    leche_entera: {
      label: 'Leche entera',
      protein: 3,
      fat: 4,
      carbs: 5,
      cooked: false
    },
    leche_semidesnatada: {
      label: 'Leche semidesnatada',
      protein: 3,
      fat: 2,
      carbs: 5,
      cooked: false
    },
    leche_desnatada: {
      label: 'Leche desnatada',
      protein: 3,
      fat: 0,
      carbs: 5,
      cooked: false
    },

    // ===== CEREALES Y DERIVADOS =====
    copos_avena: {
      label: 'Copos de avena',
      protein: 13,
      fat: 7,
      carbs: 60,
      cooked: false
    },
    pan_blanco: {
      label: 'Pan blanco',
      protein: 9,
      fat: 3,
      carbs: 52,
      cooked: false
    },
    pan_integral: {
      label: 'Pan integral',
      protein: 9,
      fat: 4,
      carbs: 45,
      cooked: false
    },
    pan_centeno: {
      label: 'Pan de centeno',
      protein: 8,
      fat: 2,
      carbs: 48,
      cooked: false
    },
    arroz_blanco_crudo: {
      label: 'Arroz blanco (crudo)',
      protein: 7,
      fat: 1,
      carbs: 78,
      cooked: false
    },
    arroz_blanco_cocido: {
      label: 'Arroz blanco cocido',
      protein: 2,
      fat: 0,
      carbs: 28,
      cooked: true
    },
    arroz_integral_cocido: {
      label: 'Arroz integral cocido',
      protein: 3,
      fat: 1,
      carbs: 23,
      cooked: true
    },
    pasta_blanca_cocida: {
      label: 'Pasta blanca cocida',
      protein: 5,
      fat: 1,
      carbs: 30,
      cooked: true
    },
    pasta_integral_cocida: {
      label: 'Pasta integral cocida',
      protein: 5,
      fat: 2,
      carbs: 30,
      cooked: true
    },
    cuscus_cocido: {
      label: 'Cuscús cocido',
      protein: 3,
      fat: 0,
      carbs: 23,
      cooked: true
    },
    quinoa_cocida: {
      label: 'Quinoa cocida',
      protein: 4,
      fat: 2,
      carbs: 21,
      cooked: true
    },
    galletas_maria: {
      label: 'Galletas tipo María',
      protein: 7,
      fat: 12,
      carbs: 70,
      cooked: true
    },

    // ===== LEGUMBRES =====
    garbanzos_cocidos: {
      label: 'Garbanzos cocidos (escurridos)',
      protein: 8,
      fat: 2,
      carbs: 20,
      cooked: true
    },
    lentejas_cocidas: {
      label: 'Lentejas cocidas (escurridas)',
      protein: 8,
      fat: 1,
      carbs: 18,
      cooked: true
    },
    judias_blancas_cocidas: {
      label: 'Judías blancas cocidas (escurridas)',
      protein: 7,
      fat: 1,
      carbs: 14,
      cooked: true
    },
    judias_verdes_cocidas: {
      label: 'Judías verdes cocidas',
      protein: 2,
      fat: 0,
      carbs: 4,
      cooked: true
    },
    alubias_rojas_cocidas: {
      label: 'Alubias rojas cocidas',
      protein: 8,
      fat: 1,
      carbs: 18,
      cooked: true
    },
    hummus: {
      label: 'Hummus',
      protein: 7,
      fat: 15,
      carbs: 10,
      cooked: true
    },

    // ===== CARNE / PESCADO / HUEVO / VEGETALES PROTEICOS =====
    pechuga_pollo: {
      label: 'Pechuga de pollo (sin piel, cruda)',
      protein: 22,
      fat: 2,
      carbs: 0,
      cooked: false
    },
    muslo_pollo: {
      label: 'Muslo de pollo (sin piel, crudo)',
      protein: 19,
      fat: 6,
      carbs: 0,
      cooked: false
    },
    pavo_magra: {
      label: 'Pavo magro (crudo)',
      protein: 22,
      fat: 2,
      carbs: 0,
      cooked: false
    },
    ternera_magra: {
      label: 'Ternera magra (cruda)',
      protein: 21,
      fat: 5,
      carbs: 0,
      cooked: false
    },
    cerdo_magra: {
      label: 'Carne de cerdo magra',
      protein: 21,
      fat: 8,
      carbs: 0,
      cooked: false
    },
    jamon_serrano: {
      label: 'Jamón serrano',
      protein: 30,
      fat: 15,
      carbs: 0,
      cooked: false
    },
    jamon_cocido: {
      label: 'Jamón cocido',
      protein: 18,
      fat: 7,
      carbs: 2,
      cooked: false
    },
    chorizo: {
      label: 'Chorizo',
      protein: 24,
      fat: 35,
      carbs: 2,
      cooked: false
    },
    lomo_embuchado: {
      label: 'Lomo embuchado',
      protein: 30,
      fat: 15,
      carbs: 1,
      cooked: false
    },
    albondigas_magra_cocinadas: {
      label: 'Albóndigas de carne magra (cocinadas)',
      protein: 18,
      fat: 10,
      carbs: 5,
      cooked: true
    },
    salmon: {
      label: 'Salmón',
      protein: 20,
      fat: 13,
      carbs: 0,
      cooked: false
    },
    pescado_blanco: {
      label: 'Pescado blanco (merluza, bacalao fresco...)',
      protein: 18,
      fat: 1,
      carbs: 0,
      cooked: false
    },
    atun_lata_natural: {
      label: 'Atún en lata al natural (escurrido)',
      protein: 24,
      fat: 1,
      carbs: 0,
      cooked: true
    },
    atun_lata_aceite: {
      label: 'Atún en lata en aceite (escurrido)',
      protein: 24,
      fat: 8,
      carbs: 0,
      cooked: true
    },
    sardinas_lata: {
      label: 'Sardinas en lata',
      protein: 22,
      fat: 12,
      carbs: 0,
      cooked: true
    },
    gambas_cocidas: {
      label: 'Gambas cocidas',
      protein: 20,
      fat: 1,
      carbs: 1,
      cooked: true
    },
    huevo_cocido: {
      label: 'Huevo cocido',
      protein: 13,
      fat: 11,
      carbs: 1,
      cooked: true
    },
    huevo_entero: {
      label: 'Huevo entero crudo',
      protein: 12,
      fat: 11,
      carbs: 1,
      cooked: false
    },
    clara_huevo: {
      label: 'Clara de huevo',
      protein: 11,
      fat: 0,
      carbs: 1,
      cooked: false
    },
    tofu_firme: {
      label: 'Tofu firme',
      protein: 14,
      fat: 8,
      carbs: 3,
      cooked: false
    },

    // ===== FRUTOS SECOS / SEMILLAS / GRASAS =====
    frutos_secos_mixtos: {
      label: 'Frutos secos mixtos (nuez/almendra/avellana)',
      protein: 20,
      fat: 50,
      carbs: 15,
      cooked: false
    },
    almendras: {
      label: 'Almendras',
      protein: 21,
      fat: 52,
      carbs: 9,
      cooked: false
    },
    nueces: {
      label: 'Nueces',
      protein: 15,
      fat: 65,
      carbs: 7,
      cooked: false
    },
    pistachos: {
      label: 'Pistachos',
      protein: 20,
      fat: 50,
      carbs: 18,
      cooked: false
    },
    cacahuetes: {
      label: 'Cacahuetes tostados',
      protein: 25,
      fat: 49,
      carbs: 16,
      cooked: false
    },
    crema_cacahuete: {
      label: 'Crema de cacahuete',
      protein: 25,
      fat: 50,
      carbs: 20,
      cooked: false
    },
    semillas_chia: {
      label: 'Semillas de chía',
      protein: 17,
      fat: 31,
      carbs: 42,
      cooked: false
    },
    semillas_sesamo: {
      label: 'Semillas de sésamo',
      protein: 18,
      fat: 49,
      carbs: 12,
      cooked: false
    },
    aceite_oliva: {
      label: 'Aceite de oliva virgen extra',
      protein: 0,
      fat: 100,
      carbs: 0,
      cooked: false
    },
    aceite_girasol: {
      label: 'Aceite de girasol',
      protein: 0,
      fat: 100,
      carbs: 0,
      cooked: false
    },
    aguacate: {
      label: 'Aguacate',
      protein: 2,
      fat: 15,
      carbs: 9,
      cooked: false
    },
    aceitunas_verdes: {
      label: 'Aceitunas verdes',
      protein: 1,
      fat: 15,
      carbs: 4,
      cooked: false
    },

    // ===== FRUTA =====
    fruta_mixta: {
      label: 'Fruta troceada mixta (plátano/manzana/frutos rojos)',
      protein: 1,
      fat: 0,
      carbs: 14,
      cooked: false
    },
    platano: {
      label: 'Plátano',
      protein: 1,
      fat: 0,
      carbs: 20,
      cooked: false
    },
    manzana: {
      label: 'Manzana',
      protein: 0,
      fat: 0,
      carbs: 14,
      cooked: false
    },
    pera: {
      label: 'Pera',
      protein: 0,
      fat: 0,
      carbs: 12,
      cooked: false
    },
    naranja: {
      label: 'Naranja',
      protein: 1,
      fat: 0,
      carbs: 12,
      cooked: false
    },
    mandarina: {
      label: 'Mandarina',
      protein: 1,
      fat: 0,
      carbs: 13,
      cooked: false
    },
    kiwi: {
      label: 'Kiwi',
      protein: 1,
      fat: 1,
      carbs: 15,
      cooked: false
    },
    frutos_rojos: {
      label: 'Frutos rojos',
      protein: 1,
      fat: 0,
      carbs: 10,
      cooked: false
    },
    uvas: {
      label: 'Uvas',
      protein: 0,
      fat: 0,
      carbs: 17,
      cooked: false
    },
    pina: {
      label: 'Piña',
      protein: 0,
      fat: 0,
      carbs: 12,
      cooked: false
    },
    melon: {
      label: 'Melón',
      protein: 1,
      fat: 0,
      carbs: 8,
      cooked: false
    },
    sandia: {
      label: 'Sandía',
      protein: 1,
      fat: 0,
      carbs: 8,
      cooked: false
    },

    // ===== VERDURAS / HORTALIZAS =====
    brocoli: {
      label: 'Brócoli',
      protein: 3,
      fat: 0,
      carbs: 7,
      cooked: false
    },
    calabacin: {
      label: 'Calabacín',
      protein: 1,
      fat: 0,
      carbs: 3,
      cooked: false
    },
    berenjena: {
      label: 'Berenjena',
      protein: 1,
      fat: 0,
      carbs: 6,
      cooked: false
    },
    pimiento_rojo: {
      label: 'Pimiento rojo',
      protein: 1,
      fat: 0,
      carbs: 6,
      cooked: false
    },
    pimiento_verde: {
      label: 'Pimiento verde',
      protein: 1,
      fat: 0,
      carbs: 4,
      cooked: false
    },
    cebolla: {
      label: 'Cebolla',
      protein: 1,
      fat: 0,
      carbs: 10,
      cooked: false
    },
    tomate: {
      label: 'Tomate',
      protein: 1,
      fat: 0,
      carbs: 4,
      cooked: false
    },
    zanahoria: {
      label: 'Zanahoria',
      protein: 1,
      fat: 0,
      carbs: 9,
      cooked: false
    },
    espinaca: {
      label: 'Espinaca fresca',
      protein: 3,
      fat: 0,
      carbs: 2,
      cooked: false
    },
    lechuga: {
      label: 'Lechuga',
      protein: 1,
      fat: 0,
      carbs: 2,
      cooked: false
    },
    mezclum_ensalada: {
      label: 'Ensalada verde (mezclum)',
      protein: 2,
      fat: 0,
      carbs: 3,
      cooked: false
    },
    coliflor: {
      label: 'Coliflor',
      protein: 2,
      fat: 0,
      carbs: 5,
      cooked: false
    },
    champinones: {
      label: 'Champiñones',
      protein: 3,
      fat: 0,
      carbs: 3,
      cooked: false
    },
    patata: {
      label: 'Patata',
      protein: 2,
      fat: 0,
      carbs: 17,
      cooked: false
    },
    boniato: {
      label: 'Boniato',
      protein: 2,
      fat: 0,
      carbs: 20,
      cooked: false
    },
    pepino: {
      label: 'Pepino',
      protein: 1,
      fat: 0,
      carbs: 3,
      cooked: false
    },

    // ===== OTROS HABITUALES =====
    azucar_blanco: {
      label: 'Azúcar blanco',
      protein: 0,
      fat: 0,
      carbs: 100,
      cooked: false
    },
    miel: {
      label: 'Miel',
      protein: 0,
      fat: 0,
      carbs: 82,
      cooked: false
    },
    chocolate_negro_70: {
      label: 'Chocolate negro 70%',
      protein: 7,
      fat: 43,
      carbs: 46,
      cooked: false
    },
    tomate_frito: {
      label: 'Tomate frito (industrial)',
      protein: 2,
      fat: 5,
      carbs: 10,
      cooked: true
    },
    mayonesa: {
      label: 'Mayonesa',
      protein: 1,
      fat: 75,
      carbs: 1,
      cooked: false
    },
    salsa_soja: {
      label: 'Salsa de soja',
      protein: 8,
      fat: 0,
      carbs: 4,
      cooked: false
    }
  };

  // Mapeo de nombres de ingredientes en recetas -> claves de MMX_FOOD_DB
  const NAME_TO_FOOD_KEY = {
    // Lácteos / yogur / queso
    'yogur natural o tipo skyr': 'yogur_skyr_natural',
    'yogur tipo skyr': 'yogur_skyr_natural',
    'yogur natural 0%': 'yogur_natural_0',
    'yogur natural': 'yogur_natural_0',
    'queso fresco batido': 'queso_fresco_batido_0',
    'queso fresco tipo burgos': 'queso_fresco_burgos',

    // Cereales
    'copos de avena': 'copos_avena',
    'pan integral': 'pan_integral',
    'pasta integral cocida': 'pasta_integral_cocida',
    'pasta integral': 'pasta_integral_cocida',
    'arroz integral cocido': 'arroz_integral_cocido',
    'arroz blanco cocido': 'arroz_blanco_cocido',

    // Proteínas animales / legumbre
    'pechuga de pollo': 'pechuga_pollo',
    'lomo de salmón': 'salmon',
    'filete de pescado blanco': 'pescado_blanco',
    'albóndigas de carne magra (pavo o ternera magra)':
      'albondigas_magra_cocinadas',
    'atún al natural o en aceite escurrido': 'atun_lata_natural',
    'garbanzos cocidos': 'garbanzos_cocidos',
    'lentejas cocidas': 'lentejas_cocidas',
    'huevo cocido': 'huevo_cocido',
    'huevo': 'huevo_entero',

    // Fruta / frutos secos / semillas
    'fruta troceada (plátano, manzana o frutos rojos)': 'fruta_mixta',
    'fruta troceada': 'fruta_mixta',
    'fruta troceada mixta': 'fruta_mixta',
    'frutos secos (nueces o almendras)': 'frutos_secos_mixtos',
    'semillas (chía o sésamo)': 'semillas_chia',

    // Verduras / ensaladas
    'brócoli': 'brocoli',
    'calabacín': 'calabacin',
    'berenjena': 'berenjena',
    'pimiento rojo': 'pimiento_rojo',
    'cebolla': 'cebolla',
    'tomate triturado o rallado': 'tomate',
    'tomate': 'tomate',
    'zanahoria rallada': 'zanahoria',
    'zanahoria': 'zanahoria',
    'ensalada verde (mezclum)': 'mezclum_ensalada',
    'lechuga o mezclum': 'mezclum_ensalada',
    'judías verdes': 'judias_verdes_cocidas',
    'patata': 'patata',

    // Grasas
    'aceite de oliva virgen extra': 'aceite_oliva',
    'aceitunas negras o verdes': 'aceitunas_verdes'
  };

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
    'Las macros de cada plato se han estimado a partir de un repositorio interno de alimentos por 100 g; pueden diferir ligeramente de otras tablas de composición.',
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
      'x-chefbot-func-version': versionTag || 'v4-chefbot-2025-11-18'
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

  // ---------- MACROS PARA CADA COMIDA (DISTRIBUCIÓN TEÓRICA) ----------
  function computePerMealMacroTargets() {
    let weights;
    switch (numMealsRequested) {
      case 1:
        weights = [1];
        break;
      case 2:
        weights = [0.55, 0.45];
        break;
      case 3:
        weights = [0.25, 0.45, 0.30];
        break;
      case 4:
      default:
        weights = [0.2, 0.4, 0.1, 0.3];
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
        p = Math.max(0, targetProtein - accP);
        f = Math.max(0, targetFat - accF);
        c = Math.max(0, targetCarbs - accC);
      }

      accP += p;
      accF += f;
      accC += c;

      perMeal.push({ protein_g: p, fat_g: f, carbs_g: c });
    }
    return perMeal;
  }

  // ---------- AYUDA: RESOLVER INGREDIENTE -> ENTRADA BBDD ----------
  function resolveFoodKeyFromName(name) {
    if (!name || typeof name !== 'string') return null;
    const n = name.toLowerCase().trim();

    // 1) Alias explícitos
    for (const [alias, key] of Object.entries(NAME_TO_FOOD_KEY)) {
      if (n.includes(alias)) return key;
    }

    // 2) Coincidencia por label aproximado
    for (const [key, entry] of Object.entries(MMX_FOOD_DB)) {
      const labelNorm = (entry.label || '').toLowerCase();
      if (!labelNorm) continue;
      if (n === labelNorm || n.includes(labelNorm) || labelNorm.includes(n)) {
        return key;
      }
    }
    return null;
  }

  function computeMealMacrosFromIngredients(meal) {
    const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
    let p = 0;
    let f = 0;
    let c = 0;
    let matchedCount = 0;

    for (const ing of ingredients) {
      const qty = safeNumber(ing.quantity_grams, 0);
      if (qty <= 0) continue;
      const key = resolveFoodKeyFromName(ing.name);
      if (!key) continue;

      const food = MMX_FOOD_DB[key];
      if (!food) continue;

      const factor = qty / 100;
      p += food.protein * factor;
      f += food.fat * factor;
      c += food.carbs * factor;
      matchedCount++;
    }

    if (!matchedCount) {
      return { protein_g: 0, fat_g: 0, carbs_g: 0, matchedCount: 0 };
    }

    return {
      protein_g: Math.round(p),
      fat_g: Math.round(f),
      carbs_g: Math.round(c),
      matchedCount
    };
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
          {
            name: 'Queso fresco tipo burgos',
            quantity_grams: 60,
            notes: ''
          },
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
    return chooseRandom(list) || list[0];
  }

  function pickLunchFromFallback() {
    let list = lunchTemplates();
    if (!list.length) return null;

    const prefs = [
      { token: 'albondig', ids: ['comida_albondigas_arroz'] },
      { token: 'salmon', ids: ['comida_salmon_patat'] },
      { token: 'atun', ids: ['comida_pasta_atun'] },
      { token: 'garbanzo', ids: ['comida_garbanzo_ensalada'] },
      { token: 'lentej', ids: ['comida_garbanzo_ensalada'] },
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
    const perMealTargets = computePerMealMacroTargets();
    const meals = [];

    function attachMacros(meal, defaultTargets) {
      const m = { ...meal };
      const fromRepo = computeMealMacrosFromIngredients(m);
      const sumRepo =
        fromRepo.protein_g + fromRepo.fat_g + fromRepo.carbs_g;

      if (sumRepo > 0 && fromRepo.matchedCount > 0) {
        m.macros = {
          protein_g: fromRepo.protein_g,
          fat_g: fromRepo.fat_g,
          carbs_g: fromRepo.carbs_g
        };
      } else {
        m.macros = {
          protein_g: defaultTargets.protein_g,
          fat_g: defaultTargets.fat_g,
          carbs_g: defaultTargets.carbs_g
        };
      }
      m.source = 'fallback';
      return m;
    }

    if (numMealsRequested === 1) {
      const m = pickLunchFromFallback();
      if (m) meals.push(attachMacros(m, perMealTargets[0]));
    } else if (numMealsRequested === 2) {
      const l = pickLunchFromFallback();
      const d = pickDinnerFromFallback();
      if (l) meals.push(attachMacros(l, perMealTargets[0]));
      if (d) meals.push(attachMacros(d, perMealTargets[1]));
    } else if (numMealsRequested === 3) {
      const b = pickBreakfastFromFallback();
      const l = pickLunchFromFallback();
      const d = pickDinnerFromFallback();
      if (b) meals.push(attachMacros(b, perMealTargets[0]));
      if (l) meals.push(attachMacros(l, perMealTargets[1]));
      if (d) meals.push(attachMacros(d, perMealTargets[2]));
    } else {
      const b = pickBreakfastFromFallback();
      const l = pickLunchFromFallback();
      const s = pickSnackFromFallback();
      const d = pickDinnerFromFallback();
      if (b) meals.push(attachMacros(b, perMealTargets[0]));
      if (l) meals.push(attachMacros(l, perMealTargets[1]));
      if (s) meals.push(attachMacros(s, perMealTargets[2]));
      if (d) meals.push(attachMacros(d, perMealTargets[3]));
    }

    // Macros totales reales (según ingredientes/tabla)
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
    tips.push(
      `Las macros totales estimadas para este menú son: ${Math.round(
        total_macros.protein_g
      )} g de proteína, ${Math.round(
        total_macros.fat_g
      )} g de grasa y ${Math.round(
        total_macros.carbs_g
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
    return buildResponse(plan, 'v4-chefbot-fallback-no-key');
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
          "meal_type": string,
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
      const reason = `error API (${res.status})`;
      const plan = buildFallbackDayPlan(reason);
      return buildResponse(plan, 'v4-chefbot-fallback-api-error');
    }

    apiJson = raw ? JSON.parse(raw) : {};
  } catch (err) {
    const reason =
      err && err.name === 'AbortError'
        ? 'timeout al llamar a la IA'
        : 'error de red al llamar a la IA';
    const plan = buildFallbackDayPlan(reason);
    return buildResponse(plan, 'v4-chefbot-fallback-timeout');
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
    return buildResponse(plan, 'v4-chefbot-fallback-invalid-json');
  }

  const day0 = parsed.days[0];
  const meals = day0.meals.map((m) => ({
    ...m,
    source: 'ai'
  }));

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
      ...extraTips
    ]
  };

  return buildResponse(planFromAi, 'v4-chefbot-ai-ok');
};
