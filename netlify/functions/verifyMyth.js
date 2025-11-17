// netlify/functions/verifymyth.js
// Función serverless de Netlify para llamar a Gemini usando GOOGLE_API_KEY
// y devolver texto en español con buena ortografía y respetando restricciones
// dietéticas si se incluyen en el contexto.

const { GoogleGenerativeAI } = require("@google/generative-ai");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "OK"
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Método no permitido. Usa POST." })
    };
  }

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "GOOGLE_API_KEY no está configurada en las variables de entorno."
        })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const prompt = body.prompt;
    const context = body.context || null;

    if (!prompt || typeof prompt !== "string") {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Falta el campo "prompt" en la petición (string obligatorio).'
        })
      };
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemInstructions = `
Eres un asistente experto en nutrición y fitness.
Responde SIEMPRE en español de España, con ortografía y gramática impecables.
Si el usuario te da un plan de comidas o restricciones dietéticas en el campo "context",
NUNCA propongas alimentos que las contradigan (ej.: intolerancia a la lactosa → no lácteos; celiaquía → sin gluten).
Si no puedes estar seguro de cumplirlas, explica la duda y sugiere consultar a un profesional sanitario.
No inventes datos nutricionales concretos si no los conoces, limita la respuesta a explicaciones generales.
`;

    const parts = [
      { text: systemInstructions },
      { text: "Pregunta o instrucción del usuario:" },
      { text: prompt }
    ];

    if (context) {
      parts.push({
        text: "\nContexto adicional proporcionado por la aplicación:\n" +
          JSON.stringify(context, null, 2)
      });
    }

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts
        }
      ]
    });

    const responseText = result.response.text();

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ result: responseText })
    };
  } catch (error) {
    console.error("Error en verifymyth:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Error al llamar a la API de Gemini.",
        details: String(error && error.message ? error.message : error)
      })
    };
  }
};
