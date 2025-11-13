require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const axios = require('axios');
const https = require("https");
const agent = new https.Agent({ family: 4 }); // 👈 Forzar IPv4

const TELEGRAM_TOKEN = "7971141664:AAFNFXWpHePHVkaedf1F75GKUk4bHwcJ_HE";
const TELEGRAM_TOKEN_LOG = "8403266609:AAEBEnN1i72-7kYbd2dsZtEjSuhsrxkjQ7c";
const TELEGRAM_CHAT_ID = "1589398506";

const app = express();
const port = 3000;

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Mapa slug -> variables para la vista única
const pares = {
  eurusd_otc: { tablaPar: 'eurusd_otc', analisisPar: 'EUR/USD OTC' },
  eurgbp_otc: { tablaPar: 'eurgbp_otc', analisisPar: 'EUR/GBP OTC' },
  usdchf_otc: { tablaPar: 'usdchf_otc', analisisPar: 'USD/CHF OTC' },
  audcad_otc: { tablaPar: 'audcad_otc', analisisPar: 'AUD/CAD OTC' },
  gbpusd_otc: { tablaPar: 'gbpusd_otc', analisisPar: 'GBP/USD OTC' },
  usdzar_otc: { tablaPar: 'usdzar_otc', analisisPar: 'USD/ZAR OTC' },
  usdxof_otc: { tablaPar: 'usdxof_otc', analisisPar: 'USD/XOF OTC' },
  usdsgd_otc: { tablaPar: 'usdsgd_otc', analisisPar: 'USD/SGD OTC' },
  usdhkd_otc: { tablaPar: 'usdhkd_otc', analisisPar: 'USD/HKD OTC' },
  usdinr_otc: { tablaPar: 'usdinr_otc', analisisPar: 'USD/INR OTC' },
};

// === Configuración EJS y middlewares ===
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'mi_clave_secreta_segura',
  resave: false,
  saveUninitialized: false
}));
app.use(express.json());

// ======== MIDDLEWARES DE AUTENTICACIÓN Y LICENCIAS ========

// Proteger rutas autenticadas
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/');
  }
  next();
}

// Lee la licencia del usuario desde Supabase
async function getUserLicense(userId) {
  const { data, error } = await supabase
    .from('user_config')
    .select('licencia')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return (data?.licencia || 'free').toLowerCase();
}

/**
 * Middleware de autorización por licencia.
 * @param {string[]} allowedLicenses - Lista de licencias permitidas para esta ruta, p.ej: ['pro','premium'] o ['premium']
 */
function requireLicense(allowedLicenses = ['premium']) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.user?.id;
      if (!userId) return res.redirect('/');

      const licencia = await getUserLicense(userId);
      const ok = allowedLicenses.includes(licencia);

      if (!ok) {
        // Opciones:
        // return res.status(403).send('🔒 Requiere una suscripción superior');
        return res.redirect('/suscripcion');
      }
      next();
    } catch (e) {
      console.error('Error en requireLicense:', e);
      return res.status(500).send('Error verificando licencia');
    }
  };
}

// ======== LOGIN ========
// ======== LOGIN ========
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return res.render('login', { error: error?.message || 'Error al iniciar sesión' });
  }

  // Guardar sesión
  req.session.user = data.user;

  try {
    const userId = data.user.id;

    // 1) Leer licencia, expiración y chat_id
    const { data: cfg, error: cfgErr } = await supabase
      .from('user_config')
      .select('licencia, licencia_expira, chat_id, telegram_alias')
      .eq('user_id', userId)
      .single();

    if (cfgErr) throw cfgErr;

    // 2) Comparar fechas
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const expDate = cfg?.licencia_expira ? new Date(cfg.licencia_expira + 'T00:00:00Z') : null;
    const isExpired = expDate ? todayUTC > expDate : false;

    // 3) Si vencida y no es ya 'free' -> degradar a free y notificar al usuario por Telegram
    if (isExpired && cfg.licencia !== 'free') {
      const { error: upErr } = await supabase
        .from('user_config')
        .update({ licencia: 'free' })
        .eq('user_id', userId);

      if (upErr) {
        console.error('No se pudo actualizar la licencia a free:', upErr.message);
      } else {
        // Mensaje directo al usuario (si tenemos chat_id)
        const chatId = cfg?.chat_id; // bigint en tu tabla
        const fecha = cfg?.licencia_expira ? cfg.licencia_expira : 'fecha desconocida';
        const msgUsuario =
          `⚠️ <b>Tu licencia ha vencido</b>\n` +
          `Tu plan fue cambiado a <b>FREE</b>.\n\n` +
          `Puedes reactivar o mejorar tu plan desde el panel de suscripción.`;
        await sendTelegramTo(chatId, msgUsuario); // usa el helper de arriba
      }
    }

    // === Mantengo tu notificación de login a canal/log (opcional) ===
    // (En tu código original ya envías a un canal fijo con sendTelegramMessage):contentReference[oaicite:1]{index=1}
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    let telegramAlias = cfg?.telegram_alias || "No definido";
    await sendTelegramMessage(`🔐 Login exitoso:\nEmail: ${email}\nTelegram: ${telegramAlias}`);

  } catch (e) {
    console.error('Error en verificación/actualización de licencia:', e);
    // No bloqueamos el login por esto; continuamos.
  }

  // Redirección
  res.redirect('/panel');
});



