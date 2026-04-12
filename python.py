import pandas as pd
import plotly.express as px

# Cargar CSV
df = pd.read_csv("heatmap.csv", sep=";")

# Asignar colores según valoración
def color_from_valor(val):
    if val <= 25:
        return 'red'
    elif val <= 50:
        return 'yellow'
    else:
        return 'green'

df['Color'] = df['VALORACION'].apply(color_from_valor)

# Crear el treemap estilo heatmap
fig = px.treemap(
    df,
    path=['Función', 'Categoría', 'Subcategoría'],
    values='VALORACION',
    color='VALORACION',
    color_continuous_scale=[(0, 'red'), (0.2, 'rgb(238, 43, 17)'), (0.4, 'rgb(235, 148, 26)'), (0.6, 'yellow'), (0.8, 'rgb(169, 238, 41)'), (1, 'green')],
    range_color=[0, 100]
)

fig.update_layout(
    title='Heatmap de KRIs estilo tarjeta',
    margin=dict(t=50, l=25, r=25, b=25)
)

# Mostrar y guardar
fig.show()
fig.write_html("heatmap_kri_interactivo_v1.1.html")
