/**
 * The country a Subscriber carries is the English short name from the panel
 * ("United States of America", "Bolivia (Plurinational State of)"). The
 * prototype keyed its flags by ISO code, so this is the bridge: name → code,
 * flag from the code's regional indicators, and a Spanish label for the tab.
 */
const ISO: Record<string, string> = {
  Argentina: 'AR', Uruguay: 'UY', Chile: 'CL', Ecuador: 'EC', Brazil: 'BR',
  'Dominican Republic': 'DO', 'United States of America': 'US',
  'Bolivia (Plurinational State of)': 'BO', Spain: 'ES', Peru: 'PE', Mexico: 'MX',
  Colombia: 'CO', Italy: 'IT', 'Venezuela (Bolivarian Republic of)': 'VE', Paraguay: 'PY',
  Portugal: 'PT', Canada: 'CA', Australia: 'AU', France: 'FR', Panama: 'PA',
  'United Kingdom of Great Britain and Northern Ireland': 'GB', Germany: 'DE',
  'Costa Rica': 'CR', Netherlands: 'NL', 'Russian Federation': 'RU', 'Puerto Rico': 'PR',
  Ireland: 'IE', Pakistan: 'PK', Israel: 'IL', Turkey: 'TR', Türkiye: 'TR', 'New Zealand': 'NZ',
  Andorra: 'AD', Angola: 'AO', Switzerland: 'CH', Austria: 'AT', Poland: 'PL', Japan: 'JP',
  Denmark: 'DK', Belgium: 'BE', 'South Sudan': 'SS', Sweden: 'SE', Aruba: 'AW', Greece: 'GR',
  'El Salvador': 'SV', Philippines: 'PH', 'United Arab Emirates': 'AE', Guatemala: 'GT',
  Norway: 'NO', Kenya: 'KE', Albania: 'AL', Belize: 'BZ', 'Hong Kong': 'HK', Armenia: 'AM',
  'Bosnia and Herzegovina': 'BA', Romania: 'RO', Serbia: 'RS', India: 'IN', Ukraine: 'UA',
  Indonesia: 'ID', Malaysia: 'MY', Singapore: 'SG', Nicaragua: 'NI', Barbados: 'BB',
  Slovakia: 'SK', 'South Africa': 'ZA', Hungary: 'HU', 'Moldova (Republic of)': 'MD',
  Egypt: 'EG', Honduras: 'HN', Croatia: 'HR', Cuba: 'CU', Czechia: 'CZ', Lithuania: 'LT',
  Belarus: 'BY', Curaçao: 'CW', Bangladesh: 'BD', China: 'CN', Morocco: 'MA', Nigeria: 'NG',
  Georgia: 'GE', Thailand: 'TH', 'Korea (Republic of)': 'KR', 'Taiwan (Province of China)': 'TW',
  Jamaica: 'JM', Finland: 'FI', Bulgaria: 'BG', Iceland: 'IS', Jordan: 'JO', 'Saudi Arabia': 'SA',
  'Antigua and Barbuda': 'AG', 'Viet Nam': 'VN', Bahamas: 'BS', Bahrain: 'BH', Malta: 'MT',
  Luxembourg: 'LU', Qatar: 'QA', Ghana: 'GH', Slovenia: 'SI', Estonia: 'EE', Cyprus: 'CY',
  Azerbaijan: 'AZ', Mongolia: 'MN', Ethiopia: 'ET', Uganda: 'UG', Iraq: 'IQ',
  'Virgin Islands (U.S.)': 'VI', 'Sint Maarten (Dutch part)': 'SX', Lebanon: 'LB',
  'Equatorial Guinea': 'GQ', Latvia: 'LV', Rwanda: 'RW', Algeria: 'DZ', Afghanistan: 'AF',
  'Turks and Caicos Islands': 'TC', Bermuda: 'BM', Guadeloupe: 'GP', Gibraltar: 'GI',
  Martinique: 'MQ', 'Saint Kitts and Nevis': 'KN', Guyana: 'GY', 'Saint Martin (French part)': 'MF',
  Senegal: 'SN', 'Iran (Islamic Republic of)': 'IR', Malawi: 'MW', Uzbekistan: 'UZ',
  'Congo (Democratic Republic of the)': 'CD', 'Syrian Arab Republic': 'SY',
  'Palestine, State of': 'PS', 'Tanzania, United Republic of': 'TZ', Tunisia: 'TN',
  'North Macedonia': 'MK', Kazakhstan: 'KZ', Kyrgyzstan: 'KG', 'Sri Lanka': 'LK', Nepal: 'NP',
  'Trinidad and Tobago': 'TT', Haiti: 'HT', 'Cayman Islands': 'KY', Suriname: 'SR',
  'Dominica': 'DM', Grenada: 'GD', 'Saint Lucia': 'LC', 'Cabo Verde': 'CV', Cameroon: 'CM',
  "Côte d'Ivoire": 'CI', Mozambique: 'MZ', Zambia: 'ZM', Zimbabwe: 'ZW', Oman: 'OM', Kuwait: 'KW',
  Macao: 'MO', Montenegro: 'ME', Liechtenstein: 'LI', Monaco: 'MC', 'San Marino': 'SM',
  'Holy See': 'VA', Greenland: 'GL', 'Faroe Islands': 'FO', 'Isle of Man': 'IM', Jersey: 'JE',
  Guernsey: 'GG', 'French Guiana': 'GF', 'Bonaire, Sint Eustatius and Saba': 'BQ',
  'Brunei Darussalam': 'BN', 'Lao People\'s Democratic Republic': 'LA', Cambodia: 'KH', Myanmar: 'MM',
};

