# Avaluació

<!-- peaks:start -->
## Cims

Generat per `eval/peaks.py report`.

### Mostra

- Parells (activitat, cim a menys de 300 m) etiquetats: 152, dels quals 39 assolits.
- Parells dubtosos, exclosos: 0.
- Part d'ajust: 88 parells de 73 cims.
- Part de prova: 64 parells de 51 cims.

### Paràmetres

Escollits per F1 a la part d'ajust, entre 432 combinacions de {'r': (30, 50, 70, 100), 'm': (10, 20, 30), 'w': (100, 200, 300), 'p': (3, 5, 10), 'c': (0, 10, 20, 30)}:
`R = 50 m`, `M = 20 m`, `W = 100 m`, `P = 10 m`, `C = 30 m`. F1 a la part d'ajust: 0.79.

### Resultats a la part de prova

Entre parèntesis, l'interval de confiança del 95 %.

| Mètode | Precisió | Exhaustivitat | F1 |
|---|---|---|---|
| entreCims, ajustat | 0.92 (0.73–1.00) | 0.71 (0.44–0.92) | 0.80 (0.58–0.94) |
| entreCims, valors inicials | 0.92 (0.73–1.00) | 0.71 (0.44–0.92) | 0.80 (0.58–0.94) |
| Summit Bag: 70 m | 0.67 (0.44–0.85) | 0.82 (0.61–1.00) | 0.74 (0.56–0.88) |
| intervals-summits: 100 m i 80 m | 0.60 (0.39–0.79) | 0.88 (0.71–1.00) | 0.71 (0.53–0.86) |
| trailscan: 50 m i 30 m | 0.81 (0.58–1.00) | 0.76 (0.50–0.96) | 0.79 (0.59–0.93) |

### Errors de la part de prova

Sense noms ni coordenades. L'altitud és la del cim a OpenStreetMap; la diferència és la del cim menys
la màxima del track a prop.

| Error | Distància | Diferència d'altitud | Màxim local | Altitud del cim | Confiança |
|---|---|---|---|---|---|
| Fals negatiu | 1 m | 30 m | sí | 1238 m | high |
| Fals positiu | 0 m | -2 m | sí | 584 m | high |
| Fals negatiu | 298 m | – | – | 1550 m | high |
| Fals negatiu | 51 m | – | – | 499 m | high |
| Fals negatiu | 98 m | – | – | 2661 m | high |
| Fals negatiu | 151 m | – | – | 2102 m | high |
<!-- peaks:end -->

<!-- timing:start -->
## Temps

Generat per `eval/timing.py`. Llavor 2026, 1000 rèpliques de bootstrap.

Un model per tipus d'activitat a peu, entrenat només amb les sortides d'aquell tipus. Una sortida és
excursió si la seva velocitat mitjana en moviment és de 6 km/h o menys; si no, és cursa de
muntanya o cursa segons l'esport que desa el fitxer.

- Objectiu: temps en moviment. Trams de 100 m; s'exclouen els pendents de més del
  50 %.
- N0 i la semivida es trien a cada iteració, amb validació creuada de 4 blocs sobre les
  dades d'entrenament, entre N0 = (2, 5, 10) i semivida = (180, inf) dies.
  Naismith calibrat també s'ajusta a cada iteració.

### Excursions (`hike`)

23 sortides, del 2025-07 al 2026-10. S'exclouen de l'ajust els
trams de més de 12 km/h. L'aplicació hi prediu amb
**el model propi**.

#### Validació 1: *leave-one-out*

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 10.2 % | 14 min | -0.4 % |
| Tobler | 18.9 % | 24 min | +15.7 % |
| Naismith | 36.8 % | 47 min | +28.1 % |
| Naismith calibrat | 13.7 % | 18 min | +4.0 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): -3.5 punts (IC 95 %: -5.8 a -1.1). El model propi encerta més en 16 de 23 sortides.

**El model propi supera Naismith calibrat.**

#### Validació 2: temporal

