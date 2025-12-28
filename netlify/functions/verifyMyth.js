
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- SERVICIO GEMINI ---

const generateMealPlan = async (prefs) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-flash-lite-latest";

  const prompt = `Plan mediterráneo 1 día: Prot:${prefs.protein}g, Gras:${prefs.fat}g, Carb:${prefs.carbs}g. ${prefs.numMeals} comidas. Restricciones: ${prefs.dietaryFilter || "N/A"}. Nevera: ${prefs.fridgeIngredients || "N/A"}. 
  INSTRUCCIÓN: Sé ultra-conciso. Recetas simples. Máximo 2 pasos por plato. El JSON debe ser válido.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      plan_name: { type: Type.STRING },
      days: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            day_name: { type: Type.STRING },
            total_macros: {
              type: Type.OBJECT,
              properties: {
                protein_g: { type: Type.NUMBER },
                fat_g: { type: Type.NUMBER },
                carbs_g: { type: Type.NUMBER },
              },
              required: ["protein_g", "fat_g", "carbs_g"],
            },
            meals: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  meal_type: { type: Type.STRING },
                  recipe_name: { type: Type.STRING },
                  short_description: { type: Type.STRING },
                  macros: {
                    type: Type.OBJECT,
                    properties: {
                      protein_g: { type: Type.NUMBER },
                      fat_g: { type: Type.NUMBER },
                      carbs_g: { type: Type.NUMBER },
                    },
                    required: ["protein_g", "fat_g", "carbs_g"],
                  },
                  ingredients: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        quantity_grams: { type: Type.NUMBER },
                      },
                      required: ["name", "quantity_grams"],
                    },
                  },
                  steps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ["meal_type", "recipe_name", "macros", "ingredients", "steps"],
              },
            },
          },
          required: ["day_name", "total_macros", "meals"],
        },
      },
      shopping_list: { type: Type.ARRAY, items: { type: Type.STRING } },
      general_tips: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["plan_name", "days", "shopping_list", "general_tips"],
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: 700,
        thinkingConfig: { thinkingBudget: 0 },
        systemInstruction: "Eres Chef-, un asistente de nutrición mediterránea experto y eficiente. Generas planes de alimentación estructurados en JSON de forma extremadamente concisa para ahorrar recursos.",
      },
    });

    const text = response.text;
    if (!text) throw new Error("Respuesta vacía");
    
    return {
      plan: JSON.parse(text),
      usage: response.usageMetadata
    };
  } catch (error) {
    console.error("Gemini Error:", error);
    throw error;
  }
};

// --- COMPONENTES ---

const Alert = ({ message, onClose }) => (
  <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start justify-between shadow-sm animate-in fade-in duration-300">
    <p className="text-sm text-red-700 font-medium">{message}</p>
    <button onClick={onClose} className="text-red-400 hover:text-red-500">&times;</button>
  </div>
);

const Loader = () => (
  <div className="fixed inset-0 bg-white/95 backdrop-blur-xl z-[100] flex flex-col items-center justify-center p-6 text-center">
    <div className="relative mb-10 scale-150 w-20 h-20">
      <div className="w-20 h-20 border-[6px] border-gray-100 rounded-[2rem] absolute"></div>
      <div className="w-20 h-20 border-[6px] border-[#00BCC9] rounded-[2rem] absolute border-t-transparent animate-spin-slow"></div>
    </div>
    <h3 className="text-2xl font-black text-[#003d5b]">Chef- está cocinando tu plan...</h3>
    <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mt-2">Gemini 2.5 Flash-Lite Engine</p>
  </div>
);

const MacroBadge = ({ label, value, unit, colorClass, barClass }) => (
  <div className="bg-gray-50/50 p-3 rounded-2xl border border-gray-100 flex flex-col items-center text-center">
    <span className="text-[9px] font-black text-gray-400 uppercase mb-1">{label}</span>
    <div className="flex items-baseline gap-0.5">
      <span className={`text-xl font-black ${colorClass}`}>{Math.round(value)}</span>
      <span className="text-[9px] font-bold text-gray-400">{unit}</span>
    </div>
    <div className="w-6 h-1 mt-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full ${barClass}`} style={{ width: '100%' }}></div>
    </div>
  </div>
);

