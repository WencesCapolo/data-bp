'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
import { LineChart } from '@/components/charts/LineChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { ContenidoFilters, type ContenidoFilterState } from './contenido/ContenidoFilters';
import { ComboChart } from './contenido/ComboChart';
import { GroupedBarChart } from './contenido/GroupedBarChart';
import { fmt, fmtSecondsLong, fmtSecondsShort } from './contenido/format';
import type { ContenidoDTO, ContenidoTournamentRow } from '@basket/core/dtos/ContenidoDTO';

// The catalogue's own bounds, not a relative window: the interesting spans here
// are whole seasons, and the first published match is a fixed date.
const CATALOGUE_FLOOR = '2020-10-01';
const VIEWS = '#4f8ef7';
const USERS = '#e30613';
const PIECES = '#10b981';
const ACTIVE = '#e8edf5';
const RATIO = '#a78bfa';

/** Tournaments need at least this many pieces to enter the average-views ranking. */
const MIN_PIECES_FOR_AVG = 10;
const TOP_TOURNAMENTS = 12;
const TOP_TOURNAMENTS_AVG = 15;
const TOP_LEAGUES = 20;

type LeagueMetric = 'matches' | 'views' | 'avg' | 'users';

const LEAGUE_METRICS: { key: LeagueMetric; label: string }[] = [
  { key: 'matches', label: 'Nº partidos' },
  { key: 'views', label: 'Views totales' },
  { key: 'avg', label: 'Media views/partido' },
  { key: 'users', label: 'Users únicos' },
];