// Función para renderizar con layout
function renderWithLayout(viewPath, options, res) {
  const view = fs.readFileSync(path.join(__dirname, 'views', viewPath), 'utf8');
  const html = ejs.render(view, options);
  const layout = fs.readFileSync(path.join(__dirname, 'views', 'layout.ejs'), 'utf8');
  const full = ejs.render(layout, { ...options, body: html });
  res.send(full);
}

app.use(express.static('public'));

// ======== RUTAS PÚBLICAS ========
app.get('/', (req, res) => {
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  res.render('register', {
    error: null,
    success: null // Añadir la variable success
  });
});

// Registro modificado
app.post('/register', async (req, res) => {
  const { email, password, telegram_username, iqoption_email } = req.body;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { telegram_username, iqoption_email } }
    });

    if (error) {
      if (error.message.includes('email rate limit exceeded')) {
        return res.render('register', {
          error: 'Hemos enviado muchos emails recientemente. Por favor intenta de nuevo en 1 hora.',
          success: null
        });
      }
      throw error;
    }

    if (data.user && data.user.id) {
      try {
        const baseDate = data.user.created_at ? new Date(data.user.created_at) : new Date();
        const expiresAt = new Date(baseDate);
        expiresAt.setDate(expiresAt.getDate() + 10);

        // Si tu columna es DATE en Postgres, conviene YYYY-MM-DD:
        const licenciaExpira = expiresAt.toISOString().slice(0, 10);


        await supabase.from('user_config').insert({
          user_id: data.user.id,
          telegram_alias: telegram_username,
          chat_id: null,
          mg_config: '2 gales',
          licencia: 'demo',
          licencia_expira: licenciaExpira,
          email: iqoption_email
        });
        // 🔔 Enviar mensaje a Telegram cuando se registre un usuario
        await sendTelegramMessage(`✅ Nuevo registro:\nEmail: ${email}\nTelegram: ${telegram_username}`);
      } catch (telegramError) {
        console.error('Error en registro de Telegram:', telegramError);
      }
    }

    res.render('register', {
      error: null,
      success: `Usuario ${email} registrado correctamente.`,
      telegramUrl: "https://t.me/iq_signalcatal_bot"
    });

  } catch (error) {
    res.render('register', {
      error: error.message,
      success: null
    });
  }
});

// ======== TELEGRAM ========
async function sendTelegramMessage(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN_LOG}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML"
    });
  } catch (err) {
    console.error("❌ Error enviando mensaje a Telegram:", err.response?.data || err.message);
  }
}

// Envía un mensaje de Telegram a un chat específico (usuario)
async function sendTelegramTo(chatId, text) {
  if (!chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML"
    });
    return true;
  } catch (e) {
    console.error("❌ Error enviando mensaje al usuario por Telegram:", e.response?.data || e.message);
    return false;
  }
}


app.post('/sendMessage', requireLogin, async (req, res) => {
  const { message, chatId } = req.body;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML"
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error en backend al enviar mensaje:", error);
    res.status(500).json({ success: false, error: "Error enviando mensaje" });
  }
});

// ======== LOGOUT ========
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ======== RUTAS PRIVADAS + LICENCIAS ========

// Panel y secciones generales
app.get('/panel', requireLogin, (req, res) => {
  renderWithLayout('panel.ejs', { user: req.session.user, title: 'Home', activePage: 'panel' }, res);
});

app.get('/patrones', requireLogin, (req, res) => {
  renderWithLayout('patrones.ejs', { user: req.session.user, title: 'Patrones', activePage: 'patrones' }, res);
});

app.get('/catalogacion', requireLogin, (req, res) => {
  renderWithLayout('catalogacion.ejs', { user: req.session.user, title: 'Catalogación', activePage: 'catalogacion' }, res);
});

