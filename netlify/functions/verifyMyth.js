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

  // Utilidad para fabricar una respuesta "bonita" estándar
  const makeCardResponse = (card) => {
    const safe = {
      myth: card.myth || '',
      isTrue: !!card.isTrue,
      explanation_simple: card.explanation_simple || '',
      explanation_expert: card.explanation_expert || '',
      evidenceLevel: card.evidenceLevel || 'Baja',
      sources: Array.isArray(card.sources) ? card.sources : [],
      category: card.category || '',
      relatedMyths: Array.isArray(card.relatedMyths) ? card.relatedMyths : []
    };
    const text = JSON.stringify(safe);
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
        'x-mmx-func-version': 'v10-all-safe-2025-11-17'
      },
      body: JSON.stringify(result)
    };
  };

  try {
    // ---------- INPUT ----------
    let parsedBody;
    try {
      parsedBody = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Cuerpo JSON inválido. Envía un JSON con el campo "userQuery".'
        })
      };
    }

    const userQuery = parsedBody.userQuery;

    if (!userQuery || typeof userQuery !== 'string') {
      // Aquí sí dejamos 400 porque es un bug de cliente, no del modelo
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetro "userQuery" requerido.' })
      };
    }

    // Soportamos tanto GEMINI_API_KEY como GOOGLE_API_KEY (tu caso)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      // Fallback bonito si falta API key (configuración)
      return makeCardResponse({
        myth: userQuery,
        isTrue: false,
        explanation_simple:
          'Ahora mismo el verificador no está bien configurado en el servidor, así que no puedo revisar esta afirmación.',
        explanation_expert:
          'Falta GEMINI_API_KEY o GOOGLE_API_KEY en las variables de entorno del servidor. Es necesario configurar la clave de la API antes de poder usar el modelo.',
        evidenceLevel: 'Baja',
        sources: [],
        category: 'Configuración',
        relatedMyths: []
      });
    }

    // ---------- CONFIG GEMINI ----------
    const MODEL =
      process.env.GEMINI_MODEL ||
      process.env.GOOGLE_MODEL ||
      'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres un verificador de afirmaciones científicas.

Devuelve JSON con:
- myth: string (afirmación parafraseada si procede)
- isTrue: boolean
- explanation_simple: 2–4 frases, lenguaje cotidiano (nivel B1), sin jerga ni acrónimos;
  usa ejemplo/analogía si ayuda y evita porcentajes innecesarios.
- explanation_expert: versión técnica y matizada (calidad y diseño de estudios)
- evidenceLevel: "Alta" | "Moderada" | "Baja"
- sources: array<string> con TIPOS DE EVIDENCIA (p. ej., "Revisiones sistemáticas",
  "Ensayos clínicos aleatorizados", "Cohortes observacionales", "Opinión de expertos").
  NO incluyas URLs, DOIs ni identificadores. SOLO tipos.
- category: etiqueta breve (Nutrición, Ejercicio, Sueño, etc.)
- relatedMyths: 0..5 afirmaciones relacionadas (sin URLs).

Criterios del nivel de evidencia:
- Alta: metaanálisis/revisiones sistemáticas consistentes o múltiples ECA grandes.
- Moderada: algunos ECA pequeños o consistencia observacional.
- Baja: evidencia limitada/contradictoria o basada en mecanismos/series pequeñas.

