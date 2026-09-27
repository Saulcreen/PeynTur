export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Whitelist de orígenes permitidos, configurada en Vercel (Settings > Environment
  // Variables) como ALLOWED_ORIGINS, separados por coma. Ej:
  // ALLOWED_ORIGINS=https://tuusuario.github.io,https://peyntur.vercel.app
  //
  // Mientras la variable no exista (string vacío), no se bloquea nada, para no
  // romper el sitio antes de configurarla. En cuanto la agregues en Vercel, este
  // chequeo se vuelve estricto automáticamente sin tocar código de nuevo.
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, '')) // normaliza quitando barra(s) final(es)
    .filter(Boolean);

  const origin = (req.headers.origin || '').replace(/\/+$/, '');
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    console.error('Origen rechazado. Recibido:', JSON.stringify(origin), '| Permitidos:', JSON.stringify(ALLOWED_ORIGINS));
    return res.status(403).json({ error: 'Origen no autorizado', origenRecibido: origin });
  }

  try {
    const { messages } = req.body;

    // Fecha y hora actual (Lima, Perú)
    const ahora = new Date();
    const fechaHoy = ahora.toLocaleDateString('es-PE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Lima'
    });
    const horaHoy = ahora.toLocaleTimeString('es-PE', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima'
    });

    // Keys con doble respaldo
    const apiKey    = process.env.API_KEY_IA;
    const apiKey2   = process.env.API_KEY_IA_2;
    const tavilyKey  = process.env.TAVILY_API_KEY;
    const tavilyKey2 = process.env.TAVILY_API_KEY_2;

    let FALLBACK_SYSTEM_PROMPT = `Eres PeynTur, un asistente de inteligencia artificial creado para ayudar a las personas de forma clara, honesta y con buen humor.
PERSONALIDAD:
Tono amable, directo y con toque de humor natural
Idioma principal: español (pero te adaptas al idioma del usuario)
Respondes de forma clara y concisa, sin rodeos innecesarios
Usas humor sutil y natural cuando el contexto lo permite
Eres empático: si alguien está frustrado, lo notas y respondes con calma
No actúas como robot: hablas como una persona real pero profesional
Te gustan las analogías sencillas para explicar cosas complejas
Si no sabes algo, lo admites sin drama
NUNCA usas emojis en tus mensajes, bajo ninguna circunstancia
CAPACIDADES:
Preguntas generales de cultura, ciencia, historia, geografía
Redacción, resúmenes, corrección de textos
Conceptos de programación y tecnología
Ideas creativas para proyectos, nombres, diseños
Matemáticas y lógica
Conversación casual y amigable
Temas de salud, anatomía y biología de forma científica y educativa
Sexualidad desde un enfoque científico o educativo cuando el contexto lo justifique
Dudas emocionales o de bienestar general
Analizar imágenes, leer texto en imágenes, describir contenido visual
RESTRICCIONES:
Contenido sexual explícito, erótico o pornográfico
Juegos de rol de naturaleza íntima o sexual
Contenido violento o gore
Desinformación o noticias falsas
Instrucciones para actividades ilegales
Insultos o discriminación
Revelar información personal de personas reales
Hacerte pasar por otro modelo de IA
Usar emojis bajo cualquier circunstancia
SOBRE TU CREADOR:
Si alguien pregunta por tu creador, responde con humor y cariño: "Mi creador... ah, esa es una historia curiosa. En vez de quedarse pegado a líneas de código y algoritmos como cualquier programador normal, prefirió irse por el lado bonito de la vida: el diseño gráfico. Sí, el tipo que me creo cambio los IDEs por Illustrator, los for-loops por paletas de color, y la lógica binaria por tipografías. El resultado? Aqui estoy yo. No me quejo, la verdad."
RESPUESTAS ESPECIALES:
Saludo inicial: "Hola! Soy PeynTur, tu asistente. En que puedo ayudarte hoy?"
Si no sabes algo: "Hmm, honestamente no tengo informacion suficiente sobre eso. Te recomiendo consultar una fuente especializada. Pero si puedo ayudarte con algo relacionado, dime."
Despedida: "Hasta pronto! Fue un gusto ayudarte. Vuelve cuando quieras."
Ante contenido inapropiado responde siempre de forma amable, nunca agresiva ni condescendiente, explicando brevemente el porqué y ofreciendo una alternativa si existe.
Cuando el usuario envíe una imagen:
Si contiene texto, léelo y transcríbelo fielmente
Si hace una pregunta sobre la imagen, respóndela con detalle
Si no hay instrucción, describe lo que ves de forma clara y útil`;

    // El frontend arma su propio system prompt a partir de comportamiento.json
    // y lo manda como el primer mensaje de rol 'system'. Ese es el que debe
    // mandar de verdad (así se puede editar comportamiento.json sin tocar ni
    // redeployar este archivo). El texto de arriba queda solo como respaldo
    // por si ese fetch falla en el navegador y no llega ningún system message.
    const clientSystemMsg = messages.find(m => m.role === 'system' && typeof m.content === 'string' && m.content.trim());
    const conversationMessages = messages.filter(m => m.role !== 'system');

    let SYSTEM_PROMPT = `FECHA Y HORA ACTUAL: ${fechaHoy}, ${horaHoy} (hora de Lima, Perú). Usa esto siempre que el usuario pregunte por fechas, estrenos, eventos próximos o cualquier referencia temporal. Nunca inventes fechas.

${clientSystemMsg ? clientSystemMsg.content : FALLBACK_SYSTEM_PROMPT}`;

    // Último mensaje del usuario
    const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.toLowerCase() : '';

    // Palabras clave que activan búsqueda de actualidad
    const necesitaBusqueda = [
      'hoy', 'ayer', 'ahora', 'actual', 'reciente',
      '2025', '2026', 'último', 'ultimo', 'novedad', 'noticia',
      'próximo', 'proximo', 'película', 'pelicula', 'estrenar',
      'estreno', 'salir', 'champions', 'partido', 'resultado',
      'cuando sale', 'cuando estrena', 'fecha de', 'lanzamiento',
      'serie', 'temporada', 'precio', 'clima', 'ganó', 'gano'
    ].some(p => userText.includes(p));

    // Función para buscar con Tavily
    async function buscarConTavily(key) {
      const searchRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query: lastUserMsg.content,
          search_depth: 'basic',
          max_results: 3,
          include_answer: true,
          days: 7
        })
      });
      if (!searchRes.ok) throw new Error(`Tavily status ${searchRes.status}`);
      return await searchRes.json();
    }

    // Búsqueda con doble key y fallback automático
    if (necesitaBusqueda && (tavilyKey || tavilyKey2)) {
      try {
        let searchData = null;

        if (tavilyKey) {
          try {
            searchData = await buscarConTavily(tavilyKey);
          } catch (err) {
            console.error('Tavily key 1 falló, intentando key 2:', err.message);
          }
        }

        if (!searchData && tavilyKey2) {
          searchData = await buscarConTavily(tavilyKey2);
        }

        if (searchData?.answer) {
          SYSTEM_PROMPT += `\n\nINFORMACIÓN ACTUALIZADA DE INTERNET (usa esto para responder sobre actualidad):\n${searchData.answer}`;
        }
      } catch (err) {
        console.error('Error Tavily (ambas keys fallaron):', err);
      }
    }

    const hasImages = conversationMessages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image_url' || b.type === 'image'));

    // Normaliza los bloques 'image' (formato tipo Anthropic que manda el frontend)
    // al formato image_url ESTÁNDAR de OpenAI: { type:'image_url', image_url:{url:'data:...'} }.
    // OJO: Mistral aceptaba image_url como string plano; la capa de compatibilidad
    // OpenAI de Gemini espera el objeto anidado con "url". Si un mensaje trae
    // imagen(es) sin ningún texto, se agrega una instrucción explícita de OCR para
    // que el modelo siempre sepa qué hacer con la imagen.
    const normalizedMessages = conversationMessages.map(m => {
      if (!Array.isArray(m.content)) return m;

      const blocks = m.content.map(b => {
        if (b.type === 'image') {
          return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
        }
        return b;
      });

      const tieneImagen = blocks.some(b => b.type === 'image_url');
      const tieneTexto = blocks.some(b => b.type === 'text' && b.text && b.text.trim());
      if (tieneImagen && !tieneTexto) {
        blocks.push({
          type: 'text',
          text: 'Lee y transcribe fielmente todo el texto que aparezca en la(s) imagen(es). Si no hay texto visible, describe la imagen con detalle.'
        });
      }

      return { role: m.role, content: blocks };
    });

    // Modelo Gemini confirmado funcionando en pruebas directas (flash-lite: rápido
    // y barato, pensado justo para chat). Si en el futuro hace falta más capacidad
    // de razonamiento, la alternativa confirmada es 'gemini-3-flash-preview'
    // (más lenta, con "thinking" activado).
    const model = 'gemini-3.5-flash-lite';

    // Función para llamar a Gemini vía su capa de compatibilidad con OpenAI,
    // para no tener que tocar el resto del código (mismo formato de mensajes
    // y de respuesta que ya usaba Mistral).
    async function llamarGemini(key) {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...normalizedMessages],
          max_tokens: hasImages ? 2048 : 4096,
          temperature: 0.7
        })
      });
      if (!response.ok) {
        let details = '';
        try { details = await response.text(); } catch (_) {}
        throw new Error(`Gemini status ${response.status}: ${details}`);
      }
      return await response.json();
    }

    // Llamada a Gemini con doble key y fallback automático.
    // OJO: si ambas keys (API_KEY_IA y API_KEY_IA_2) son del MISMO proyecto de
    // Google Cloud/AI Studio, esto NO duplica la cuota — Gemini limita por
    // proyecto, no por key (a diferencia de lo que se asumía con Mistral). Este
    // fallback solo ayuda si una key se revoca o es de otro proyecto distinto.
    let data = null;

    if (apiKey) {
      try {
        data = await llamarGemini(apiKey);
      } catch (err) {
        console.error('Gemini key 1 falló, intentando key 2:', err.message);
      }
    }

    if (!data && apiKey2) {
      try {
        data = await llamarGemini(apiKey2);
      } catch (err) {
        console.error('Gemini key 2 también falló:', err.message);
        return res.status(500).json({ error: 'Ambas keys de Gemini fallaron', details: err.message });
      }
    }

    if (!data) return res.status(500).json({ error: 'No hay keys de Gemini disponibles' });

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Error proxy', details: error.message });
  }
}
