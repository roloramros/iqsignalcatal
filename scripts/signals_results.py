# scripts/descargar_velas_analisis.py
import sys
import json
from datetime import datetime, timedelta
from iqoptionapi.stable_api import IQ_Option
import pytz


# Conexión IQ Option
I_want_money = IQ_Option("iqoption.signalss@gmail.com", "Rolo880710*2024")
I_want_money.connect()
zona = pytz.timezone("America/Havana")


if len(sys.argv) < 4:
    print(json.dumps({"error": "Par, fechaHora y cantidad_velas son requeridos"}))
    sys.exit(1)

par = sys.argv[1]
fecha_inicio_str = sys.argv[2]
cantidad_velas = int(sys.argv[3])

fecha_naive_inicio = datetime.fromisoformat(fecha_inicio_str)
fecha_local_inicio = zona.localize(fecha_naive_inicio)

# Timestamp inicio y fin (fin es inicio + cantidad_velas - 1 minutos)
inicio_ts = int(fecha_local_inicio.timestamp())
fin_dt = fecha_local_inicio + timedelta(minutes=cantidad_velas - 1)
fin_ts = int(fin_dt.timestamp())

# Descargar velas terminando en fin_ts
candles = I_want_money.get_candles(par, 60, cantidad_velas, fin_ts)

# Convertir a lista de diccionarios
datos = []
for c in candles:
    datos.append({
        "start_time": datetime.fromtimestamp(c["from"]).time().isoformat(),
        "end_time": datetime.fromtimestamp(c["from"] + 60).time().isoformat(),
        "start_price": round(c["open"], 6),
        "end_price": round(c["close"], 6),
        "color": "green" if c["close"] > c["open"] else ("red" if c["close"] < c["open"] else "gray")
    })

# Salida en JSON
print(json.dumps(datos, ensure_ascii=False))