Nunca des recomendaciones clínicas personalizadas.
NO incluyas URLs ni DOIs en ningún campo.
`;

    const responseSchema = {
      type: 'object',
      properties: {
        myth: { type: 'string' },
        isTrue: { type: 'boolean' },
        explanation_simple: { type: 'string' },
        explanation_expert: { type: 'string' },
        evidenceLevel: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        relatedMyths: { type: 'array', items: { type: 'string' } }
      },
      required: [
        'myth',
        'isTrue',
        'explanation_simple',
        'explanation_expert',
        'evidenceLevel'
      ]
    };

    const payload = {
      contents: [{ role: 'user', parts: [{ text: userQuery }] }],
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    // ---------- UTILIDADES LIMPIEZA ----------
    const urlLike = /(https?:\/\/|www\.)[^\s)]+/gi;
    const stripUrls = (s) =>
      typeof s === 'string'
        ? s.replace(urlLike, '').replace(/\(\s*\)/g, '').trim()
        : s;
    const isUrlish = (s) =>
      typeof s === 'string' && /(https?:\/\/|www\.)/i.test(s);

    const stripFences = (t) => {
      let x = (t || '').trim();
      if (x.startsWith('```'))
        x = x
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```$/, '');
      return x.trim();
    };

    const robustParse = (text) => {
      // 1) directo
      try {
        return JSON.parse(text);
      } catch {}
      const t = text.trim();

      // 2) array raíz -> primer objeto
      if (t.startsWith('[')) {
        try {
          const a = JSON.parse(t);
          if (Array.isArray(a) && a.length && typeof a[0] === 'object')
            return a[0];
        } catch {}
      }

      // 3) extraer bloque { ... } balanceado
      const start = t.indexOf('{');
      if (start >= 0) {
        let depth = 0,
          inStr = false,
          esc = false;
        for (let i = start; i < t.length; i++) {
          const ch = t[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
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

    // ---------- LLAMADA A GEMINI CON TIMEOUT + RETRIES ----------
    const TIMEOUT_MS = parseInt(
      process.env.GEMINI_TIMEOUT_MS || process.env.GOOGLE_TIMEOUT_MS || '8000',
      10
    );
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
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timeoutId);

        // TIMEOUT propio -> tarjeta "Tiempo de espera"
        if (timedOut) {
          return makeCardResponse({
            myth: userQuery,
            isTrue: false,
            explanation_simple:
              'La respuesta ha tardado demasiado. Ahora mismo no puedo revisar bien esta afirmación; vuelve a intentarlo en unos minutos.',
            explanation_expert:
              'La llamada a la API de IA excedió el tiempo máximo configurado en el servidor. Se ofrece una respuesta conservadora con evidencia considerada baja.',
            evidenceLevel: 'Baja',
            sources: [],
            category: 'Tiempo de espera',
            relatedMyths: []
          });
        }

        // Otros errores de red
        return makeCardResponse({
          myth: userQuery,
          isTrue: false,
          explanation_simple:
            'Ha habido un problema de conexión con el servicio de IA. No puedo verificar esta afirmación en este momento.',
          explanation_expert:
            `Se produjo un error de red al llamar a la API de Google: ${
              err?.message || String(err)
            }. Es probable que sea un problema transitorio de conectividad.`,
          evidenceLevel: 'Baja',
          sources: [],
          category: 'Conectividad',
          relatedMyths: []
        });
      }

      clearTimeout(timeoutId);
      result = await res.json().catch(() => ({}));

      if (res.ok) {
        break; // todo bien, salimos del bucle
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

      // Si está sobrecargado y quedan reintentos -> backoff
      if (isOverloaded && attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }

      // Saturación / timeout tras reintentos -> tarjeta de "Saturación"
      if (isOverloaded) {
        return makeCardResponse({
          myth: userQuery,
          isTrue: false,
          explanation_simple:
            'Ahora mismo el modelo de IA está saturado o respondiendo con retraso. No puedo verificar bien esta afirmación; vuelve a intentarlo en unos minutos.',
          explanation_expert:
            `La API de Google devolvió errores de saturación o tiempo de espera (código ${code}). Tras varios intentos, se ofrece una respuesta conservadora con evidencia considerada baja.`,
          evidenceLevel: 'Baja',
          sources: [],
          category: 'Saturación',
          relatedMyths: []
        });
      }

      // Errores de políticas / safety
      if (isPolicy) {
        return makeCardResponse({
          myth: userQuery,
          isTrue: false,
          explanation_simple:
            'No puedo valorar esta afirmación tal como está formulada porque entra en una zona restringida por las políticas del modelo.',
          explanation_expert:
            `La petición fue bloqueada por las políticas de seguridad o contenido de la API de Google (código ${code}). Es probable que la afirmación implique temas sensibles o demasiado específicos.`,
          evidenceLevel: 'Baja',
          sources: [],
          category: 'Políticas',
          relatedMyths: []
        });
      }

      // Errores de autenticación / permisos
      if (isAuth) {
        return makeCardResponse({
          myth: userQuery,
          isTrue: false,
          explanation_simple:
            'Ahora mismo el verificador no tiene permisos correctos para acceder al modelo de IA.',
          explanation_expert:
            `La API de Google devolvió un error de autenticación o permisos (código ${code}). Es necesario revisar la clave de API o los permisos del proyecto.`,
          evidenceLevel: 'Baja',
          sources: [],
          category: 'Credenciales',
          relatedMyths: []
        });
      }

      // Otros errores de la API (4xx/5xx genéricos)
      return makeCardResponse({
        myth: userQuery,
        isTrue: false,
        explanation_simple:
          'Ha ocurrido un problema inesperado al consultar el modelo de IA. No puedo revisar esta afirmación en este momento.',
        explanation_expert:
          `La API de Google devolvió un error no esperado (status ${res.status}, código ${code}). Mensaje: ${
            msg || 'sin detalle proporcionado.'
          }`,
        evidenceLevel: 'Baja',
        sources: [],
        category: 'Error de servicio',
        relatedMyths: []
      });
    }

    // ---------- NORMALIZACIÓN EN CASO DE ÉXITO ----------
    const pf = result?.promptFeedback;

    if (!result?.candidates?.length) {
      // 0 candidatos: bloqueado por política u otro motivo
      return makeCardResponse({
        myth: userQuery,
        isTrue: false,
        explanation_simple:
          'No puedo valorar esta afirmación con seguridad por cómo está formulada o por políticas del servicio.',
        explanation_expert:
          `La API devolvió 0 candidatos. Motivo reportado: ${
            pf?.blockReason || 'no especificado por la API'
          }.`,
        evidenceLevel: 'Baja',
        sources: [],
        category: 'Bloqueada',
        relatedMyths: []
      });
    }

    const rawText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = robustParse(stripFences(rawText));

    const obj =
      parsed && typeof parsed === 'object'
        ? parsed
        : {
            myth: userQuery,
            isTrue: false,
            explanation_simple:
              'No he podido estructurar bien la respuesta del modelo. En resumen, no hay pruebas sólidas para afirmarlo con seguridad.',
            explanation_expert:
              'La respuesta del modelo no se pudo convertir del todo bien a formato estructurado. Se ofrece una síntesis conservadora basada en la evidencia disponible.',
            evidenceLevel: 'Baja',
            sources: [],
            category: '',
            relatedMyths: []
          };

    const clean = {
      myth: stripUrls(obj.myth || userQuery),
      isTrue: !!obj.isTrue,
      explanation_simple: stripUrls(obj.explanation_simple || ''),
      explanation_expert: stripUrls(obj.explanation_expert || ''),
      evidenceLevel: stripUrls(obj.evidenceLevel || 'Baja'),
      sources: Array.isArray(obj.sources)
        ? obj.sources.filter((s) => !isUrlish(s)).map(stripUrls)
        : [],
      category: stripUrls(obj.category || ''),
      relatedMyths: Array.isArray(obj.relatedMyths)
        ? obj.relatedMyths.filter((s) => !isUrlish(s)).map(stripUrls)
        : []
    };

    return makeCardResponse(clean);
  } catch (error) {
    // ---------- CUALQUIER EXCEPCIÓN INTERNA INESPERADA ----------
    return makeCardResponse({
      myth: '',
      isTrue: false,
      explanation_simple:
        'Ha ocurrido un problema interno al procesar la consulta. No puedo revisar esta afirmación ahora mismo.',
      explanation_expert: `Se produjo una excepción interna en la función del servidor: ${
        error?.message || String(error)
      }. Conviene revisar los logs del servidor para depurar el origen.`,
      evidenceLevel: 'Baja',
      sources: [],
      category: 'Error interno',
      relatedMyths: []
    });
  }
};
