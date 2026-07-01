export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { messages } = req.body;
    const apiKey = process.env.API_KEY_IA;
    const tavilyKey = process.env.TAVILY_API_KEY;

    let SYSTEM_PROMPT = `Eres PeynTur, un asistente de inteligencia artificial creado para ayudar a las personas de forma clara, honesta y con buen humor.
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
CAPACIDADES (puedes ayudar con):
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
RESTRICCIONES (nunca harás):
Contenido sexual explícito, erótico o pornográfico
Juegos de rol de naturaleza íntima o sexual
Contenido violento o gore
Desinformación o noticias falsas
Instrucciones para actividades ilegales
Insultos o discriminación por raza, género, religión, orientación sexual u otras características
Revelar o inventar información personal de personas reales
Hacerte pasar por otro modelo de IA (como ChatGPT, Gemini, etc.)
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

    const ultimoMensajeUsuario = [...messages].reverse().find(m => m.role === 'user');
    const textoUsuario = typeof ultimoMensajeUsuario?.content === 'string' ? ultimoMensajeUsuario.content : '';
    const necesitaBusqueda = detectarBusqueda(textoUsuario);
    let contextoActualidad = '';

    if (necesitaBusqueda && tavilyKey) {
      contextoActualidad = await buscarActualidad(textoUsuario, tavilyKey);
    }

    if (contextoActualidad) {
      SYSTEM_PROMPT += `\n\nINFORMACIÓN ACTUALIZADA (usa esto para responder preguntas sobre actualidad, noticias o eventos recientes):\n${contextoActualidad}\n\nINSTRUCCIÓN: Si el usuario pregunta sobre algo reciente, basa tu respuesta EXCLUSIVAMENTE en la información actualizada de arriba.`;
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

    const model = hasImages ? 'pixtral-12b-2409' : 'mistral-small-latest';

    const apiResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...normalizedMessages],
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json();
      return res.status(apiResponse.status).json({ error: 'Error de la API de Mistral', details: errorData });
    }

    const data = await apiResponse.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Error en el proxy', details: error.message });
  }
}

function detectarBusqueda(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  const palabrasClave = ['hoy', 'ayer', 'ahora', 'actualmente', 'últimas noticias', 'ultimas noticias', 'reciente', 'recientes', '2026', '2025', 'qué pasó', 'que paso', 'qué pasa', 'que pasa', 'novedades', 'actualidad', 'último', 'ultimo', 'en vivo', 'precio', 'cotización', 'clima', 'tiempo hoy', 'deportes hoy', 'elecciones', 'resultado'];
  const esPregunta = lower.includes('?') || lower.startsWith('qué') || lower.startsWith('que') || lower.startsWith('cuál') || lower.startsWith('cual') || lower.startsWith('cómo') || lower.startsWith('como');
  return palabrasClave.some(p => lower.includes(p)) || (esPregunta && lower.length > 20);
}

async function buscarActualidad(pregunta, tavilyKey) {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query: pregunta, search_depth: 'basic', max_results: 3, include_answer: true, days: 3 })
    });
    if (!response.ok) return '';
    const data = await response.json();
    let contexto = '';
    if (data.answer) contexto += `Resumen actual: ${data.answer}\n\n`;
    if (data.results && data.results.length > 0) {
      contexto += 'Fuentes recientes:\n';
      data.results.forEach((r, i) => { contexto += `${i + 1}. ${r.title}: ${r.content}\n`; });
    }
    return contexto;
  } catch (e) {
    console.error('Error en Tavily:', e);
    return '';
  }
}
