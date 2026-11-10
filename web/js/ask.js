/* ============================== Ask the results (no AI) ==============================
   A question is read without any AI, on this computer: its parts are found in it
     what      a measure (emissions, capacity, production, use, cost...) from a word list in English, French, Spanish, Arabic
     which     technologies, commodities, emissions, regions, storages of the run: by code or by their description
     when      years (2045, 2030-2050, from 2030 to 2050, first / last year)
     how       total, by technology / region / commodity / year / season, the most / the least, the share, compare runs
   then the answer is computed from the run's results (the same data as Results), with the reading shown, so it can be
   checked, and opened in Results. When a part is unclear, the Studio asks back with choices. Words in French, Spanish or
   Arabic are also matched through the Studio's translation tables (e.g. الماء -> Water). */
const ASK = {run: '', hist: [], pick: {}};

/* ---------- words ---------- */
const askNorm = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents (é -> e)
    .replace(/[\u064B-\u0655\u0670\u0640]/g, '') // Arabic short vowels, hamza marks, tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[؟?!,;:()«»"“”'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Arabic article and joined prepositions; plural s
const askStem = w => {
  if (/[؀-ۿ]/.test(w)) return w.replace(/^(وال|بال|كال|فال|لل|ال)(?=..)/, '').replace(/(ات|ين|ون)$/, '');
  return w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '') : w;
};
const askWords = s =>
  askNorm(s)
    .split(/[\s/·\-–—]+/)
    .filter(Boolean)
    .map(askStem);
const ASK_STOP = new Set(
  (
    'the a an of in on at for to by and or is are was what how much many which who whose with from per each all any do does did show me give tell total value ' +
    'le la les des du de d l un une en au aux et ou est sont quel quelle quels quelles combien pour par sur dans avec chaque tous toutes ' +
    'el la los las del de un una en y o es son cual cuales cuanto cuanta cuantos para por con cada todos todas que ' +
    'ما ماذا كم في من الى إلى على عن و او أو هي هو كل حسب لكل مع هل التي الذي سنه عام'
  )
    .split(' ')
    .map(askStem)
);

