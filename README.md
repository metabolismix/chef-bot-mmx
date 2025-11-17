Chef-Bot — Generador Inteligente de Menús a partir de Macros

Una aplicación web sencilla y elegante para generar ideas de menús y combinaciones de comidas alineadas con un objetivo calórico y de macronutrientes, usando como motor un modelo de IA (Gemini) guiado por un prompt nutricional muy específico.

Aviso importante: El Chef-Bot es una herramienta informativa y de apoyo. No sustituye el consejo personalizado de un profesional sanitario o nutricionista.

Características

Interfaz limpia:
Diseño minimalista y centrado en el usuario para poder configurar tu día de comidas sin distracciones.

Configuración rápida:
Introduce de forma sencilla tus parámetros básicos en lenguaje natural, por ejemplo:

Calorías objetivo aproximadas.

Preferencias generales (más proteína, menos hidratos, etc.).

Número de comidas o estructura del día.

Generación de menús:
La aplicación devuelve propuestas de menú estructuradas, con:

Listado de comidas (desayuno, comida, cena, snacks, etc.).

Descripción simple de cada plato.

Estimación orientativa de macronutrientes y calorías por comida.

Respuesta estructurada en tarjetas:
Cada propuesta de menú se presenta en una tarjeta clara, con:

Título del menú o del día.

Detalle de las comidas.

Resumen nutricional aproximado (calorías, proteína, hidratos, grasas).

Histórico en sesión:
Puedes revisar fácilmente los menús que has ido generando durante la sesión sin perderlos al instante.

Instalación y Uso

La aplicación está pensada para conectarse a la API de Google Gemini a través de una función serverless (por ejemplo, en Netlify) para no exponer la clave de la API en el front-end.
A alto nivel, necesitarás:

Definir una función backend (p.ej., verifymyth.js o similar) que reciba la petición desde el navegador.

Leer la clave de la API de Gemini desde una variable de entorno segura.

Enviar al modelo el prompt y los parámetros nutricionales del usuario.

Devolver al front-end un JSON con la estructura del menú generado.

Cómo Funciona

La aplicación está construida con tecnologías web estándar y es intencionadamente simple:

HTML: Estructura del contenido y maquetación de la página.

Tailwind CSS: Estilos modernos y diseño responsivo, cargados a través de una CDN.

JavaScript (Vanilla): Lógica de la aplicación en el lado del cliente, incluyendo:

Captura de la entrada y parámetros del usuario.

Envío de la petición a la función backend que llama a la API de Gemini.

Procesamiento del JSON devuelto por el modelo.

Renderizado dinámico de las tarjetas de menús y del histórico de resultados.

La “inteligencia” de MacroChefBot reside en la llamada a la API de Google Gemini. Se le envían:

Los datos básicos del usuario (objetivo calórico y de macros, nº de comidas, etc.).

Un systemPrompt muy específico que instruye al modelo a comportarse como un planificador de menús con enfoque nutricional y a devolver siempre una respuesta en un formato JSON estructurado y predecible.

Contribuciones

Dado que este proyecto se publica con todos los derechos reservados, no se aceptan contribuciones de código externas a través de pull requests.

Si quieres comentar ideas o sugerencias, puedes abrir un issue describiendo claramente la propuesta, pero no se garantiza su implementación.

Licencia y Copyright

Copyright © 2025 Metabolismix. Todos los derechos reservados.

El código de este repositorio se proporciona únicamente con fines de demostración y educativos.
No se concede permiso para usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del Software sin el permiso explícito y por escrito del titular de los derechos de autor.
