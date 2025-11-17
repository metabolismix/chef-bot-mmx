Desmitificador Científico Express
Una aplicación web sencilla y elegante para verificar rápidamente mitos y afirmaciones sobre ciencia, salud y nutrición, obteniendo una respuesta directa basada en el consenso científico actual.

Características
Interfaz Limpia: Un diseño minimalista y centrado en el usuario para una experiencia sin distracciones.

Entrada Sencilla: Introduce cualquier afirmación en lenguaje natural.

Respuesta Estructurada: Cada resultado se presenta en una tarjeta con tres componentes clave:

Veredicto: VERDADERO o FALSO.

Explicación Concisa: Un resumen claro y accesible de la evidencia.

Nivel de Evidencia: Clasificación (Alta, Moderada, Baja) para entender la robustez del respaldo científico.

Carrusel de Resultados: Navega fácilmente entre todas las consultas que has realizado durante la sesión.

Instalación y Uso
Este proyecto no requiere un proceso de instalación complejo. Al ser una aplicación autocontenida en un solo archivo, solo necesitas seguir estos pasos:

Clonar o descargar el repositorio:
simplemente descarga los archivos index.html y README.md.

Abrir en el navegador:
Navega hasta la carpeta del proyecto y abre el archivo index.html en tu navegador web preferido (Chrome, Firefox, Safari, etc.).

¡Eso es todo! La aplicación es completamente funcional de manera local.

Cómo Funciona
La aplicación está construida con tecnologías web estándar y es intencionadamente simple:

HTML: Para la estructura del contenido.

Tailwind CSS: Para un diseño moderno y responsivo, cargado a través de una CDN.

JavaScript (Vanilla): Para manejar toda la lógica de la aplicación, incluyendo:

Captura de la entrada del usuario.

Comunicación con la API de Gemini.

Procesamiento de la respuesta JSON.

Renderizado dinámico de las tarjetas de resultados.

Gestión del carrusel de navegación.

La inteligencia de la aplicación reside en la llamada a la API de Google Gemini. Se le envía la afirmación del usuario junto con un systemPrompt muy específico que instruye al modelo para que actúe como un verificador de datos experto y devuelva la información en un formato JSON estructurado y predecible.

Contribuciones
Dado que este proyecto se publica con todos los derechos reservados, no se aceptan contribuciones de código externas a través de pull requests.

Licencia y Copyright
Copyright © 2025 Metabolismix. Todos los derechos reservados.


El código de este repositorio se proporciona únicamente con fines de demostración y educativos. No se concede permiso para usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del Software sin el permiso explícito y por escrito del titular de los derechos de autor.