/* measures: [key, label, variable with a technology, variable without, stock?, words] */
const ASK_MEASURES = [
  ['emis', 'Emissions', 'AnnualTechnologyEmission', 'AnnualEmissions', false, 'emission,emissions,emit,emits,emitted,co2,carbon,ghg,emet,emis,carbone,emision,emisiones,emite,carbono,انبعاث,انبعاثات,تنبعث,كربون'],
  ['newcap', 'New capacity', 'NewCapacity', 'NewCapacity', false, 'new capacity,built,build,nouvelle capacite,capacite nouvelle,construit,construite,nueva capacidad,construida,قدره جديده,بناء,يبني'],
  ['cap', 'Capacity', 'TotalCapacityAnnual', 'TotalCapacityAnnual', true, 'capacity,capacities,installed,capacite,capacites,installee,capacidad,capacidades,instalada,قدره,قدرات,مركبه'],
  ['inv', 'Investment', 'CapitalInvestment', 'CapitalInvestment', false, 'investment,investments,invest,capital,investissement,investissements,inversion,inversiones,استثمار,استثمارات'],
  ['cost', 'Total discounted cost', 'TotalDiscountedCost', 'TotalDiscountedCost', false, 'cost,costs,system cost,objective,cout,couts,costo,costos,coste,تكلفه,تكاليف,كلفه'],
  ['prod', 'Production', 'ProductionByTechnologyAnnual', 'ProductionAnnual', false, 'production,produce,produces,produced,generation,generate,generates,output,supply,produit,produite,produisent,genere,produccion,producido,generacion,produce,انتاج,ينتج,توليد,يولد'],
  ['use', 'Use', 'UseByTechnologyAnnual', 'UseAnnual', false, 'use,uses,used,consumption,consume,consumes,consommation,consomme,utilise,utilisee,consumo,uso,usa,usado,استهلاك,يستهلك,استخدام,يستخدم'],
  ['dem', 'Demand', 'Demand', 'Demand', false, 'demand,demande,demanda,طلب'],
  ['act', 'Activity', 'TotalTechnologyAnnualActivity', 'TotalTechnologyAnnualActivity', false, 'activity,activite,actividad,نشاط'],
  ['stl', 'Storage level', 'StorageLevelYearFinish', 'StorageLevelYearFinish', true, 'storage level,level,niveau,nivel,مستوى,منسوب'],
  ['chg', 'Storage charge', 'StorageChargeAnnual', 'StorageChargeAnnual', false, 'charge,charged,charging,chargee,carga,cargado,شحن'],
  ['dis', 'Storage discharge', 'StorageDischargeAnnual', 'StorageDischargeAnnual', false, 'discharge,discharged,decharge,descarga,تفريغ'],
  ['trade', 'Net exports', 'NetExports', 'NetExports', false, 'export,exports,trade,net exports,exportation,exportations,commerce,echange,exportacion,exportaciones,comercio,تصدير,صادرات,تجاره'],
  ['yield', 'Crop yield', 'CropYield', 'CropYield', false, 'yield,yields,rendement,rendimiento,مردود,غله'],
  ['rev', 'Sales revenue', 'SalesRevenueByTechnology', 'SalesRevenue', false, 'revenue,revenues,sales,revenu,revenus,ventes,ingreso,ingresos,ventas,ايراد,ايرادات,مبيعات']
];
// "by ..." words -> a field of the results
const ASK_BY = [
  ['TECHNOLOGY', 'technology technologies tech techs|technologie technologies|tecnologia tecnologias|تقنيه تقنيات تكنولوجيا'],
  ['REGION', 'region regions zone zones country|region regions zone pays|region regiones zona pais|منطقه مناطق بلد'],
  ['COMMODITY', 'commodity commodities fuel fuels|produit produits combustible|producto productos combustible|سلعه سلع وقود'],
  ['EMISSION', 'emission emissions|emission emissions|emision emisiones|انبعاث'],
  ['YEAR', 'year years over time yearly annual|an annee annees chaque annee|ano anos cada ano|سنه سنوات عام اعوام'],
  ['TIMESLICE', 'time slice slices timeslice timeslices|tranche tranches|intervalo intervalos|شريحه شرائح'],
  ['SEASON', 'season seasons month months monthly seasonal|saison saisons mois mensuel saisonnier|estacion estaciones mes meses mensual estacional|موسم مواسم فصل فصول شهر اشهر شهري موسمي'],
  ['STORAGE', 'storage storages|stockage|almacenamiento|مخزن تخزين']
];
// "without counting GWT", "sauf", "sin", "بدون": the items named after these words are left out
const ASK_EXCL = ['without counting', 'not counting', 'other than', 'apart from', 'without', 'excluding', 'except', 'sans compter', 'sans', 'hors', 'sauf', 'sin contar', 'sin', 'excepto', 'salvo', 'بدون', 'دون', 'باستثناء', 'ماعدا', 'عدا'];
const ASK_EXCL_END = /\s(per|by|par|por|para|in|en|dans|du|for|pour|during|pendant|durante|from|of|حسب|لكل|في|خلال)\s/;
// a yearly result asked "per season" or "per time slice": its version by time slice (the slices add up to the year)
const ASK_TS = {
  UseByTechnologyAnnual: 'UseByTechnology',
  UseAnnual: 'UseByTechnology',
  ProductionByTechnologyAnnual: 'ProductionByTechnology',
  ProductionAnnual: 'ProductionByTechnology',
  TotalTechnologyAnnualActivity: 'TechnologyActivityTS',
  AnnualTechnologyEmission: 'AnnualTechnologyEmissionTS',
  AnnualEmissions: 'AnnualTechnologyEmissionTS',
  StorageChargeAnnual: 'StorageChargeTS',
  StorageDischargeAnnual: 'StorageDischargeTS'
};
function askSplitExcl(q) {
  const low = ' ' + String(q).toLowerCase() + ' ';
  let at = -1,
    len = 0;
  for (const w of ASK_EXCL) {
    const i = low.indexOf(' ' + w + ' ');
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = w.length + 2;
    }
  }
  if (at < 0) return {inc: q, exc: ''};
  const rest = low.slice(at + len - 1);
  const m = rest.match(ASK_EXCL_END);
  const exc = m ? rest.slice(0, m.index) : rest;
  const tail = m ? rest.slice(m.index) : '';
  // the original case is kept for short codes
  const o = ' ' + String(q) + ' ';
  return {inc: (o.slice(0, at) + ' ' + o.slice(at + len - 1 + exc.length)).trim(), exc: o.slice(at + len - 1, at + len - 1 + exc.length).trim(), tail};
}
const ASK_BYWORDS = 'by per for each|par pour chaque|por para cada|حسب لكل كل';
const ASK_OPS = {
  max: 'most highest largest biggest maximum max top|plus le plus grand maximum|mas mayor maximo|اكثر اكبر اعلى',
  min: 'least lowest smallest minimum min|moins petit minimum|menos menor minimo|اقل ادنى اصغر',
  share: 'share percent percentage %|part pourcentage|cuota porcentaje proporcion|نسبه حصه',
  total: 'total cumulative sum altogether whole period|total cumule somme ensemble|total acumulado suma|مجموع اجمالي اجماليه مجمل كلي كليه',
  cmp: 'compare comparison versus vs difference against|comparer comparaison difference contre|comparar comparacion diferencia frente|قارن مقارنه الفرق مقابل',
  first: 'first start beginning|premiere debut|primer primero inicio|اول بدايه',
  last: 'last end final|derniere fin|ultimo final|اخر نهايه'
};
const askSet = s => new Set(askWords(s.replace(/\|/g, ' ')));
const ASK_OPSET = Object.fromEntries(Object.entries(ASK_OPS).map(([k, v]) => [k, askSet(v)]));

