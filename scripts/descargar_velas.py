import sys
from datetime import datetime
from datetime import datetime, timedelta
from iqoptionapi.stable_api import IQ_Option
from supabase import create_client, Client
import pytz

# Datos desde Node.js
par = sys.argv[1]
fecha_inicio_str = sys.argv[2]
fecha_fin_str = sys.argv[3]

# Supabase
url = "https://lmhyfgagksvojfkbnygx.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaHlmZ2Fna3N2b2pma2JueWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0MjA4MzksImV4cCI6MjA2NTk5NjgzOX0.bD-j6tXajDumkB7cuck_9aNMGkrAdnAJLzQACoRYaJo"
supabase: Client = create_client(url, key)

# IQ Option
I_want_money = IQ_Option("iqoption.signalss@gmail.com", "Rolo880710*2024")
I_want_money.connect()


zona = pytz.timezone("America/Havana")

# Convertir a datetime sin tz
fecha_naive_inicio = datetime.fromisoformat(fecha_inicio_str) - timedelta(hours=2)
minuto_redondeado = (fecha_naive_inicio.minute // 10) * 10
fecha_naive_inicio = fecha_naive_inicio.replace(minute=minuto_redondeado, second=0, microsecond=0)
fecha_naive_fin = datetime.fromisoformat(fecha_fin_str)

# Localizar en zona horaria (agrega tzinfo correctamente)
fecha_local_inicio = zona.localize(fecha_naive_inicio)
fecha_local_fin = zona.localize(fecha_naive_fin)

# Convertir a timestamp UTC
inicio = int(fecha_local_inicio.timestamp())
fin = int(fecha_local_fin.timestamp())



# === DESCARGAR VELAS Y GUARDAR DATOS NECESARIOS ===
velas_guardadas = []


cantidad_velas = int((fin - inicio) / 60)+1
if cantidad_velas <= 0:
    print("Las fechas no son válidas (fin debe ser mayor que inicio)")
    sys.exit(1)
elif cantidad_velas > 1000:
    print("IQ Option no permite más de 1000 velas por solicitud")
    sys.exit(1)

# === Descargar velas ===
candles = I_want_money.get_candles(par, 60, cantidad_velas, fin)

datos = []
for c in candles:
    datos.append({
        "start_time": datetime.fromtimestamp(c["from"]).time().isoformat(),
        "end_time": datetime.fromtimestamp(c["from"] + 60).time().isoformat(),
        "start_price": round(c["open"], 6),
        "end_price": round(c["close"], 6),
    })



# === INSERTAR EN SUPABASE ===
supabase.table("backtesting").delete().neq("id", -1).execute()
if datos:
    supabase.table("backtesting").insert(datos).execute()