const MealCard = ({ meal }) => {
  const [isOpen, setIsOpen] = useState(false);
  const kcal = Math.round(meal.macros.protein_g * 4 + meal.macros.carbs_g * 4 + meal.macros.fat_g * 9);

  return (
    <div className="bg-white border border-gray-100 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <span className="inline-block px-2 py-0.5 bg-cyan-50 text-[#0088A3] text-[9px] font-black uppercase tracking-widest rounded-full mb-1">
            {meal.meal_type}
          </span>
          <h4 className="text-xl font-black text-[#003d5b]">{meal.recipe_name}</h4>
        </div>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className={`px-5 py-2 rounded-xl font-black text-[10px] transition-all ${isOpen ? 'bg-[#003d5b] text-white' : 'bg-gray-100 text-[#003d5b]'}`}
        >
          {isOpen ? 'CERRAR' : 'VER RECETA'}
        </button>
      </div>
      
      <div className="grid grid-cols-4 gap-2">
        <MacroBadge label="PROT" value={meal.macros.protein_g} unit="g" colorClass="text-macro-protein" barClass="bg-macro-protein" />
        <MacroBadge label="GRASA" value={meal.macros.fat_g} unit="g" colorClass="text-macro-fat" barClass="bg-macro-fat" />
        <MacroBadge label="CARB" value={meal.macros.carbs_g} unit="g" colorClass="text-macro-carb" barClass="bg-macro-carb" />
        <MacroBadge label="KCAL" value={kcal} unit="" colorClass="text-[#003d5b]" barClass="bg-gray-300" />
      </div>

      {isOpen && (
        <div className="mt-6 pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <div>
            <h5 className="text-[10px] font-black text-[#003d5b] uppercase mb-3">Ingredientes</h5>
            <ul className="space-y-1">
              {meal.ingredients.map((ing, i) => (
                <li key={i} className="text-xs bg-gray-50 p-2 rounded-lg flex justify-between">
                  <span className="font-semibold text-gray-700">{ing.name}</span>
                  <span className="font-black text-[#0088A3]">{ing.quantity_grams}g</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h5 className="text-[10px] font-black text-[#003d5b] uppercase mb-3">Preparación</h5>
            {meal.steps.map((step, i) => (
              <p key={i} className="text-[11px] text-gray-600 mb-2 leading-relaxed flex gap-2">
                <span className="font-black text-[#0088A3]">{i+1}.</span> {step}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- APP PRINCIPAL ---

const App = () => {
  const [prefs, setPrefs] = useState({
    protein: 160, fat: 70, carbs: 220, numMeals: 3, dietaryFilter: '', fridgeIngredients: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);
  const calories = Math.round((prefs.protein * 4) + (prefs.carbs * 4) + (prefs.fat * 9));

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setPrefs(prev => ({ ...prev, [name]: (name === 'dietaryFilter' || name === 'fridgeIngredients') ? value : Number(value) }));
  };

  const handleGenerate = async (useFridge) => {
    setLoading(true); setError(null);
    try {
      const result = await generateMealPlan({ ...prefs, fridgeIngredients: useFridge ? prefs.fridgeIngredients : '' });
      setPlan(result.plan);
      setUsage(result.usage);
    } catch (err) {
      setError("Fallo en la conexión con Chef-. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <header className="text-center mb-10">
        <h1 className="text-5xl font-black text-mmx-gradient tracking-tight mb-2">Chef-</h1>
        <p className="text-gray-500 font-medium">Nutrición Mediterránea • Gemini 2.5 Flash-Lite</p>
      </header>

      <div className="space-y-6">
        <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-sm font-black text-[#003d5b] uppercase tracking-widest flex items-center">
              <span className="w-1.5 h-4 bg-mmx-gradient rounded-full mr-2"></span> Macros Diarios
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <Input label="PROT" name="protein" value={prefs.protein} color="text-macro-protein" onChange={handleInputChange} />
              <Input label="FAT" name="fat" value={prefs.fat} color="text-macro-fat" onChange={handleInputChange} />
              <Input label="CARB" name="carbs" value={prefs.carbs} color="text-macro-carb" onChange={handleInputChange} />
            </div>
            <div className="bg-gray-50 p-3 rounded-xl flex justify-between items-center">
              <span className="text-[10px] font-black text-gray-400">ENERGÍA</span>
              <span className="font-black text-[#003d5b]">{calories} kcal</span>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-black text-[#003d5b] uppercase tracking-widest flex items-center">
              <span className="w-1.5 h-4 bg-[#003d5b] rounded-full mr-2"></span> Preferencias
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <Select label="PLATOS" name="numMeals" value={prefs.numMeals} onChange={handleInputChange} />
              <TextInput label="DIETA" name="dietaryFilter" value={prefs.dietaryFilter} placeholder="Ej: Vegano" onChange={handleInputChange} />
            </div>
            <textarea 
              name="fridgeIngredients" 
              value={prefs.fridgeIngredients} 
              onChange={handleInputChange}
              placeholder="Ingredientes en mi nevera..."
              className="w-full p-3 bg-gray-50 border-2 border-dashed border-gray-100 rounded-xl text-xs font-medium focus:border-[#00BCC9] outline-none h-16 resize-none"
            />
          </div>
        </div>

        <button 
          onClick={() => handleGenerate(true)}
          disabled={loading}
          className="w-full py-4 bg-mmx-gradient text-white font-black rounded-2xl shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50"
        >
          GENERAR MI PLAN CHEF-
        </button>

        {error && <Alert message={error} onClose={() => setError(null)} />}

        {usage && (
          <div className="flex justify-center gap-4 text-[9px] font-black text-gray-400 uppercase tracking-tighter">
            <span>Tokens: {usage.totalTokenCount}</span>
            <span>Speed: Lite 2.5</span>
          </div>
        )}

        {plan && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
             <h2 className="text-2xl font-black text-center text-[#003d5b] mt-10">{plan.plan_name}</h2>
             <div className="space-y-4">
                {plan.days[0].meals.map((meal, i) => <MealCard key={i} meal={meal} />)}
             </div>
             
             <div className="bg-[#003d5b] p-8 rounded-[2rem] text-white">
                <h4 className="text-lg font-black mb-4 flex justify-between items-center">
                  Lista de Compra
                  <span className="text-[9px] opacity-50">FLASH-LITE OPTIMIZED</span>
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {plan.shopping_list.map((item, i) => (
                    <div key={i} className="text-xs font-medium bg-white/10 p-2 rounded-lg">{item}</div>
                  ))}
                </div>
             </div>
          </div>
        )}
      </div>
      {loading && <Loader />}
    </div>
  );
};

const Input = ({ label, name, value, color, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <input type="number" name={name} value={value} onChange={onChange} className={`w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-black text-sm focus:border-[#00BCC9] outline-none ${color}`} />
  </div>
);

const TextInput = ({ label, name, value, placeholder, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <input type="text" name={name} value={value} placeholder={placeholder} onChange={onChange} className="w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-bold text-xs focus:border-[#00BCC9] outline-none" />
  </div>
);

const Select = ({ label, name, value, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <select name={name} value={value} onChange={onChange} className="w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-bold text-xs focus:border-[#00BCC9] outline-none">
      {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n} platos</option>)}
    </select>
  </div>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