/* ---------- reading ---------- */
// English words of the question: the words themselves, plus the English of any phrase found in the translation table
function askEnglish(q) {
  const out = [q];
  if (typeof I18N === 'undefined' || I18N.lang === 'en') return out.join(' ');
  if (!ASK.rev) {
    ASK.rev = new Map();
    for (const [en, t] of I18N.table()) if (en.split(' ').length <= 3 && !/\{/.test(en)) ASK.rev.set(askWords(t).join(' '), en);
  }
  const w = askWords(q);
  for (let n = 3; n >= 1; n--)
    for (let i = 0; i + n <= w.length; i++) {
      const en = ASK.rev.get(w.slice(i, i + n).join(' '));
      if (en) out.push(en);
    }
  return out.join(' ');
}
const askHas = (words, set) => words.some(w => set.has(w));
const askPhrase = (text, list) => list.split(/[|]/).some(p => p.split(' ').length > 1 && (' ' + text + ' ').includes(' ' + askWords(p).join(' ') + ' '));

function askMeasure(words, text) {
  let best = null;
  for (const m of ASK_MEASURES) {
    let sc = 0;
    for (const e of m[5].split(',')) {
      const w = askWords(e);
      if (w.length > 1 ? (' ' + text + ' ').includes(' ' + w.join(' ') + ' ') : words.includes(w[0])) sc = Math.max(sc, w.length);
    }
    if (sc && (!best || sc > best.sc)) best = {m, sc};
  }
  return best && best.m;
}
function askBy(text) {
  const out = [],
    bw = askSet(ASK_BYWORDS),
    w = text.split(' ');
  for (let i = 0; i < w.length - 1; i++) {
    if (!bw.has(w[i])) continue;
    const nxt = w.slice(i + 1, i + 3).join(' ');
    for (const [f, words] of ASK_BY) {
      const s = askSet(words);
      if (s.has(w[i + 1]) || askPhrase(nxt, words)) out.push(f);
    }
  }
  if (/(over time|chaque annee|cada ano|كل سنه|عبر الزمن)/.test(text)) out.push('YEAR');
  return [...new Set(out)];
}
function askYears(q, all) {
  const ys = [...String(q).matchAll(/(?<!\d)(1[89]\d\d|2[01]\d\d)(?!\d)/g)].map(m => m[1]);
  const t = askNorm(q);
  const rangeWord = /\d{4}\s*[-–]\s*\d{4}/.test(String(q)) || / (from|between|until|to|through|de|du|a|au|jusqu|entre|hasta|desde|من|الى|بين|حتي) /.test(' ' + t + ' ');
  if (ys.length >= 2 && rangeWord) {
    const [a, b] = [Math.min(...ys), Math.max(...ys)];
    return {years: all.filter(y => +y >= a && +y <= b), range: [a, b]};
  }
  if (ys.length) return {years: ys.filter(y => all.includes(y)), asked: ys};
  const w = askWords(q);
  if (askHas(w, ASK_OPSET.last) && /\b(year|annee|ano)\b|سنه|عام/.test(t)) return {years: [all[all.length - 1]]};
  if (askHas(w, ASK_OPSET.first) && /\b(year|annee|ano)\b|سنه|عام/.test(t)) return {years: [all[0]]};
  return {years: null};
}
// the members of a field named in the question (code, or the words of its description)
function askDesc(field, code) {
  // the descriptions of the run first (its own data file), then those of the open model
  const I = ASK.run && RV.info && RV.info[ASK.run];
  if (I) {
    if (I.desc && I.desc[code] && field !== 'REGION' && field !== 'YEAR') return I.desc[code];
    const sd = (I.setdesc || []).find(x => x[0] === field && x[1] === code);
    if (sd) return sd[2];
  }
  try {
    if (field === 'TECHNOLOGY') return TD[code] || sdesc('TECHNOLOGY', code);
    if (field === 'COMMODITY') return FD[code] || sdesc('COMMODITY', code) || sdesc('FUEL', code);
    if (field === 'REGION') return RNAME[code] !== code ? RNAME[code] : '';
    return sdesc(field, code);
  } catch (e) {
    return '';
  }
}
function askItems(field, members, q, text, used, skip) {
  const strong = [],
    weak = [],
    via = new Set(),
    single = new Set(),
    pair = new Set();
  const raw = ' ' + String(q).replace(/[?؟!,;:()]/g, ' ') + ' ';
  const tw = text.split(' ').filter(w => w && !ASK_STOP.has(w) && !used.has(w));
  for (const c of members) {
    // the code itself (short codes only as written, upper case)
    if (field !== 'TECHNOLOGY' && skip && skip.has(askStem(askNorm(c)))) continue; // "irrigated wheat" is the technology, not the commodity WHEAT
    if (c.length <= 2 ? raw.includes(' ' + c + ' ') : (' ' + text + ' ').includes(' ' + askNorm(c) + ' ')) {
      strong.push(c);
      via.add(askNorm(c));
      continue;
    }
    const d = askDesc(field, c);
    if (!d) continue;
    const main = askWords(String(d).split(/[:(]/)[0]).filter(w => !ASK_STOP.has(w) && w.length > 1);
    if (!main.length) continue;
    if (main.every(w => tw.includes(w))) {
      strong.push(c);
      main.forEach(w => via.add(w));
    }
    else {
      for (let i = 0; i + 1 < tw.length; i++) {
        const k = main.indexOf(tw[i]);
        if (k >= 0 && main[k + 1] === tw[i + 1]) {
          weak.push(c);
          pair.add(c);
          via.add(tw[i]).add(tw[i + 1]);
          break;
        }
      }
      const one = tw.find(w => w.length >= 4 && !/^\d+$/.test(w) && main.includes(w));
      if (!weak.includes(c) && one) {
        weak.push(c);
        single.add(one);
      }
    }
  }
  // two words in a row ("gas plant") beat one word ("plant" of "Desalination plant"); then the description sharing the most
  // words with the question wins ("Solar Power plant": Solar Power Plant PV, not Natural Gas Power plant)
  let wk = pair.size ? weak.filter(c => pair.has(c)) : weak;
  const score = c => {
    const main = askWords(String(askDesc(field, c)).split(/[:(]/)[0]);
    return main.filter(w => tw.includes(w)).length;
  };
  if (wk.length > 1) {
    const best = Math.max(...wk.map(score));
    wk = wk.filter(c => score(c) === best);
  }
  return strong.length ? {codes: strong, via} : wk.length ? {codes: wk, weak: true, via, single: pair.size ? new Set() : single} : null;
}

/* ---------- answering ---------- */
async function askAnswer(q) {
  const A = {q, notes: []};
  const en = askEnglish(q),
    text = askWords(en).join(' '),
    words = text.split(' ');
  await loadRuns();
  if (!RV.runs.length) return {...A, error: 'No solved runs yet: Solve to start one.'};
  const runIds = [ASK.run || RV.runs[0].id];
  // other runs named in the question (comparison)
  for (const r of RV.runs) {
    const n = askNorm(r.name || '');
    if (n && n.length > 2 && (' ' + text + ' ').includes(' ' + n + ' ') && !runIds.includes(r.id)) runIds.push(r.id);
  }
  if (askHas(words, ASK_OPSET.cmp) && runIds.length < 2) A.notes.push('To compare, name two runs in the question, or choose them below.');
  ASK.run = runIds[0];
  const info = await runInfo(runIds[0]),
    vd = info.vardims || {};
  // what: the exact name of a result (TotalCapacityAnnual, UseByTechnology...) or of an input parameter (CapitalCost...)
  const vnames = Object.keys(vd),
    inames = Object.keys(info.inputs || {});
  let direct = null;
  for (const t of String(q).split(/[^A-Za-z0-9_]+/).filter(x => x.length > 3)) {
    const lt = t.toLowerCase();
    const vn = vnames.find(n => n.toLowerCase() === lt) || (inames.find(n => n.toLowerCase() === lt) && 'IN.' + inames.find(n => n.toLowerCase() === lt));
    if (vn) {
      direct = vn;
      break;
    }
  }
  // a rate (per slice) or an input is shown as it is, never added up; a capacity or a level is not added over the years
  const noSum = direct && (/^IN\./.test(direct) || /^RateOf/.test(direct));
  const stockV = direct && /^(TotalCapacityAnnual|AccumulatedNew|StorageLevel|TotalStorageCapacity|NumberOf|Online|CapacityUnderConstruction|StorageUnderConstruction|TotalCapacityByVintage|StorageUpperLimit|StorageLowerLimit)/.test(direct);
  let m = direct
    ? ['var', direct.replace(/^IN\./, ''), direct, direct, !!stockV, direct.replace(/^IN\./, '').toLowerCase()]
    : ASK.pick.measure
      ? ASK_MEASURES.find(x => x[0] === ASK.pick.measure)
      : askMeasure(words, text);
  const used = new Set();
  if (m) askWords(m[5].replace(/,/g, ' ')).forEach(w => used.add(w));
  Object.values(ASK_OPS).forEach(v => askWords(v.replace(/\|/g, ' ')).forEach(w => used.add(w)));
  [ASK_BYWORDS, ...ASK_BY.map(x => x[1])].forEach(v => askWords(v.replace(/\|/g, ' ')).forEach(w => used.add(w)));
  // which (matched on the members of the richest variable of the measure)
  const probe = direct || (m ? (vd[m[2]] ? m[2] : m[3]) : 'ProductionByTechnologyAnnual');
  const P = vd[probe] || direct ? await getVar(runIds[0], probe) : {rows: []};
  const pdims = P.dims || varDims(probe, (P.rows[0] || []).length - 1, runIds[0]);
  const found = {};
  const SX = askSplitExcl(q),
    enI = SX.exc ? askEnglish(SX.inc) : en,
    textI = SX.exc ? askWords(enI).join(' ') : text,
    enE = SX.exc ? askEnglish(SX.exc) : '',
    textE = SX.exc ? askWords(enE).join(' ') : '';
  const techWords = new Set();
  const order = pdims.map((f, i) => [f, i]).sort((a, b) => (b[0] === 'TECHNOLOGY') - (a[0] === 'TECHNOLOGY'));
  order.forEach(([f, i]) => {
    if (f === 'YEAR' || !P.rows.length) return;
    // the members in the results, and every member of the open model (a technology may have no value in this result)
    let setm = [];
    try {
      const S = M && M.D && M.D.sets;
      setm = (S && (S[f] || (f === 'COMMODITY' && S.FUEL))) || [];
    } catch (e) {}
    // and every member of the run's own data (a technology with no value at all is still named)
    const RS = info.sets || {};
    const runm = RS[f] || (f === 'COMMODITY' && RS.FUEL) || [];
    const mem = [...new Set([...P.rows.map(r => String(r[i])), ...runm.map(String), ...(info.sets ? [] : setm.map(String))])];
    let hit = ASK.pick[f] ? {codes: ASK.pick[f]} : askItems(f, mem, enI, textI, used, techWords);
    const out = SX.exc ? askItems(f, mem, enE, textE, used, techWords) : null;
    if (out && !out.weak) {
      // left out: the named items, from what was asked or from all of them
      const keepC = (hit ? hit.codes : mem).filter(c => !out.codes.includes(c));
      hit = {codes: keepC, via: (hit && hit.via) || new Set(), weak: hit && hit.weak, single: hit && hit.single, excluded: out.codes, allBut: !hit};
    }
    if (hit) found[f] = hit;
    if (f === 'TECHNOLOGY' && hit && hit.via && (!hit.weak || !(hit.single && hit.single.size))) hit.via.forEach(w => techWords.add(w));
  });
  if (found.TECHNOLOGY && found.TECHNOLOGY.weak && !found.TECHNOLOGY.via.size) {
    const other = new Set(['COMMODITY', 'EMISSION', 'STORAGE'].flatMap(f => (found[f] ? [...found[f].via, ...(found[f].single || [])] : [])));
    if ([...found.TECHNOLOGY.single].every(w => other.has(w))) delete found.TECHNOLOGY;
  }
  // "share of the gas plant in electricity", "who supplies the most water": the production of that commodity
  if (!m && found.COMMODITY && (askHas(words, ASK_OPSET.share) || askHas(words, ASK_OPSET.max) || askHas(words, ASK_OPSET.min))) m = ASK_MEASURES.find(x => x[0] === 'prod');
  if (!m) {
    if (found.TECHNOLOGY || found.COMMODITY) return {...A, ask: 'measure', found};
    return {...A, error: 'not understood'};
  }
  let v = direct || ((found.TECHNOLOGY || askBy(text).includes('TECHNOLOGY') || askHas(words, ASK_OPSET.max) || askHas(words, ASK_OPSET.min) || askHas(words, ASK_OPSET.share)) && vd[m[2]] ? m[2] : vd[m[3]] ? m[3] : m[2]);
  if (!vd[v] && !/^IN\./.test(v)) return {...A, error: 'This run has no result for this question.', measure: m};
  const by0 = askBy(text);
  if ((by0.includes('SEASON') || by0.includes('TIMESLICE')) && !(vd[v] || []).includes('TIMESLICE')) {
    if (ASK_TS[v] && vd[ASK_TS[v]]) v = ASK_TS[v];
    else A.notes.push('This result is yearly only: it has no time slices.');
  }
  // the data of each run
  const V0 = await getVar(runIds[0], v),
    yi = (V0.dims || varDims(v, (V0.rows[0] || []).length - 1, runIds[0])).indexOf('YEAR');
  const allYears = yi < 0 ? [] : [...new Set(V0.rows.map(r => String(r[yi])))].sort();
  const Y = askYears(q, allYears);
  if (Y.asked && !Y.years.length) A.notes.push(`The years of this run are ${allYears[0]}-${allYears[allYears.length - 1]}.`);
  let by = askBy(text);
  const ops = {max: askHas(words, ASK_OPSET.max), min: askHas(words, ASK_OPSET.min), share: askHas(words, ASK_OPSET.share), total: askHas(words, ASK_OPSET.total)};
  const res = [];
  for (const run of runIds) {
    const R = await getVar(run, v);
    const dims = [...(R.dims || varDims(v, (R.rows[0] || []).length - 1, run))];
    const recs = R.rows.map(r => Object.fromEntries([...dims.map((d, i) => [d, String(r[i])]), ['value', +r[r.length - 1] || 0]]));
    // seasons: each time slice in its season (Conversionls of the run's data)
    if (by0.includes('SEASON') && dims.includes('TIMESLICE')) {
      const C = await getVar(run, 'IN.Conversionls').catch(() => ({rows: []}));
      const ls = {};
      for (const r of C.rows || []) if (+r[r.length - 1] === 1) ls[String(r[0])] = String(r[1]);
      if (Object.keys(ls).length) {
        recs.forEach(r => (r.SEASON = ls[r.TIMESLICE] || '—'));
        if (!dims.includes('SEASON')) dims.push('SEASON');
      } else A.notes.push('The seasons of the time slices are not in the data (Conversionls): shown by time slice.');
    }
    res.push({run, dims, recs});
  }
  const dims = res[0].dims;
  if (by.includes('SEASON') && !dims.includes('SEASON') && dims.includes('TIMESLICE')) by = by.map(f => (f === 'SEASON' ? 'TIMESLICE' : f));
  by = by.filter(f => dims.includes(f));
  // the share of named items (PWRSOL) in the whole (all technologies): the part is the field filtered
  const partField = ops.share ? ['TECHNOLOGY', 'STORAGE', 'REGION', 'EMISSION'].find(f => found[f] && dims.includes(f) && !by.includes(f)) : null;
  // the most / the least / the share: over the field named, or the technologies, commodities, regions
  if ((ops.max || ops.min || ops.share) && !partField && !by.filter(f => f !== 'YEAR').length) {
    const f = ['TECHNOLOGY', 'COMMODITY', 'STORAGE', 'EMISSION', 'REGION'].find(x => dims.includes(x) && !(found[x] && found[x].codes.length === 1));
    if (f) by.push(f);
  }
  const stock = m[4];
  const years = Y.years || null;
  if (noSum) {
    by = [...new Set([...by, ...dims.filter(f => !(found[f] && found[f].codes.length === 1) && !(f === 'YEAR' && years && years.length === 1))])];
    A.notes.push(/^IN\./.test(v) ? 'Input values are shown as they are (not added).' : 'Rates are shown by time slice as they are (not added).');
  }
  // no year: by year (a stock is never added over the years; a flow also gets its total)
  if (!years && !ops.total && !by.includes('YEAR') && dims.includes('YEAR') && !(ops.max || ops.min || (ops.share && !partField))) by.unshift('YEAR');
  if (years && years.length > 1 && (stock || !ops.total) && !by.includes('YEAR')) by.unshift('YEAR');
  const keep = r =>
    Object.entries(found).every(([f, h]) => !dims.includes(f) || h.codes.includes(r[f])) && (!years || !dims.includes('YEAR') || years.includes(r.YEAR));
  const uOf = r => {
    try {
      return unitOf(v.replace(/^IN\./, ''), r) || (r.COMMODITY ? unitName(commUnit(r.COMMODITY)) : '');
    } catch (e) {
      return '';
    }
  };
  // never add up different units or different gases: one line each
  for (const f of ['EMISSION', 'COMMODITY', 'STORAGE', 'TECHNOLOGY']) {
    if (!dims.includes(f) || by.includes(f)) continue;
    const units = new Map();
    for (const r of res[0].recs)
      if (keep(r)) {
        const k = by.map(x => r[x]).join(' · ');
        if (!units.has(k)) units.set(k, new Set());
        units.get(k).add(uOf(r));
      }
    const mixed = [...units.values()].some(u => u.size > 1);
    const gases = f === 'EMISSION' && new Set(res[0].recs.filter(keep).map(r => r[f])).size > 1;
    if (mixed || gases) {
      by.push(f);
      A.notes.push(gases ? 'Each emission on its own line (different gases are not added).' : 'Items with different units are on their own lines (they are not added).');
    }
  }
  const groups = res.map(({run, recs}) => {
    const g = new Map();
    for (const r of recs)
      if (keep(r)) {
        const k = by.map(f => r[f]).join(' · ');
        g.set(k, (g.get(k) || 0) + r.value);
      }
    const u = new Map();
    for (const r of recs) if (keep(r)) u.set(by.map(f => r[f]).join(' · '), uOf(r));
    // the share of each line in its whole: the same records without the filter of the part (PWRSOL in all technologies),
    // or, for "share by technology", each technology in the total of its year
    let pct = null;
    if (ops.share) {
      const sf = partField || [...by].reverse().find(f => f !== 'YEAR');
      const denBy = by.filter(f => f !== sf);
      const keepWhole = r =>
        Object.entries(found).every(([f, h]) => f === sf || !dims.includes(f) || h.codes.includes(r[f])) && (!years || !dims.includes('YEAR') || years.includes(r.YEAR));
      const den = new Map();
      for (const r of recs)
        if (keepWhole(r)) {
          const k = denBy.map(f => r[f]).join(' · ');
          den.set(k, (den.get(k) || 0) + r.value);
        }
      pct = new Map();
      for (const [k, x] of g) {
        const parts = k.split(' · ');
        const dk = by.map((f, i) => (f === sf ? null : parts[i])).filter(z => z !== null).join(' · ');
        const d = den.get(dk);
        pct.set(k, d ? (100 * x) / d : null);
      }
      if (run === runIds[0]) A.shareOf = sf;
    }
    return {run, g, u, pct, recs: recs.filter(keep)};
  });
  const us = new Set(groups[0].recs.map(uOf));
  const unit = us.size === 1 ? [...us][0] : '';
  if (partField) A.notes.push(`Share of ${found[partField].codes.join(', ')} in the total of all ${partField.charAt(0) + partField.slice(1).toLowerCase()} items, line by line.`);
  return {...A, v, m, runIds, found, years, Y, by, ops, stock, groups, unit, dims, allYears, partShare: !!partField};
}

/* ---------- the page ---------- */
const askFmt = x => {
  const a = Math.abs(x);
  return new Intl.NumberFormat(typeof I18N !== 'undefined' ? I18N.lang : 'en', {maximumFractionDigits: a >= 1000 ? 0 : a >= 10 ? 1 : a >= 0.01 ? 3 : 6}).format(x);
};
const ASK_EX = {
  en: ['Emissions in {y1}', 'Capacity by technology in {y1}', 'Which technology produces the most?', 'Total cost', 'Investment from {y0} to {y1}', 'Share of production by technology in {y1}'],
  fr: ['Émissions en {y1}', 'Capacité par technologie en {y1}', 'Quelle technologie produit le plus ?', 'Coût total', 'Investissement de {y0} à {y1}', 'Part de la production par technologie en {y1}'],
  es: ['Emisiones en {y1}', 'Capacidad por tecnología en {y1}', '¿Qué tecnología produce más?', 'Costo total', 'Inversión de {y0} a {y1}', 'Cuota de producción por tecnología en {y1}'],
  ar: ['الانبعاثات في {y1}', 'القدرة حسب التقنية في {y1}', 'أي تقنية تنتج أكثر؟', 'التكلفة الإجمالية', 'الاستثمار من {y0} إلى {y1}', 'نسبة الإنتاج حسب التقنية في {y1}']
};
async function openAsk(q) {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  await loadRuns().catch(() => []);
  const runs = RV.runs || [];
  if (!ASK.run || !runs.some(r => r.id === ASK.run)) ASK.run = runs[0] ? runs[0].id : '';
  let y0 = '',
    y1 = '';
  if (ASK.run) {
    const I = await runInfo(ASK.run).catch(() => null);
    const T = I && I.vardims && I.vardims.TotalCapacityAnnual ? await getVar(ASK.run, 'TotalCapacityAnnual').catch(() => null) : null;
    const ys = T ? [...new Set(T.rows.map(r => String(r[r.length - 2])))].sort() : [];
    y0 = ys[0] || '';
    y1 = ys[ys.length - 1] || '';
  }
  const ex = (ASK_EX[typeof I18N !== 'undefined' ? I18N.lang : 'en'] || ASK_EX.en).map(s => s.replace('{y0}', y0).replace('{y1}', y1));
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">ask</div><h2>Ask the results</h2><p class="hint">Write a question in your own words. The Studio reads it with the names of your model (no AI, nothing leaves this computer) and shows how it read it.</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
  <div class="db">
    ${
      runs.length
        ? `<div class="askbar"><input type="search" id="askq" data-notr placeholder="${esc(ex[0])}" value="${esc(q || '')}" autocomplete="off"><button type="button" class="btn pri" id="askgo">Ask</button></div>
    <label class="askrun">Run <select id="askrun" data-notr>${runs.map(r => `<option value="${esc(r.id)}"${r.id === ASK.run ? ' selected' : ''}>${esc(runName(r.id))}${r.case ? ' · ' + esc(r.case) : ''}</option>`).join('')}</select></label>
    <div class="askex"><span class="muted">Examples</span>${ex.map(e => `<button type="button" class="chip askx" data-notr>${esc(e)}</button>`).join('')}</div>
    <div id="askout"></div>`
        : `<div class="empty">No solved runs yet: Solve to start one.</div>`
    }
  </div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  if (!runs.length) return;
  const go = () => {
    ASK.pick = {};
    askShow(dr.querySelector('#askq').value);
  };
  dr.querySelector('#askgo').onclick = go;
  dr.querySelector('#askq').onkeydown = e => {
    // a handler that returns false blocks the key: return nothing
    if (e.key === 'Enter') go();
  };
  dr.querySelector('#askrun').onchange = e => {
    ASK.run = e.target.value;
    const v = dr.querySelector('#askq').value;
    if (v.trim()) askShow(v);
  };
  dr.querySelectorAll('.askx').forEach(b => (b.onclick = () => ((dr.querySelector('#askq').value = b.textContent), go())));
  if (q) askShow(q);
  else dr.querySelector('#askq').focus();
}

async function askShow(q) {
  const out = document.getElementById('askout');
  if (!out || !String(q).trim()) return;
  out.innerHTML = '<div class="muted">Reading…</div>';
  let A;
  try {
    A = await askAnswer(q);
  } catch (e) {
    out.innerHTML = `<div class="empty">Could not answer: ${esc(e.message || e)}</div>`;
    return;
  }
  ASK.last = A;
  const chips = (list, attr) => list.map(([v, l]) => `<button type="button" class="chip askc" ${attr}="${esc(v)}">${esc(l)}</button>`).join('');
  if (A.error === 'not understood' || A.ask === 'measure') {
    out.innerHTML = `<div class="aska"><p><b>What should I measure?</b> ${A.found && Object.keys(A.found).length ? `<span class="muted" data-notr>${esc(Object.values(A.found).flatMap(h => h.codes).join(', '))}</span>` : ''}</p>
      <div class="askchips">${chips(ASK_MEASURES.map(m => [m[0], m[1]]), 'data-m')}</div>
      <p class="muted">Name a result (emissions, capacity, production, use, cost…) and, if you want, a technology, a commodity, a year.</p></div>`;
    out.querySelectorAll('[data-m]').forEach(b => (b.onclick = () => ((ASK.pick.measure = b.dataset.m), askShow(q))));
    return;
  }
  if (A.error) {
    out.innerHTML = `<div class="empty">${esc(A.error)}</div>`;
    return;
  }
  const G = A.groups,
    one = !A.by.length;
  if (G.every(g => !g.recs.length)) {
    out.innerHTML = `<div class="aska"><p><b>No values</b></p><p class="muted">${esc(A.v)}: this run has no value for these items and years (zero, or not written by the model).</p></div>`;
    return;
  }
  const total = g => [...g.values()].reduce((s, x) => s + x, 0);
  let body = '';
  const multi = G.length > 1;
  if (one) {
    body = `<div class="askbig">${G.map(g => `<div><span class="askv" data-notr>${g.pct && g.pct.get('') != null ? askFmt(g.pct.get('')) + ' %' : askFmt(total(g.g))}</span> <span class="asku" data-notr>${g.pct && g.pct.get('') != null ? askFmt(total(g.g)) + ' ' + esc(A.unit) : esc(A.unit)}</span>${multi ? ` <span class="muted" data-notr>${esc(runName(g.run))}</span>` : ''}</div>`).join('')}</div>`;
    if (multi) body += `<p>Difference <b data-notr>${askFmt(total(G[1].g) - total(G[0].g))} ${esc(A.unit)}</b></p>`;
  } else {
    let keys = [...new Set(G.flatMap(g => [...g.g.keys()]))];
    const val = (g, k) => g.g.get(k) || 0;
    if (A.ops.max || A.ops.min) keys.sort((a, b) => (A.ops.min ? 1 : -1) * (val(G[0], b) - val(G[0], a)) * -1 || 0);
    else keys.sort();
    const tot = G.map(g => total(g.g));
    if ((A.ops.max || A.ops.min) && keys.length) {
      const k = keys[0];
      body += `<div class="askbig"><div><span class="askv" data-notr>${esc(askLabel(A.by, k))}</span></div><div><span class="askv" style="font-size:22px" data-notr>${askFmt(val(G[0], k))}</span> <span class="asku" data-notr>${esc(A.unit)}</span></div></div>`;
    }
    const share = A.ops.share;
    const flow = !A.stock && A.by[0] === 'YEAR' && A.by.length === 1;
    const perUnit = !A.unit;
    body += `<div class="tw" style="max-height:360px"><table class="asktab"><thead><tr><th>${A.by.map(esc).join(' · ')}</th>${G.map(g => `<th class="n" data-notr>${multi ? esc(runName(g.run)) : esc(A.unit) || ''}</th>`).join('')}${perUnit ? '<th>Unit</th>' : ''}${share ? '<th class="n">%</th>' : ''}${multi ? '<th class="n">Difference</th>' : ''}</tr></thead><tbody>
      ${keys
        .slice(0, 60)
        .map(k => `<tr><td data-notr>${esc(askLabel(A.by, k))}</td>${G.map(g => `<td class="n" data-notr>${askFmt(val(g, k))}</td>`).join('')}${perUnit ? `<td data-notr>${esc(G[0].u.get(k) || '')}</td>` : ''}${share ? `<td class="n" data-notr>${G[0].pct && G[0].pct.get(k) != null ? askFmt(G[0].pct.get(k)) : ''}</td>` : ''}${multi ? `<td class="n" data-notr>${askFmt(val(G[1], k) - val(G[0], k))}</td>` : ''}</tr>`)
        .join('')}
      ${(flow || (share && !A.partShare) || A.ops.total) && !perUnit && !(share && A.by.includes('YEAR')) ? `<tr class="asktot"><td>Total</td>${tot.map(t => `<td class="n" data-notr>${askFmt(t)}</td>`).join('')}${perUnit ? '<td></td>' : ''}${share ? '<td class="n">100</td>' : ''}${multi ? `<td class="n" data-notr>${askFmt(tot[1] - tot[0])}</td>` : ''}</tr>` : ''}
      </tbody></table></div>`;
    if (keys.length > 60) body += `<p class="muted">The first 60 of ${keys.length} rows: open it in Results to see them all.</p>`;
  }
  // how the question was read
  const how = [];
  const vdesc = typeof VDESC !== 'undefined' && VDESC[A.v] ? VDESC[A.v][1] : '';
  how.push(`<li><span>Result</span> <b data-notr>${esc(A.v)}</b>${vdesc ? ` <span class="muted" data-notr>${esc(vdesc)}</span>` : ''}</li>`);
  for (const [f, h] of Object.entries(A.found))
    if (A.dims.includes(f))
      how.push(
        `<li><span>${esc(f.charAt(0) + f.slice(1).toLowerCase())}</span> ${h.allBut ? '<span>All except</span> ' : ''}<b data-notr>${esc((h.allBut ? h.excluded : h.codes).join(', '))}</b>${!h.allBut && h.excluded ? ` <span>Left out</span> <b data-notr>${esc(h.excluded.join(', '))}</b>` : ''}${h.weak ? ' <span class="muted">(several match: choose below)</span>' : ''}</li>`
      );
  if (A.dims.includes('YEAR'))
    how.push(`<li><span>Years</span> <b data-notr>${A.years ? (A.years.length > 2 ? A.years[0] + '–' + A.years[A.years.length - 1] : A.years.join(', ')) : esc(A.allYears[0] + '–' + A.allYears[A.allYears.length - 1])}</b>${A.years && A.years.length > 1 && !A.by.includes('YEAR') ? ' <span class="muted">summed over the years</span>' : ''}</li>`);
  const summed = A.dims.filter(f => f !== 'YEAR' && !A.by.includes(f) && !(A.found[f] && A.found[f].codes.length === 1));
  if (summed.length) how.push(`<li><span>Summed over</span> ${summed.map(f => `<b>${esc(f.charAt(0) + f.slice(1).toLowerCase())}</b>`).join(', ')}</li>`);
  how.push(`<li><span>Run</span> <b data-notr>${A.runIds.map(r => esc(runName(r))).join(' · ')}</b></li>`);
  if (A.stock && A.years && A.years.length > 1) A.notes.push('Capacity and storage levels are not added over the years: each year is shown.');
  // questions back
  let back = '';
  for (const [f, h] of Object.entries(A.found))
    if (h.weak && h.codes.length > 1 && A.dims.includes(f))
      back += `<div class="askchips"><span class="muted">${esc(f.charAt(0) + f.slice(1).toLowerCase())}:</span>${h.codes.map(c => `<button type="button" class="chip askc" data-f="${esc(f)}" data-c="${esc(c)}" data-notr>${esc(c)}${askDesc(f, c) ? ' · ' + esc(String(askDesc(f, c)).split(/[:(]/)[0]) : ''}</button>`).join('')}<button type="button" class="chip askc" data-f="${esc(f)}" data-c="*">All of them</button></div>`;
  const otherRuns = (RV.runs || []).filter(r => !A.runIds.includes(r.id));
  out.innerHTML = `<div class="aska">${body}
    ${A.notes.map(n => `<p class="muted">${esc(n)}</p>`).join('')}
    ${back}
    <details class="askhow" open><summary>How I read the question</summary><ul>${how.join('')}</ul></details>
    <div class="acts"><button type="button" class="btn" id="askres">Open in Results</button><button type="button" class="btn" id="askcp">Copy</button>${otherRuns.length ? `<label class="askrun">Compare with <select id="askcmp" data-notr><option value=""></option>${otherRuns.map(r => `<option value="${esc(r.id)}">${esc(runName(r.id))}</option>`).join('')}</select></label>` : ''}</div></div>`;
  out.querySelectorAll('[data-c]').forEach(
    b =>
      (b.onclick = () => {
        const f = b.dataset.f;
        ASK.pick[f] = b.dataset.c === '*' ? A.found[f].codes : [b.dataset.c];
        askShow(q);
      })
  );
  out.querySelector('#askres').onclick = () => askToResults(A);
  out.querySelector('#askcp').onclick = () => {
    const t = out.querySelector('.asktab') ? [...out.querySelectorAll('.asktab tr')].map(tr => [...tr.children].map(c => c.textContent).join('\t')).join('\n') : out.querySelector('.askbig').textContent.trim();
    navigator.clipboard && navigator.clipboard.writeText(q + '\n' + t);
    if (typeof toast === 'function') toast('Copied');
  };
  const cmp = out.querySelector('#askcmp');
  if (cmp)
    cmp.onchange = async () => {
      if (!cmp.value) return;
      const r = RV.runs.find(x => x.id === cmp.value);
      askShow(q + ' ' + (r.name || r.id));
    };
}
const askLabel = (by, k) =>
  String(k)
    .split(' · ')
    .map((x, i) => {
      const d = askDesc(by[i], x);
      return d && by[i] !== 'YEAR' ? `${x} (${String(d).split(/[:(]/)[0].trim()})` : x;
    })
    .join(' · ');

/* the same question as a chart of Results */
function askToResults(A) {
  const D = CHART0();
  D.runs = A.runIds.slice();
  D.vars = [A.v];
  for (const [f, h] of Object.entries(A.found)) if (A.dims.includes(f)) D.filters[f] = h.codes.slice();
  if (A.years) D.filters.YEAR = A.years.slice();
  const by = A.by.filter(f => f !== 'YEAR');
  D.rows = ['YEAR'];
  D.cols = by.length ? by : [];
  if (!A.dims.includes('YEAR')) D.rows = by.length ? [by[0]] : [];
  D.type = 'stack';
  if (A.ops.share) D.show = 'share_row';
  if (A.partShare && A.shareOf) {
    // the share of PWRSOL needs every technology in the chart: all of them as columns, % of each row
    delete D.filters[A.shareOf];
    D.cols = [A.shareOf];
  }
  RV.def = D;
  document.getElementById('drawer').hidden = true;
  showResults(A.runIds[0]);
}

document.getElementById('askb') && (document.getElementById('askb').onclick = () => openAsk());
