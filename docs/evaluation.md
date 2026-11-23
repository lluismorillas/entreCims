# Avaluació

<!-- peaks:start -->
## Cims

Generat per `eval/peaks.py report`. Llavor 2026, 1000 rèpliques de bootstrap per cim.

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
