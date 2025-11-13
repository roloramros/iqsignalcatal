import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes
from supabase import create_client, Client
import logging

# Configuración básica
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Configura Supabase
SUPABASE_URL = 'https://lmhyfgagksvojfkbnygx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaHlmZ2Fna3N2b2pma2JueWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0MjA4MzksImV4cCI6MjA2NTk5NjgzOX0.bD-j6tXajDumkB7cuck_9aNMGkrAdnAJLzQACoRYaJo'
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Maneja el comando /start con búsqueda más flexible"""
    user = update.effective_user
    telegram_alias = f"@{user.username}" if user.username else None
    
    if not telegram_alias:
        await update.message.reply_text("⚠️ No tienes un nombre de usuario (@username) configurado en Telegram.")
        return

    try:
        # PRIMERO: Intentar búsqueda exacta
        response = supabase.table('user_config') \
            .select('*') \
            .eq('telegram_alias', telegram_alias) \
            .execute()
        
        # SEGUNDO: Si no encuentra, buscar de manera más flexible
        if len(response.data) == 0:
            # Obtener todos los usuarios y buscar manualmente
            all_users = supabase.table('user_config').select('*').execute()
            usuario_encontrado = None
            
            for user_data in all_users.data:
                alias_en_bd = user_data.get('telegram_alias')
                if alias_en_bd and alias_en_bd.lower() == telegram_alias.lower():
                    usuario_encontrado = user_data
                    break
            
            if usuario_encontrado:
                # Actualizar el alias para que coincida exactamente
                supabase.table('user_config') \
                    .update({'telegram_alias': telegram_alias}) \
                    .eq('user_id', usuario_encontrado['user_id']) \
                    .execute()
                
                response.data = [usuario_encontrado]
            else:
                await update.message.reply_text("❌ No estás registrado en nuestro sistema.")
                return

        # CONTINUAR CON EL PROCESO NORMAL
        user_data = response.data[0]
        current_chat_id = user_data.get('chat_id')
        new_chat_id = update.effective_chat.id
        
        if current_chat_id != new_chat_id:
            supabase.table('user_config') \
                .update({'chat_id': new_chat_id}) \
                .eq('telegram_alias', telegram_alias) \
                .execute()
                
            await update.message.reply_text(
                f"✅ Chat ID actualizado!\n• Alias: {telegram_alias}\n• Chat ID: {new_chat_id}"
            )
        else:
            await update.message.reply_text(
                f"ℹ️ Ya estás registrado\n• Alias: {telegram_alias}\n• Chat ID: {current_chat_id}"
            )

    except Exception as e:
        logger.error(f"Error en start: {e}")
        await update.message.reply_text("❌ Error al procesar tu solicitud.")

async def notificaciones(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Muestra botones para configurar las notificaciones"""
    keyboard = [
        [InlineKeyboardButton("🔕 Sin Notificaciones", callback_data="notif:none")],
        [InlineKeyboardButton("🖥 Notificar en el navegador", callback_data="notif:navegador")],
        [InlineKeyboardButton("🤖 Notificar en Bot de Telegram", callback_data="notif:telegram")],
        [InlineKeyboardButton("📣 Ambas Notificaciones", callback_data="notif:ambos")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("Selecciona donde recibir las notificaciones:", reply_markup=reply_markup)
    
    
    
async def martingalas(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Muestra botones para configurar las notificaciones"""
    keyboard = [
        [InlineKeyboardButton("🚫 Sin Martin Gala (Entrada directa)", callback_data="mg:nogaledirecto")],
        [InlineKeyboardButton("🚫 Sin Martin Gala (Entrar tras 2 pérdidas)", callback_data="mg:nogale")],
        [InlineKeyboardButton("⚡️ Usar 1 Martin Gala (Entrada directa)", callback_data="mg:gale1directo")],
        [InlineKeyboardButton("⚡️ Usar 1 Martin Gala (Entrar tras 1 pérdida)", callback_data="mg:gale1trasperdida")],
        [InlineKeyboardButton("🔥 Usar 2 Martin Galas)", callback_data="mg:gale2")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("Configuración de los Martin Gala:", reply_markup=reply_markup)    





async def manejar_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    user = query.from_user
    telegram_alias = f"@{user.username}" if user.username else None

    if not telegram_alias:
        await query.edit_message_text("⚠️ No tienes un @username válido.")
        return

    response = supabase.table('user_config') \
        .select('user_id') \
        .eq('telegram_alias', telegram_alias) \
        .maybe_single() \
        .execute()

    if not response.data:
        await query.edit_message_text("❌ Alias no registrado en Supabase.")
        return

    user_id = response.data['user_id']

    # Determinar si es notificación o configuración de señales
    try:
        update_data = {}
        mensaje = "✅ Configuración guardada."

        if data.startswith("notif:"):
            valor = data.replace("notif:", "")
            update_data["notificacion"] = valor
            mensajes = {
                "none": "🔕 Has desactivado todas las notificaciones.",
                "navegador": "🖥 Notificaciones activadas en el navegador.",
                "telegram": "🤖 Notificaciones activadas en el bot de Telegram.",
                "ambos": "📣 Notificaciones activadas en navegador y Telegram.",
            }
            mensaje = mensajes.get(valor, mensaje)

        elif data.startswith("mg:"):
            valor = data.replace("mg:", "")
            update_data["martin_gala"] = valor
            mensajes = {
                "nogaledirecto": "🚫 Sin Martin Gala (Entrada directa).",
                "nogale": "🚫 Sin Martin Gala (Entrar tras 2 pérdidas).",
                "gale1directo": "⚡️ 1 Martin Gala (Entrada directa).",
                "gale1trasperdida": "⚡️ 1 Martin Gala tras una pérdida.",
                "gale2": "🔥 Usar 2 Martin Galas.",
            }
            mensaje = mensajes.get(valor, mensaje)

        # Verificar si ya existe un registro
        existe = supabase.table("configuracion_senal_usuario") \
            .select("user_id") \
            .eq("user_id", user_id) \
            .maybe_single() \
            .execute()

        if existe.data:
            supabase.table("configuracion_senal_usuario") \
                .update(update_data) \
                .eq("user_id", user_id) \
                .execute()
        else:
            update_data["user_id"] = user_id
            supabase.table("configuracion_senal_usuario") \
                .insert(update_data) \
                .execute()

        await query.edit_message_text(mensaje)

    except Exception as e:
        logger.error(f"Error al guardar configuración: {e}")
        await query.edit_message_text("❌ Error al guardar configuración.")



def main():
    """Inicia el bot"""
    TOKEN = '7971141664:AAFNFXWpHePHVkaedf1F75GKUk4bHwcJ_HE'
    if not TOKEN:
        raise ValueError("No se encontró TELEGRAM_BOT_TOKEN en las variables de entorno")

    app = Application.builder().token(TOKEN).build()

    # Manejadores de comandos
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("notificaciones", notificaciones))
    app.add_handler(CommandHandler("martingalas", martingalas))
    app.add_handler(CallbackQueryHandler(manejar_callback))

    # Inicia el bot
    app.run_polling()

if __name__ == '__main__':
    main()
