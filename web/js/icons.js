'use strict';
/* ============================== ICONS (line icons on a 24 px grid, drawn for the Studio) ============================== */
const ICON_LIB = {
  sun: [
    'Sun / solar heat',
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'
  ],
  solarpv: ['Solar PV', '<path d="M3 15 6 6h15l-3 9Z"/><path d="M4.5 10.5h15M10.5 6l-3 9M16 6l-3 9M10.5 15v4M7 19h7"/>'],
  wind: [
    'Wind',
    '<path d="M12 10.5V22M9 22h6"/><circle cx="12" cy="9" r="1.5"/><path d="M12 7.5 12.8 2M13.3 9.8l4.8 2.7M10.7 9.8l-4.8 2.7"/>'
  ],
  hydro: ['Hydro / dam', '<path d="M2 21h20M4 21V7h4l3 14"/><path d="M12 11q1.5-1.5 3 0t3 0 3 0M12 15q1.5-1.5 3 0t3 0 3 0"/>'],
  water: ['Water', '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/>'],
  rain: [
    'Rain / precipitation',
    '<path d="M7 14h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1A3 3 0 0 0 7 14Z"/><path d="m8.5 17-1 3M12.5 17l-1 3M16.5 17l-1 3"/>'
  ],
  groundwater: [
    'Groundwater',
    '<path d="M2 8h20"/><path d="M4 11.5h4M10 11.5h4M16 11.5h4"/><path d="M12 14.5s-2.5 2.8-2.5 4.5a2.5 2.5 0 0 0 5 0c0-1.7-2.5-4.5-2.5-4.5Z"/>'
  ],
  irrigation: [
    'Irrigation',
    '<path d="M12 22v-7"/><path d="M12 15c-3 0-5-2-5-5 3 0 5 2 5 5ZM12 17c3 0 5-2 5-5-3 0-5 2-5 5Z"/><path d="m4 3 .8 2M8 2l.8 2M16 2l-.8 2M20 3l-.8 2"/>'
  ],
  desal: [
    'Desalination',
    '<path d="M12 3s-4 4.5-4 7.5a4 4 0 0 0 8 0C16 7.5 12 3 12 3Z"/><path d="M2 17q2.5-2 5 0t5 0 5 0 5 0M2 21q2.5-2 5 0t5 0 5 0 5 0"/>'
  ],
  bolt: ['Electricity', '<path d="M13 2 4 14h7l-1 8 10-13h-7Z"/>'],
  pylon: ['Transmission / grid', '<path d="M8 22 12 3l4 19M9.4 15.5h5.2M10.5 10h3M5 7.5h14M7 7.5l2.3 2.5M17 7.5 14.7 10"/>'],
  plug: ['Distribution', '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v5"/>'],
  bulb: [
    'Lighting',
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1v1h5v-1c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>'
  ],
  coal: [
    'Coal',
    '<path d="M3 9h18l-2 8H5Z"/><circle cx="8" cy="19.5" r="1.5"/><circle cx="16" cy="19.5" r="1.5"/><path d="M6.5 9a2.2 2.2 0 0 1 4.2-1.2 2.2 2.2 0 0 1 4 .1 2 2 0 0 1 3.2 1.1"/>'
  ],
  oil: ['Oil / oil products', '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 8h12M6 16h12"/>'],
  derrick: ['Oil & gas extraction', '<path d="M7 22 12 2l5 20M8.3 17h7.4M9.6 11.5h4.8M10.8 6.5h2.4M5 22h14"/>'],
  refinery: ['Refinery', '<path d="M2 21h20M4 21V9h4v12M10 21V4h4v17M16 21v-9h4v9"/><path d="M5 9V6M12 4V2"/>'],
  gas: [
    'Natural gas',
    '<path d="M12 2c2 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 0-4 0-6 1-9Z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-2 2.5-4 2.5-4s2.5 2 2.5 4A2.5 2.5 0 0 1 12 21Z"/>'
  ],
  ship: ['LNG / shipping', '<path d="M3 15h18l-3 4.5H6Z"/><path d="M7 15v-4h10v4M10 11V7h4v4"/><path d="M2 22q2.5-1.5 5 0t5 0 5 0 5 0"/>'],
  pipeline: ['Pipeline', '<path d="M2 9h20M2 15h20M6 6.5v11M18 6.5v11"/><path d="m10 10 4 4M14 10l-4 4"/>'],
  nuclear: [
    'Nuclear',
    '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)"/>'
  ],
  geothermal: ['Geothermal', '<path d="M2 21 9 10h6l7 11Z"/><path d="M10 7q1-2 0-4M14 7q1-2 0-4"/>'],
  biomass: ['Biomass', '<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15Z"/><path d="m5 19 8-8"/>'],
  forest: ['Forest / wood', '<path d="M12 2 5 12h4l-4 6h14l-4-6h4Z"/><path d="M12 18v4"/>'],
  crop: [
    'Crops',
    '<path d="M12 22V6"/><path d="M12 6c-1.5-1-2-2.5-2-4 1.5.5 2 2 2 4ZM12 6c1.5-1 2-2.5 2-4-1.5.5-2 2-2 4Z"/><path d="M12 10.5c-2 0-4-1.5-4.5-3.5 2 0 4 1.5 4.5 3.5ZM12 10.5c2 0 4-1.5 4.5-3.5-2 0-4 1.5-4.5 3.5ZM12 15c-2 0-4-1.5-4.5-3.5 2 0 4 1.5 4.5 3.5ZM12 15c2 0 4-1.5 4.5-3.5-2 0-4 1.5-4.5 3.5Z"/>'
  ],
  livestock: [
    'Livestock',
    '<path d="M7 7c0-2 2-3 5-3s5 1 5 3v7c0 4-2 6-5 6s-5-2-5-6Z"/><path d="M7 7 3 5.5l2 3.5M17 7l4-1.5-2 3.5"/><ellipse cx="12" cy="16" rx="3.5" ry="2.2"/><path d="M10.6 16h.01M13.4 16h.01"/>'
  ],
  land: ['Land', '<path d="M2 20 9 8l4 6 3-4 6 10Z"/><circle cx="17" cy="5" r="2"/>'],
  fertiliser: [
    'Fertiliser',
    '<path d="M7 4h10l2 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8Z"/><path d="M5 8h14"/><path d="M9.5 17.5c0-3 2-5 5-5 0 3-2 5-5 5Z"/>'
  ],
  food: ['Food', '<path d="M3 11h18c0 5-4 9-9 9s-9-4-9-9Z"/><path d="M9 7.5q1-2 0-4M12 7.5q1-2 0-4M15 7.5q1-2 0-4"/>'],
  factory: ['Industry', '<path d="M2 21h20M3 21V11l6 4v-4l6 4V4h5v17"/><path d="M7 18h2M12 18h2"/>'],
  house: ['Residential / buildings', '<path d="m3 11 9-8 9 8M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'],
  car: [
    'Transport',
    '<path d="M5 16v-4l2-5h10l2 5v4Z"/><path d="M5 12h14"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/>'
  ],
  truck: ['Freight', '<path d="M2 6h12v11H2ZM14 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'],
  heat: ['Heat', '<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z"/><path d="M12 9v8"/>'],
  cooling: ['Cooling', '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'],
  battery: ['Battery / storage', '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 10.5v3M6 10v4M10 10v4"/>'],
  reservoir: [
    'Reservoir / dam lake',
    '<path d="M3 4v16h4"/><path d="M3 20h18"/><path d="M8 9q2-1.5 4 0t4 0 4 0M8 13q2-1.5 4 0t4 0 4 0M8 17q2-1.5 4 0t4 0 4 0"/>'
  ],
  aquifer: [
    'Aquifer (groundwater store)',
    '<path d="M2 6h20M2 10h20"/><path d="M3 14.5q2.25-1.5 4.5 0t4.5 0 4.5 0 4.5 0M3 19q2.25-1.5 4.5 0t4.5 0 4.5 0 4.5 0"/><path d="M12 2v6"/>'
  ],
  silo: ['Silo / grain store', '<path d="M6 21V9a6 4 0 0 1 12 0v12"/><path d="M4 21h16M6 13h12M6 17h12"/><path d="M12 5v-2"/>'],
  tank: ['Storage tank', '<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14a7 2.5 0 0 0 14 0V5M5 12a7 2.5 0 0 0 14 0"/>'],
  hydrogen: [
    'Hydrogen',
    '<circle cx="7.5" cy="12" r="4.5"/><circle cx="16.5" cy="12" r="4.5"/><path d="M6 10.2v3.6M9 10.2v3.6M6 12h3M15 10.2v3.6M18 10.2v3.6M15 12h3"/>'
  ],
  emission: [
    'Emissions / CO2',
    '<path d="M4 21V11h4v10M2 21h10"/><path d="M7 8a2 2 0 1 1 3-2.5 2.5 2.5 0 0 1 4.5 1 2 2 0 1 1 1.5 3.5H9.5A1.7 1.7 0 0 1 7 8Z"/>'
  ],
  waste: ['Waste', '<path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'],
  trade: ['Trade link', '<path d="M4 8h16l-4-4M20 16H4l4 4"/>'],
  import: ['Import', '<path d="M3 12h12M11 8l4 4-4 4M17 4h4v16h-4"/>'],
  export: ['Export', '<path d="M9 12h12M17 8l4 4-4 4M7 4H3v16h4"/>'],
  mine: ['Mining', '<path d="M3 21 13 11"/><path d="M8 4c5-1.5 10 0 12.5 5-3.5-2-8-2.5-11-1.5Z"/>'],
  pump: ['Pumping', '<circle cx="9" cy="13" r="5"/><path d="M14 13h7V9M9 8V3H5M4 21h10M7 17.5 6 21M11 17.5l1 3.5"/>'],
  demand: ['Final demand', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>'],
  people: ['Labour / people', '<circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>'],
  money: [
    'Money / finance',
    '<circle cx="12" cy="12" r="9"/><path d="M14.6 8.6c-.5-1-1.5-1.6-2.6-1.6-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.2 0-2.3-.6-2.8-1.6M12 5.5v13"/>'
  ],
  backstop: ['Backstop', '<path d="M12 3 22 20H2Z"/><path d="M12 9v5M12 17v.5"/>'],
  process: [
    'Process (generic)',
    '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'
  ]
};
/* suggestion from the code and description (first rule that matches) */
const ICON_RULES = [
  [/BACKSTOP/i, 'backstop'],
  [/FALLOW|JACHERE/i, 'land'],
  [/DEMIND|INDELC|INDUSTR/i, 'factory'],
  [/DSLN|DESAL|SEAWATER/i, 'desal'],
  [/CSP|SOL003|CONCENTRAT/i, 'sun'],
  [/SOL|\bPV\b|PHOTOVOLT|SOLAR/i, 'solarpv'],
  [/WND|WIND/i, 'wind'],
  [/HYD(?!RO?GEN)|HYDRO|\bDAM\b/i, 'hydro'],
  [/NUC|URAN/i, 'nuclear'],
  [/GEO/i, 'geothermal'],
  [/(^|[^S])H2|HYDROGEN|LYZ|ELECTROLY/i, 'hydrogen'],
  [/BATT|BATTERY/i, 'battery'],
  [/STOR|STO\b/i, 'tank'],
  [/PRC|PRECIP|RAIN/i, 'rain'],
  [/[^A]GRWTR|^GRWTR|GRND|GROUND/i, 'groundwater'],
  [/IRR/i, 'irrigation'],
  [/WTR|WATER|EVAP/i, 'water'],
  [/FERT/i, 'fertiliser'],
  [/LIVSTK|LIVESTOCK|CATTLE|PASTURE|PSTLND|MEAT|MILK/i, 'livestock'],
  [/CRP|CROP|WHEAT|WEAT|MAIZE|RICE|BARLEY|BRL|BRLY|AGRLAND|CEREAL|^L(SW|DW)[IR]$/i, 'crop'],
  [/FOR|FOREST|WOOD/i, 'forest'],
  [/LND|LAND/i, 'land'],
  [/BLD|BULD|DMND/i, 'house'],
  [/BIO|BIOMASS/i, 'biomass'],
  [/WST|WASTE/i, 'waste'],
  [/CO2|EMIS|CARBON/i, 'emission'],
  [/LNG|REGAS|LIQUEF/i, 'ship'],
  [/PIP|PIPELINE/i, 'pipeline'],
  [/COA|COAL|LIGN/i, 'coal'],
  [/REF|REFIN/i, 'refinery'],
  [/GAS|NGS|^NG\d|METHANE/i, 'gas'],
  [/OIL|DSL|DIESEL|PETR|CRU|HFO|LPG|KER|GSL/i, 'oil'],
  [/TRNEL|TRNGAS|INTERCON|LINK/i, 'trade'],
  [/^IMP|IMPORT/i, 'import'],
  [/^EXP|EXPORT/i, 'export'],
  [/TRNS|TRANSM|GRID/i, 'pylon'],
  [/DIST/i, 'plug'],
  [/MIN|MINING|EXTRACT/i, 'mine'],
  [/PUMP/i, 'pump'],
  [/IND|INDUSTR|FACTOR/i, 'factory'],
  [/RES|HOUSE|RESID|BUILD|COM|TERS|SERVIC/i, 'house'],
  [/TRA|TRP|TRANSPORT|CAR|VEH/i, 'car'],
  [/AGR/i, 'crop'],
  [/LBR|LABOU?R/i, 'people'],
  [/LIGHT/i, 'bulb'],
  [/HEAT/i, 'heat'],
  [/COOL/i, 'cooling'],
  [/FOOD/i, 'food'],
  [/ELC|ELEC|PWR|POWER/i, 'bolt'],
  [/DEM|DEMAND/i, 'demand']
];
let ICONS = {}; // chosen icon per technology / commodity code ('none' = no icon)
const ICONSET = (() => {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('mst_nos_icons') || '{}');
  } catch (e) {}
  return Object.assign({show: 'auto', style: 'line'}, s);
})();
const saveIconSet = () => {
  try {
    localStorage.setItem('mst_nos_icons', JSON.stringify(ICONSET));
  } catch (e) {}
};
/* storages: their own rules, never the gear */
const ICON_RULES_STO = [
  [/AQF|AQUIF|GWT|GROUND/i, 'aquifer'],
  [/DAM|RESERV|LAKE|BARRAGE/i, 'reservoir'],
  [/SILO|GRAIN|CEREAL|WHEAT/i, 'silo'],
  [/BATT|BATTERY|LI-?ION/i, 'battery'],
  [/H2|HYDROGEN/i, 'hydrogen'],
  [/GAS|NG/i, 'gas'],
  [/OIL|FUEL|DSL/i, 'oil'],
  [/HEAT|THERM/i, 'heat'],
  [/PUMPED|PSH|PHS/i, 'hydro']
];
const isStorage = code => typeof setOf === 'function' && (setOf('STORAGE') || []).map(String).includes(String(code));
function suggestIcon(code) {
  const d = (typeof TD !== 'undefined' && TD[code]) || (typeof FD !== 'undefined' && FD[code]) || '';
  if (isStorage(code)) {
    for (const [re, ic] of ICON_RULES_STO) if (re.test(code) || (d && re.test(d))) return ic;
    return 'tank';
  }
  for (const [re, ic] of ICON_RULES) if (re.test(code)) return ic;
  for (const [re, ic] of ICON_RULES) if (d && re.test(d)) return ic;
  return 'process';
}
function iconFor(code, show) {
  show = show || ICONSET.show;
  if (show === 'off') return null;
  const c = ICONS[code];
  if (c === 'none') return null;
  if (c && ICON_LIB[c]) return c;
  return show === 'auto' ? suggestIcon(code) : null;
}
/* draw icon `name` at (x,y), size s, colour col; style line | badge */
function iconSVG(name, x, y, s, col, style) {
  const ic = ICON_LIB[name];
  if (!ic) return '';
  const k = s / 24;
  if ((style || ICONSET.style) === 'badge')
    return `<g class="ico" transform="translate(${x},${y})"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="${col}"/><g transform="translate(${s * 0.18},${s * 0.18}) scale(${k * 0.64})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic[1]}</g></g>`;
  return `<g class="ico" transform="translate(${x},${y}) scale(${k})" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic[1]}</g>`;
}
function iconPicker(code, kind) {
  const cur = ICONS[code] || '',
    sug = suggestIcon(code);
  return `<div class="icp" data-code="${esc(code)}"><div class="icp-h">Icon <span class="muted">· suggested from the code and description: ${esc(ICON_LIB[sug][0])}</span></div><div class="icp-g">
    <button type="button" class="icb ${!cur ? 'on' : ''}" data-ic="" title="Automatic (${esc(ICON_LIB[sug][0])})"><svg viewBox="0 0 24 24">${ICON_LIB[sug][1]}</svg><span>Auto</span></button>
    <button type="button" class="icb ${cur === 'none' ? 'on' : ''}" data-ic="none" title="No icon"><svg viewBox="0 0 24 24"><path d="M5 5l14 14"/></svg><span>None</span></button>
    ${Object.entries(ICON_LIB)
      .map(
        ([k, v]) =>
          `<button type="button" class="icb ${cur === k ? 'on' : ''}" data-ic="${k}" title="${esc(v[0])}"><svg viewBox="0 0 24 24">${v[1]}</svg></button>`
      )
      .join('')}</div></div>`;
}
function wireIconPicker(host, onChange) {
  host.querySelectorAll('.icp').forEach(p =>
    p.querySelectorAll('.icb').forEach(
      b =>
        (b.onclick = () => {
          const code = p.dataset.code,
            v = b.dataset.ic;
          if (v) ICONS[code] = v;
          else delete ICONS[code];
          p.querySelectorAll('.icb').forEach(x => x.classList.toggle('on', x === b));
          onChange && onChange();
        })
    )
  );
}
