export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

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

    let SYSTEM_PROMPT = `FECHA Y HORA ACTUAL: ${fechaHoy}, ${horaHoy} (hora de Lima, Perú). Usa esto siempre que el usuario pregunte por fechas, estrenos, eventos próximos o cualquier referencia temporal. Nunca inventes fechas.

Eres PeynTur, un asistente de inteligencia artificial creado para ayudar a las personas de forma clara, honesta y con buen humor.
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

    // Último mensaje del usuario
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
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

    const hasImages = messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image_url' || b.type === 'image'));

    const normalizedMessages = messages.map(m => {
      if (!Array.isArray(m.content)) return m;
      const blocks = m.content.map(b => {
        if (b.type === 'image') {
          return { type: 'image_url', image_url: `data:${b.source.media_type};base64,${b.source.data}` };
        }
        return b;
      });
      return { role: m.role, content: blocks };
    });

    // NOTA: 'pixtral-12b-2409' fue descontinuado por Mistral (deprecado 12/2025).
    // 'pixtral-large-latest' también está deprecado. El modelo con visión vigente
    // recomendado por Mistral es 'mistral-large-latest'.
    const model = hasImages ? 'mistral-large-latest' : 'mistral-small-latest';

    // Función para llamar a Mistral
    async function llamarMistral(key) {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...normalizedMessages],
          max_tokens: 1024,
          temperature: 0.7
        })
      });
      if (!response.ok) {
        let details = '';
        try { details = await response.text(); } catch (_) {}
        throw new Error(`Mistral status ${response.status}: ${details}`);
      }
      return await response.json();
    }

    // Llamada a Mistral con doble key y fallback automático
    let data = null;

    if (apiKey) {
      try {
        data = await llamarMistral(apiKey);
      } catch (err) {
        console.error('Mistral key 1 falló, intentando key 2:', err.message);
      }
    }

    if (!data && apiKey2) {
      try {
        data = await llamarMistral(apiKey2);
      } catch (err) {
        console.error('Mistral key 2 también falló:', err.message);
        return res.status(500).json({ error: 'Ambas keys de Mistral fallaron', details: err.message });
      }
    }

    if (!data) return res.status(500).json({ error: 'No hay keys de Mistral disponibles' });

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Error proxy', details: error.message });
  }
}