export function ContenidoView() {
  // Pinned for the component's life: a `to` that drifts mid-session would
  // make the same filter fetch a different range on every render.
  const ceiling = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [filters, setFilters] = useState<ContenidoFilterState>({
    from: CATALOGUE_FLOOR,
    to: ceiling,
    country: '',
  });
  const [leagueMetric, setLeagueMetric] = useState<LeagueMetric>('matches');

  const qs = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.country) qs.set('country', filters.country);
  const { data, error, isLoading } = useSWR<ContenidoDTO>(
    `/api/financiero/contenido?${qs}`,
    fetcher,
  );

  // Average views per piece is a ratio of two numbers the DTO already carries,
  // so it is derived here rather than served: a floor on the piece count is a
  // presentation choice, and one viral match should not top the ranking.
  const byTournamentAvg = useMemo(() => {
    if (!data) return [] as (ContenidoTournamentRow & { avg: number })[];
    return data.byTournament
      .filter((r) => r.count >= MIN_PIECES_FOR_AVG)
      .map((r) => ({ ...r, avg: r.count > 0 ? r.views / r.count : 0 }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, TOP_TOURNAMENTS_AVG);
  }, [data]);

  const leagues = useMemo(() => {
    if (!data) return [] as (ContenidoTournamentRow & { avg: number })[];
    const rows = data.byLeague.map((r) => ({
      ...r,
      avg: r.matches > 0 ? r.views / r.matches : 0,
    }));
    // Every metric the picker offers is a key on the row, `avg` included.
    return rows.sort((a, b) => b[leagueMetric] - a[leagueMetric]).slice(0, TOP_LEAGUES);
  }, [data, leagueMetric]);

  // Audience against the subscriber base: only the months where both series have
  // a value. A month with views but no active count would otherwise plot the
  // ratio against zero and read as infinite engagement.
  const crossed = useMemo(() => {
    if (!data) return { labels: [] as string[], views: [] as number[], active: [] as number[], ratio: [] as number[] };
    const active = new Map(data.monthlyActive.map((r) => [r.month, r.active]));
    const both = data.monthly.filter((r) => active.has(r.month));
    return {
      labels: both.map((r) => r.month.slice(0, 7)),
      views: both.map((r) => r.views),
      active: both.map((r) => active.get(r.month) ?? 0),
      ratio: both.map((r) => {
        const a = active.get(r.month) ?? 0;
        return a > 0 ? r.views / a : 0;
      }),
    };
  }, [data]);

  if (isLoading) return <TabSkeleton />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return <div className="no-data">Sin datos</div>;

  const T = data.totals;
  const isFiltered =
    Boolean(data.country) || data.from !== CATALOGUE_FLOOR || data.to !== ceiling;
  const scope = isFiltered
    ? `${data.from} → ${data.to}${data.country ? ` · ${data.country}` : ''}`
    : 'desde el inicio';
  const secPerPiece = T.contentCount > 0 ? T.seconds / T.contentCount : 0;
  const secPerView = T.views > 0 ? T.seconds / T.views : 0;
  const secPerUser = T.users > 0 ? T.seconds / T.users : 0;

  const months = data.monthly.map((r) => r.month.slice(0, 7));
  const topCountries = data.byCountry.slice(0, 10);
  const topTeams = data.byTeam.slice(0, 15);
  const topTournaments = data.byTournament.slice(0, TOP_TOURNAMENTS);

  return (
    <>
      <div className="section-hero">
        <div className="section-hero-eyebrow">basquetpass.tv · catálogo</div>
        <div className="section-hero-title">🏀 Contenido y audiencia</div>
        <div className="section-hero-desc">
          Visualizaciones del catálogo: views, usuarios, partidos por torneo, equipo
          y país. Al final, cruces entre contenido y suscriptores para entender la
          dinámica de audiencia frente a la base activa.
        </div>
      </div>

      <ContenidoFilters
        value={filters}
        onChange={setFilters}
        countries={data.countries}
        floor={CATALOGUE_FLOOR}
        ceiling={ceiling}
      />

      <div className="kpi-grid">
        <KpiCard
          label="Contenidos publicados"
          value={fmt(T.contentCount)}
          sub={`${scope} · partidos completos: ${fmt(T.matchesComplete)}`}
          hint="Filas del catálogo con status publicado y al menos 60 segundos vistos por view, en el rango y país de contenido elegidos. «Partidos completos» son las que traen dos equipos."
        />
        <KpiCard
          label="Views"
          value={fmt(T.views)}
          sub={isFiltered ? 'en el rango filtrado' : 'acumulado histórico'}
          variant="blue"
          hint="Suma del contador de views de cada contenido del catálogo filtrado. Son las views acumuladas hasta hoy de los contenidos publicados en el rango, no el tráfico de ese período."
        />
        <KpiCard
          label="Usuarios únicos"
          value={fmt(T.users)}
          sub={`visualizaciones de usuario únicas en ${isFiltered ? 'el rango' : 'el histórico'}`}
          variant="green"
          hint="Suma de los usuarios distintos de cada contenido (views_users). Se suma entre piezas: una misma persona que vio dos partidos cuenta dos veces."
        />
        <KpiCard
          label="Tiempo total visto"
          value={fmtSecondsLong(T.seconds)}
          sub="suma de view-seconds, excluidos los negativos"
          hint="Suma de los segundos vistos de cada contenido del catálogo filtrado. Los valores negativos, un artefacto de la fuente, se descartan en vez de contarse como cero tiempo."
        />
        <KpiCard
          label="⏱ Promedio por contenido"
          value={fmtSecondsShort(secPerPiece)}
          sub="tiempo total ÷ contenidos publicados"
          variant="yellow"
          hint="Tiempo total visto dividido por la cantidad de contenidos publicados del rango. Promedio simple: una final muy vista y un partido menor pesan igual en el denominador."
        />
        <KpiCard
          label="⏱ Promedio por view"
          value={fmtSecondsShort(secPerView)}
          sub="tiempo total ÷ views"
          variant="yellow"
          hint="Tiempo total visto dividido por el total de views: cuánto dura una reproducción típica. El catálogo ya excluye piezas con menos de 60 s por view, así que el piso está algo inflado."
        />
        <KpiCard
          label="⏱ Promedio por usuario"
          value={fmtSecondsShort(secPerUser)}
          sub="tiempo total ÷ usuarios únicos"
          variant="yellow"
          hint="Tiempo total visto dividido por la suma de usuarios únicos por contenido. Como el denominador cuenta a la misma persona una vez por pieza, subestima el tiempo real por persona."
        />
      </div>

      <div className="chart-full">
        <div className="chart-title">
          📈 Vistas y usuarios mensuales
          <InfoHint text="Por mes de la fecha del contenido (día del partido): suma de views, de usuarios únicos por pieza y cantidad de contenidos publicados. Son acumulados de cada pieza asignados al mes en que se emitió." />
        </div>
        <div className="chart-desc">
          Barras: total de <b>views</b> por mes (eje izquierdo). Líneas:{' '}
          <b>usuarios únicos</b> que vieron contenido y número de{' '}
          <b>contenidos publicados</b> ese mes (eje derecho). El patrón estacional
          sigue al básquet sudamericano.
        </div>
        {months.length === 0 ? (
          <div className="no-data">Sin contenidos en el rango</div>
        ) : (
          <ComboChart
            labels={months}
            bars={[{ label: 'Views', data: data.monthly.map((r) => r.views), color: VIEWS }]}
            lines={[
              { label: 'Usuarios únicos', data: data.monthly.map((r) => r.users), color: USERS },
              { label: 'Contenidos publicados', data: data.monthly.map((r) => r.count), color: PIECES, dashed: true },
            ]}
            barAxisTitle="Views"
            lineAxisTitle="Usuarios / Contenidos"
            height={330}
          />
        )}
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">
          🌎 Audiencia por país de contenido
          <InfoHint text="Views y usuarios sumados por el país donde se jugó el partido, top 10 por views. No es el país del Subscriber y no responde al filtro de país del resto de /financiero." />
        </div>
          <div className="chart-desc">
            Top países por <b>origen del contenido</b>, no por país del suscriptor.
            Argentina concentra la mayor parte por el peso de la LNB.
          </div>
          {topCountries.length === 0 ? (
            <div className="no-data">Sin contenidos en el rango</div>
          ) : (
            <GroupedBarChart
              labels={topCountries.map((r) => r.country)}
              series={[
                { label: 'Views', data: topCountries.map((r) => r.views), color: VIEWS },
                { label: 'Usuarios únicos', data: topCountries.map((r) => r.users), color: USERS },
              ]}
              height={320}
            />
          )}
        </div>

        <div className="chart-card">
          <div className="chart-title">
          🏆 Top torneos por audiencia
          <InfoHint text="Los 12 torneos con más views sumadas en el rango, con su cantidad de contenidos y usuarios. Incluye programas y resúmenes, no sólo partidos." />
        </div>
          <div className="chart-desc">
            Top {TOP_TOURNAMENTS} torneos por <b>views totales</b> en el rango. Mide
            qué ligas mueven más volumen de audiencia agregada.
          </div>
          <div className="table-scroll" style={{ maxHeight: 320 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Torneo</th>
                  <th>País</th>
                  <th style={{ textAlign: 'right' }}>Contenidos</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                </tr>
              </thead>
              <tbody>
                {topTournaments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="no-data">Sin datos en el rango</td>
                  </tr>
                ) : (
                  topTournaments.map((r) => (
                    <tr key={r.tournamentId}>
                      <td>
                        <b>{r.name}</b>
                        <div style={{ color: 'var(--text3)', fontSize: 10 }}>id {r.tournamentId}</div>
                      </td>
                      <td>{r.countryMaster}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.count)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.views)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.users)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">
          📊 Top torneos por media de views
          <InfoHint text="Views totales ÷ contenidos de cada torneo en el rango, sólo torneos con al menos 10 contenidos. Mide cuánto rinde cada pieza, no el volumen del torneo." />
        </div>
        <div className="chart-desc">
          Para cada torneo, <b>views ÷ nº de contenidos</b> en el rango. Mide qué tan
          vista es en promedio cada pieza de la liga, no su volumen. Se exigen al
          menos <b>{MIN_PIECES_FOR_AVG} contenidos</b> en el rango para entrar al
          ranking, así un único partido viral no lo encabeza.
        </div>
        <div className="table-scroll" style={{ maxHeight: 380 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Torneo</th>
                <th>País</th>
                <th style={{ textAlign: 'right' }}>Contenidos</th>
                <th style={{ textAlign: 'right' }}>Views totales</th>
                <th style={{ textAlign: 'right' }}>Media views/contenido</th>
              </tr>
            </thead>
            <tbody>
              {byTournamentAvg.length === 0 ? (
                <tr>
                  <td colSpan={5} className="no-data">
                    Sin torneos con ≥{MIN_PIECES_FOR_AVG} contenidos en el rango
                  </td>
                </tr>
              ) : (
                byTournamentAvg.map((r) => (
                  <tr key={r.tournamentId}>
                    <td>
                      <b>{r.name}</b>
                      <div style={{ color: 'var(--text3)', fontSize: 10 }}>id {r.tournamentId}</div>
                    </td>
                    <td>{r.countryMaster}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.count)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.views)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent2)' }}>
                      {fmt(r.avg)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">
          👥 Top equipos por views
          <InfoHint text="Suma de views y usuarios de cada partido en que apareció el equipo, como local o visitante; un partido suma para ambos. Top 15 por views." />
        </div>
          <div className="chart-desc">
            Top 15 equipos por visualizaciones acumuladas. Un partido cuenta para
            ambos equipos, como local y como visitante.
          </div>
          {topTeams.length === 0 ? (
            <div className="no-data">Sin partidos en el rango</div>
          ) : (
            <GroupedBarChart
              labels={topTeams.map((r) => r.team)}
              series={[
                { label: 'Views', data: topTeams.map((r) => r.views), color: VIEWS },
                { label: 'Usuarios únicos', data: topTeams.map((r) => r.users), color: USERS },
              ]}
              height={380}
            />
          )}
        </div>

        <div className="chart-card">
          <div className="chart-title">
          ⭐ Top contenidos individuales
          <InfoHint text="Los 15 contenidos del catálogo filtrado con más views acumuladas, con su fecha y torneo. Pueden ser partidos, finales o programas." />
        </div>
          <div className="chart-desc">
            Los 15 contenidos más vistos del rango. Incluye finales, eventos y
            programas especiales, no sólo partidos.
          </div>
          <div className="table-scroll" style={{ maxHeight: 380 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Partido / Título</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                </tr>
              </thead>
              <tbody>
                {data.topViews.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="no-data">Sin contenidos en el rango</td>
                  </tr>
                ) : (
                  data.topViews.map((r, i) => (
                    <tr key={`${r.date}:${i}`}>
                      <td style={{ color: 'var(--text3)' }}>{r.date}</td>
                      <td>
                        {r.team1 && r.team2 ? `${r.team1} vs ${r.team2}` : r.title || '—'}
                        {r.tournamentName && (
                          <div style={{ color: 'var(--text3)', fontSize: 10 }}>{r.tournamentName}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.views)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.users)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">
          🏟️ Partidos por liga
          <InfoHint text="Sólo contenidos con dos equipos, agrupados por torneo: partidos, views, usuarios y views ÷ partidos. La métrica del selector ordena el ranking y dibuja el top 20." />
        </div>
        <div className="chart-desc">
          Sólo partidos con dos equipos: los programas y los resúmenes quedan
          afuera, y por eso los totales aquí son menores que en la tabla de
          torneos. Ordená por la métrica que te interese.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 12,
            fontSize: 11,
            color: 'var(--text3)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text2)' }}>
            {fmt(data.byLeague.reduce((a, r) => a + r.matches, 0))} partidos en{' '}
            {data.byLeague.length} ligas
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            Métrica:
            <select
              value={leagueMetric}
              onChange={(e) => setLeagueMetric(e.target.value as LeagueMetric)}
            >
              {LEAGUE_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {leagues.length === 0 ? (
          <div className="no-data">Sin partidos en el rango</div>
        ) : (
          <GroupedBarChart
            labels={leagues.map((r) => r.name)}
            series={[
              {
                label: LEAGUE_METRICS.find((m) => m.key === leagueMetric)!.label,
                data: leagues.map((r) =>
                  leagueMetric === 'matches'
                    ? r.matches
                    : leagueMetric === 'avg'
                      ? Math.round(r.avg)
                      : leagueMetric === 'users'
                        ? r.users
                        : r.views,
                ),
                color: VIEWS,
              },
            ]}
            height={Math.max(320, leagues.length * 26)}
          />
        )}
      </div>

      <div className="section-callout">
        <div className="section-callout-title">
          Cruces contenido × suscriptores
          <InfoHint text="Los bloques que siguen cruzan el catálogo (por fecha del partido) con la base de Subscribers activos, que sale de los Pagos y existe desde 2024-05. Antes de esa fecha hay audiencia pero no base." />
        </div>
        <div className="section-callout-body">
          Las visualizaciones siguientes combinan la audiencia con la base de
          suscriptores activos: <i>¿la audiencia crece junto con la base?</i>,{' '}
          <i>¿los eventos top traen altas?</i> El catálogo llega hasta 2020-10,
          pero los Pagos empiezan en 2024-05: estos cruces sólo pueden dibujar el
          solapamiento, así que los meses anteriores faltan por ausencia de base,
          no por ausencia de audiencia. Ojo también con los relojes: la fecha del
          contenido es la del partido y la del Pago es hora local de Argentina
          guardada como UTC, así que un partido de la última noche del mes puede
          caer un mes al lado de las altas que empujó.
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">
          🔗 Audiencia mensual vs suscriptores activos
          <InfoHint text="Views del mes (por fecha del contenido) contra los Subscribers activos el último día de ese mes, según la vista diaria de activos. Sólo meses con ambas series." />
        </div>
        <div className="chart-desc">
          Barras: views mensuales (eje izquierdo). Línea: suscriptores activos al
          cierre del mes (eje derecho). Si la audiencia crece más rápido que la
          base hay <b>upside</b> de engagement; si crece menos, hay fatiga de
          consumo.
        </div>
        {crossed.labels.length === 0 ? (
          <div className="no-data">Sin meses con audiencia y base activa a la vez</div>
        ) : (
          <ComboChart
            labels={crossed.labels}
            bars={[{ label: 'Views mensuales', data: crossed.views, color: VIEWS }]}
            lines={[{ label: 'Suscriptores activos (cierre de mes)', data: crossed.active, color: ACTIVE }]}
            barAxisTitle="Views"
            lineAxisTitle="Activos"
            height={330}
          />
        )}
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">
          📊 Engagement: views por activo
          <InfoHint text="Views del mes divididas por Subscribers activos al cierre de ese mes. Las views son acumuladas de las piezas emitidas ese mes, así que el ratio mezcla audiencia posterior con la base de ese momento." />
        </div>
          <div className="chart-desc">
            Ratio mensual <b>views ÷ activos</b>: cuántas veces, en promedio, cada
            suscriptor activo ve contenido en el mes. Creciente indica mayor
            consumo unitario.
          </div>
          {crossed.labels.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            <LineChart
              height={300}
              labels={crossed.labels}
              series={[{ label: 'Views por activo', data: crossed.ratio, color: RATIO, fill: true }]}
            />
          )}
        </div>

        <div className="chart-card">
          <div className="chart-title">
          🎯 Top eventos × altas del mismo día
          <InfoHint text="Los 12 contenidos más vistos y los Pagos de alta del mismo día: primer Pago de un Subscriber, o reactivación tras más de 7 días vencido. Coincidencia de fecha, no causalidad." />
        </div>
          <div className="chart-desc">
            Los 12 contenidos más vistos del rango, con las altas reales de ese
            mismo día. Un evento sólo aparece como conversión si la persona se
            suscribió el mismo día, así que esto detecta qué partidos movieron la
            base, no cuánta base trajo cada uno.
          </div>
          <div className="table-scroll" style={{ maxHeight: 340 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Partido / Título</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Altas del día</th>
                </tr>
              </thead>
              <tbody>
                {data.topEventDays.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="no-data">Sin eventos en el rango</td>
                  </tr>
                ) : (
                  data.topEventDays.map((r, i) => (
                    <tr key={`${r.date}:${i}`}>
                      <td style={{ color: 'var(--text3)' }}>{r.date}</td>
                      <td>{r.team1 && r.team2 ? `${r.team1} vs ${r.team2}` : r.title || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.views)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <b>{fmt(r.newSubs + r.reactivated)}</b>
                        <div style={{ color: 'var(--text3)', fontSize: 10 }}>
                          {fmt(r.newSubs)} nuevas + {fmt(r.reactivated)} react
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, lineHeight: 1.6 }}>
        Catálogo filtrado como en el prototipo: sólo contenido publicado
        (<code>status = 1</code>) y con al menos {data.catalogue.minAvgSecondsPerView}{' '}
        segundos vistos por view. De {fmt(data.catalogue.rowsInRange)} filas en el
        rango quedan {fmt(data.catalogue.rowsKept)}:{' '}
        {fmt(data.catalogue.rowsDroppedStatus)} sin publicar y{' '}
        {fmt(data.catalogue.rowsDroppedShort)} demasiado cortas — tráilers,
        emisiones de prueba y reproducciones abortadas.
      </div>
    </>
  );
}