const ES: Record<string, string> = {
  AR: 'Argentina', UY: 'Uruguay', CL: 'Chile', EC: 'Ecuador', BR: 'Brasil', DO: 'Rep. Dominicana',
  US: 'Estados Unidos', BO: 'Bolivia', ES: 'España', PE: 'Perú', MX: 'México', CO: 'Colombia',
  IT: 'Italia', VE: 'Venezuela', PY: 'Paraguay', PT: 'Portugal', CA: 'Canadá', AU: 'Australia',
  FR: 'Francia', PA: 'Panamá', GB: 'Reino Unido', DE: 'Alemania', CR: 'Costa Rica',
  NL: 'Países Bajos', RU: 'Rusia', PR: 'Puerto Rico', IE: 'Irlanda', PK: 'Pakistán', IL: 'Israel',
  TR: 'Turquía', NZ: 'Nueva Zelanda', AD: 'Andorra', AO: 'Angola', CH: 'Suiza', AT: 'Austria',
  PL: 'Polonia', JP: 'Japón', DK: 'Dinamarca', BE: 'Bélgica', SS: 'Sudán del Sur', SE: 'Suecia',
  AW: 'Aruba', GR: 'Grecia', SV: 'El Salvador', PH: 'Filipinas', AE: 'Emiratos Árabes',
  GT: 'Guatemala', NO: 'Noruega', KE: 'Kenia', AL: 'Albania', BZ: 'Belice', HK: 'Hong Kong',
  AM: 'Armenia', BA: 'Bosnia y Herzegovina', RO: 'Rumania', RS: 'Serbia', IN: 'India',
  UA: 'Ucrania', ID: 'Indonesia', MY: 'Malasia', SG: 'Singapur', NI: 'Nicaragua', BB: 'Barbados',
  SK: 'Eslovaquia', ZA: 'Sudáfrica', HU: 'Hungría', MD: 'Moldavia', EG: 'Egipto', HN: 'Honduras',
  HR: 'Croacia', CU: 'Cuba', CZ: 'Chequia', LT: 'Lituania', BY: 'Bielorrusia', CW: 'Curazao',
  BD: 'Bangladés', CN: 'China', MA: 'Marruecos', NG: 'Nigeria', GE: 'Georgia', TH: 'Tailandia',
  KR: 'Corea del Sur', TW: 'Taiwán', JM: 'Jamaica', FI: 'Finlandia', BG: 'Bulgaria', IS: 'Islandia',
  JO: 'Jordania', SA: 'Arabia Saudita', AG: 'Antigua y Barbuda', VN: 'Vietnam', BS: 'Bahamas',
  BH: 'Baréin', MT: 'Malta', LU: 'Luxemburgo', QA: 'Catar', GH: 'Ghana', SI: 'Eslovenia',
  EE: 'Estonia', CY: 'Chipre', AZ: 'Azerbaiyán', MN: 'Mongolia', ET: 'Etiopía', UG: 'Uganda',
  IQ: 'Irak', VI: 'Islas Vírgenes (EE. UU.)', SX: 'Sint Maarten', LB: 'Líbano',
  GQ: 'Guinea Ecuatorial', LV: 'Letonia', RW: 'Ruanda', DZ: 'Argelia', AF: 'Afganistán',
  TC: 'Islas Turcas y Caicos', BM: 'Bermudas', GP: 'Guadalupe', GI: 'Gibraltar', MQ: 'Martinica',
  KN: 'San Cristóbal y Nieves', GY: 'Guyana', MF: 'San Martín', SN: 'Senegal', IR: 'Irán',
  MW: 'Malaui', UZ: 'Uzbekistán', CD: 'Rep. Dem. del Congo', SY: 'Siria', PS: 'Palestina',
  TZ: 'Tanzania', TN: 'Túnez', MK: 'Macedonia del Norte',
};

export function isoOf(name: string): string | undefined {
  return ISO[name];
}

/** 🇦🇷 from "AR": two regional-indicator symbols. */
export function flagOf(name: string): string {
  if (name === 'GLOBAL') return '🌐';
  const iso = ISO[name];
  if (!iso) return '🏳️';
  return String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export function labelOf(name: string): string {
  if (name === 'GLOBAL') return 'Global';
  const iso = ISO[name];
  return (iso && ES[iso]) || name;
}
