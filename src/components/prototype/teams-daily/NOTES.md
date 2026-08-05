# PROTOTYPE — variación de suscripciones por día por equipo + seguidores por equipo

**Pregunta:** ¿cómo se ve la variación diaria de suscripciones por equipo (altas /
bajas de suscriptores cuyo equipo favorito es X) junto al total de seguidores por
equipo?

**Dónde:** ruta existente `/basket?tab=teams` + `&variant=A|B|C`. Con `variant`
presente la pestaña Equipos renderiza el prototipo en lugar de `TeamsTab`.
Sin `variant`, todo sigue igual.

**Variantes**

| key | nombre | hipótesis |
|-----|--------|-----------|
| A | Grilla equipos × días | todo el tablero de un vistazo; heatmap de neto por celda |
| B | Ficha de equipo | lista maestra + detalle diario de un equipo (altas arriba / bajas abajo) |
| C | Diario de movimientos | feed por día con chips de equipos que ganan y pierden + ranking de seguidores |

**Definiciones usadas (mismas del resto del app)**

- Seguidor de equipo = `basket_users.promo_team_id`. Cuenta todos los usuarios,
  estén suscritos o no.
- Activo el día D = existe pago con `created_at::date <= D` y
  `(expires_at + 7 días)::date >= D` (gracia de 7 días, igual que Overview).
- **Alta** en D = activo en D y no activo en D-1 (nuevo o reactivado, no renovación).
- **Baja** en D = activo en D-1 y no activo en D. Por la gracia de 7 días, las
  bajas aparecen ~7 días después del vencimiento real.
- Equipo del movimiento = equipo favorito actual del usuario (`promo_team_id` es
  un snapshot: si alguien cambió de equipo, el histórico se reatribuye).

**Datos:** `GET /api/basket/teams-daily-prototype` (throwaway BFF). Respeta
`range`, `countries`, `accessType`, `subType` del FilterRow. `ytd`/`all` se
clampean a 120 días. ~1.3 s para 30 días sobre la base local.

**Veredicto:** _(pendiente — completar con la variante ganadora y por qué)_

**Al terminar:** borrar `src/components/prototype/`, la ruta
`src/app/api/basket/teams-daily-prototype/`, la línea `// PROTOTYPE` de
`UrlFilterSync.tsx` y el mount en `BasketDashboard.tsx`. Reescribir la ganadora
como código de producción (BFF con `IAnalyticsQueryRepository` + vista
materializada, no SQL inline).
