import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

// --- LLAMADA AL BACKEND (NETLIFY FUNCTION) ---
const generateMealPlan = async (prefs) => {
  const res = await fetch('/.netlify/functions/chef', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = data?.error || `Error ${res.status}`;
    throw new Error(msg);
  }

  return data; // { plan, usage }
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
    <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mt-2">Gemini 2.5 Flash Engine</p>
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
          {meal.short_description ? (
            <p className="text-xs text-gray-500 font-medium mt-1">{meal.short_description}</p>
          ) : null}
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
                <span className="font-black text-[#0088A3]">{i + 1}.</span> {step}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- INPUTS ---
const Input = ({ label, name, value, color, onChange, min=0, max=500 }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <input
      type="number"
      name={name}
      value={value}
      min={min}
      max={max}
      onChange={onChange}
      className={`w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-black text-sm focus:border-[#00BCC9] outline-none ${color}`}
    />
  </div>
);

const TextInput = ({ label, name, value, placeholder, onChange, maxLength=120 }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <input
      type="text"
      name={name}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={onChange}
      className="w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-bold text-xs focus:border-[#00BCC9] outline-none"
    />
  </div>
);

const Select = ({ label, name, value, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[9px] font-black text-gray-400 mb-1">{label}</label>
    <select
      name={name}
      value={value}
      onChange={onChange}
      className="w-full p-2 bg-gray-50 border-2 border-gray-100 rounded-xl font-bold text-xs focus:border-[#00BCC9] outline-none"
    >
      {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n} platos</option>)}
    </select>
  </div>
);

// --- APP PRINCIPAL ---
const App = () => {
  const [prefs, setPrefs] = useState({
    protein: 160,
    fat: 70,
    carbs: 220,
    numMeals: 3,
    dietaryFilter: '',
    fridgeIngredients: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);

  const calories = Math.round((prefs.protein * 4) + (prefs.carbs * 4) + (prefs.fat * 9));

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setPrefs(prev => ({
      ...prev,
      [name]: (name === 'dietaryFilter' || name === 'fridgeIngredients') ? value : Number(value),
    }));
  };

  const handleGenerate = async (useFridge) => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateMealPlan({
        ...prefs,
        fridgeIngredients: useFridge ? prefs.fridgeIngredients : '',
      });
      setPlan(result.plan);
      setUsage(result.usage || null);
    } catch (err) {
      setError(err?.message || "Fallo en la conexión con Chef-. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <header className="text-center mb-10">
        <h1 className="text-5xl font-black text-mmx-gradient tracking-tight mb-2">Chef-</h1>
        <p className="text-gray-500 font-medium">Nutrición Mediterránea • Gemini 2.5 Flash</p>
      </header>

      <div className="space-y-6">
        <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-sm font-black text-[#003d5b] uppercase tracking-widest flex items-center">
              <span className="w-1.5 h-4 bg-mmx-gradient rounded-full mr-2"></span> Macros Diarios
            </h2>

            <div className="grid grid-cols-3 gap-3">
              <Input label="PROT" name="protein" value={prefs.protein} color="text-macro-protein" onChange={handleInputChange} min={40} max={300}/>
              <Input label="FAT" name="fat" value={prefs.fat} color="text-macro-fat" onChange={handleInputChange} min={20} max={200}/>
              <Input label="CARB" name="carbs" value={prefs.carbs} color="text-macro-carb" onChange={handleInputChange} min={0} max={400}/>
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
              <TextInput label="DIETA" name="dietaryFilter" value={prefs.dietaryFilter} placeholder="Ej: Vegano" onChange={handleInputChange} maxLength={120}/>
            </div>

            <textarea
              name="fridgeIngredients"
              value={prefs.fridgeIngredients}
              onChange={handleInputChange}
              placeholder="Ingredientes en mi nevera..."
              maxLength={600}
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

        {usage?.totalTokenCount != null && (
          <div className="flex justify-center gap-4 text-[9px] font-black text-gray-400 uppercase tracking-tighter">
            <span>Tokens: {usage.totalTokenCount}</span>
            <span>Model: 2.5 Flash</span>
          </div>
        )}

        {plan && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-2xl font-black text-center text-[#003d5b] mt-10">{plan.plan_name}</h2>

            <div className="space-y-4">
              {plan.days?.[0]?.meals?.map((meal, i) => <MealCard key={i} meal={meal} />)}
            </div>

            {!!plan.shopping_list?.length && (
              <div className="bg-[#003d5b] p-8 rounded-[2rem] text-white">
                <h4 className="text-lg font-black mb-4 flex justify-between items-center">
                  Lista de Compra
                  <span className="text-[9px] opacity-50">FLASH OPTIMIZED</span>
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {plan.shopping_list.map((item, i) => (
                    <div key={i} className="text-xs font-medium bg-white/10 p-2 rounded-lg">{item}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {loading && <Loader />}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