Cada sortida es prediu només amb les anteriors (a partir de la 4a, 20 prediccions).

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 11.1 % | 13 min | +6.8 % |
| Tobler | 17.7 % | 21 min | +13.7 % |
| Naismith | 37.7 % | 44 min | +27.9 % |
| Naismith calibrat | 15.9 % | 20 min | +10.9 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): -4.8 punts (IC 95 %: -7.0 a -2.6). El model propi encerta més en 15 de 20 sortides.

**El model propi supera Naismith calibrat.**

#### Temps total

Amb les parades estimades a partir de les sortides d'entrenament: MAPE 37.5 %
(*leave-one-out*) i 43.6 % (temporal).

#### Sensibilitat a la longitud dels trams

MAPE del model propi amb trams de 50 m (*leave-one-out*): 10.6 %, davant de
10.2 % amb trams de 100 m.

### Curses de muntanya (`trail_run`)

14 sortides, del 2025-11 al 2026-10. S'exclouen de l'ajust els
trams de més de 20 km/h. L'aplicació hi prediu amb
**Naismith calibrat**.

#### Validació 1: *leave-one-out*

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 14.3 % | 5 min | +13.3 % |
| Tobler | 138.8 % | 59 min | +130.1 % |
| Naismith | 189.1 % | 82 min | +165.8 % |
| Naismith calibrat | 8.6 % | 3 min | +3.3 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): +5.7 punts (IC 95 %: +1.1 a +11.3). El model propi encerta més en 5 de 14 sortides.

**El model propi no supera Naismith calibrat: és pitjor.**

#### Validació 2: temporal

Cada sortida es prediu només amb les anteriors (a partir de la 4a, 11 prediccions).

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 20.2 % | 8 min | +17.8 % |
| Tobler | 147.9 % | 63 min | +138.1 % |
| Naismith | 200.8 % | 88 min | +187.0 % |
| Naismith calibrat | 16.8 % | 6 min | +4.6 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): +3.3 punts (IC 95 %: -6.8 a +12.0). El model propi encerta més en 2 de 11 sortides.

**El model propi no supera Naismith calibrat de manera concloent.**

#### Temps total

Amb les parades estimades a partir de les sortides d'entrenament: MAPE 15.9 %
(*leave-one-out*) i 20.6 % (temporal).

#### Sensibilitat a la longitud dels trams

MAPE del model propi amb trams de 50 m (*leave-one-out*): 12.7 %, davant de
14.3 % amb trams de 100 m.

### Curses (`run`)

21 sortides, del 2025-08 al 2026-10. S'exclouen de l'ajust els
trams de més de 25 km/h. L'aplicació hi prediu amb
**Naismith calibrat**.

#### Validació 1: *leave-one-out*

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 11.1 % | 3 min | +3.4 % |
| Tobler | 122.0 % | 33 min | +128.8 % |
| Naismith | 157.3 % | 43 min | +161.8 % |
| Naismith calibrat | 12.1 % | 3 min | +5.3 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): -1.0 punts (IC 95 %: -2.3 a +0.3). El model propi encerta més en 12 de 21 sortides.

**El model propi no supera Naismith calibrat de manera concloent.**

#### Validació 2: temporal

Cada sortida es prediu només amb les anteriors (a partir de la 4a, 18 prediccions).

| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |
|---|---|---|---|
| Model propi | 10.5 % | 3 min | -0.7 % |
| Tobler | 118.2 % | 33 min | +125.0 % |
| Naismith | 154.5 % | 43 min | +156.1 % |
| Naismith calibrat | 13.5 % | 4 min | -0.5 % |

Diferència d'error absolut per sortida (model propi menys Naismith calibrat): -3.0 punts (IC 95 %: -9.0 a +1.7). El model propi encerta més en 10 de 18 sortides.

**El model propi no supera Naismith calibrat de manera concloent.**

#### Temps total

Amb les parades estimades a partir de les sortides d'entrenament: MAPE 13.0 %
(*leave-one-out*) i 12.0 % (temporal).

#### Sensibilitat a la longitud dels trams

MAPE del model propi amb trams de 50 m (*leave-one-out*): 11.1 %, davant de
11.1 % amb trams de 100 m.
<!-- timing:end -->