// === APLICA LICENCIAS SEGÚN TU LÓGICA ===
// Ejemplos (ajusta libremente):
app.get('/signals', requireLogin, (req, res) => {
  renderWithLayout('signals.ejs', { user: req.session.user, title: 'Panel de Señales', activePage: 'signals' }, res);
});

app.get('/backtesting', requireLogin, requireLicense(['demo', 'pro', 'premium', 'elite']), (req, res) => {
  renderWithLayout('backtesting.ejs', { user: req.session.user, title: 'Backtesting', activePage: 'backtesting' }, res);
});

app.get('/bots', requireLogin, requireLicense(['elite']), (req, res) => {
  renderWithLayout('bots.ejs', { user: req.session.user, title: 'Bots Automáticos', activePage: 'bots' }, res);
});

app.get('/manual', requireLogin, requireLicense(['demo', 'pro', 'premium', 'elite']), (req, res) => {
  renderWithLayout('manual.ejs', { user: req.session.user, title: 'Catalogación Manual', activePage: 'manual' }, res);
});

app.get('/escaner', requireLogin, requireLicense(['demo', 'pro', 'premium', 'elite']), (req, res) => {
  renderWithLayout('escaner.ejs', {
    user: req.session.user,
    title: 'Escáner de Patrones',
    activePage: 'escaner',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/suscripcion', requireLogin, (req, res) => {
  renderWithLayout('suscripcion.ejs', {
    user: req.session.user,
    title: 'Suscripción Premium',
    activePage: 'suscripcion',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

// === Endpoints de Python ===
app.post('/cargar-velas', requireLogin, (req, res) => {
  const { par, fechaInicio, fechaFin } = req.body;
  const scriptPath = path.join(__dirname, 'scripts', 'descargar_velas.py');
  const proceso = spawn('python3', [scriptPath, par, fechaInicio, fechaFin]);
  let salida = '';
  let error = '';
  proceso.stdout.on('data', (data) => { salida += data.toString(); });
  proceso.stderr.on('data', (data) => { error += data.toString(); });
  proceso.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Script finalizado:', salida);
      res.send("Velas cargadas correctamente.");
    } else {
      console.error('❌ Error al ejecutar script:', error);
      res.status(500).send("Error al cargar velas.");
    }
  });
});

app.post('/analizar-alerta', requireLogin, (req, res) => {
  const { par, fechaHora, cantidad } = req.body;
  const scriptPath = path.join(__dirname, 'scripts', 'signals_results.py');
  const proceso = spawn('python3', [scriptPath, par, fechaHora, cantidad]);
  let salida = '';
  let error = '';
  proceso.stdout.on('data', (data) => { salida += data.toString(); });
  proceso.stderr.on('data', (data) => { error += data.toString(); });
  proceso.on('close', (code) => {
    if (code === 0) {
      try {
        const velas = JSON.parse(salida);
        res.json({ success: true, velas });
      } catch (err) {
        res.status(500).json({ success: false, error: 'Error parseando salida de Python' });
      }
    } else {
      res.status(500).json({ success: false, error: error || 'Error al ejecutar script' });
    }
  });
});

// === Rutas para catalogación dinámica ===
app.get('/catalogacion/:slug', requireLogin, async (req, res, next) => {
  const slug = req.params.slug;
  const cfg = pares[slug];
  if (!cfg) return res.status(404).send('Par no soportado');

  // Si es eurusd_otc → acceso libre
  if (slug === 'eurusd_otc') {
    return renderWithLayout('otc/par_otc.ejs', {
      user: req.session.user,
      title: `Catalogación ${cfg.analisisPar}`,
      activePage: slug,
      tablaPar: cfg.tablaPar,
      analisisPar: cfg.analisisPar,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY
    }, res);
  }

  // 👇 Para todo lo demás, verificamos licencia
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.redirect('/');

    const { data, error } = await supabase
      .from('user_config')
      .select('licencia')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    const licencia = data?.licencia || 'free';

    // Solo permitimos pro o premium
    if (!['pro', 'premium', 'demo', 'elite'].includes(licencia)) {
      return res.redirect('/suscripcion');
    }

    // Si tiene permiso, renderizamos normalmente
    renderWithLayout('otc/par_otc.ejs', {
      user: req.session.user,
      title: `Catalogación ${cfg.analisisPar}`,
      activePage: slug,
      tablaPar: cfg.tablaPar,
      analisisPar: cfg.analisisPar,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY
    }, res);

  } catch (err) {
    console.error('Error verificando licencia en catalogación:', err);
    res.status(500).send('Error verificando licencia');
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
