// Strings for the companion website. English is the source; other languages fall back to English per key.
// In HTML, mark elements with data-i18n="key" (text), data-i18n-html="key" (may contain <em>),
// data-i18n-ph="key" (placeholder) or data-i18n-label="key" (aria-label). Strings with {n} take a number.

export const LANGS = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'es', label: 'ES', name: 'Español' },
  { id: 'zh', label: '中文', name: '中文' },
  { id: 'nl', label: 'NL', name: 'Nederlands' },
];

const en = {
  'nav.skip': 'Skip to content',
  'nav.home': 'Home',
  'nav.game': 'The game',
  'nav.sights': 'Sights',
  'nav.eat': 'Eat & drink',
  'nav.streets': 'Streets & squares',
  'nav.play': 'Play',
  'nav.menu': 'Menu',
  'nav.language': 'Language',
  'nav.main': 'Main',
  'nav.explore': 'Explore the city',

  'hero.kicker': 'A free 3D game in your browser',
  'hero.title': 'Instant <em>San Francisco</em>',
  'hero.sub': 'Ride the real city. Every building at its measured height, every hill at its real grade, from the Ferry Building to the Golden Gate.',
  'hero.meta': 'Free · no account · nothing to install',
  'hero.caption': 'In-game',

  'btn.play': 'Play now',
  'btn.tour': 'Virtual tour',
  'btn.soon': 'Coming soon',
  'btn.goto': 'Go there in the game',
  'btn.ride': 'Ride here',
  'btn.pause': 'Pause slideshow',
  'btn.resume': 'Play slideshow',
  'btn.top': 'Back to top',

  'home.stat.buildings': 'buildings, at measured height',
  'home.stat.streets': 'named streets',
  'home.stat.trees': 'street trees',
  'home.stat.sights': 'sights with a story',
  'home.intro': 'A city you can <em>ride through</em>.',
  'home.intro.body': 'Instant San Francisco rebuilds the northeast of the city from open map data and real elevation, then hands you a bike. Climb Nob Hill, coast down to the Embarcadero, roll out along Crissy Field to the bridge. No downloads, no sign-up.',
  'home.features': 'What’s in the box',
  'home.f.buildings.t': 'Real buildings, real height',
  'home.f.buildings.d': 'More than forty thousand buildings from OpenStreetMap, each extruded to its measured height and roof shape.',
  'home.f.hills.t': 'Hills you can feel',
  'home.f.hills.d': 'The terrain comes from USGS 3DEP elevation. On the bike, a 17% grade on Hyde Street really does slow you down.',
  'home.f.ride.t': 'Bike, board, feet or flippers',
  'home.f.ride.d': 'Ride a bike, push a skateboard, walk, or flop along the Embarcadero as a sea lion from Pier 39.',
  'home.f.fog.t': 'Karl the Fog',
  'home.f.fog.d': 'Fog rolls in through the Gate and swallows the towers. Clear afternoon, foggy morning, it’s up to Karl.',
  'home.f.night.t': 'Day and night',
  'home.f.night.d': 'A full day cycle with the sun where it should be over the Bay, and thousands of lit windows after dark.',
  'home.f.modes.t': 'Races, missions and a tour',
  'home.f.modes.d': 'Race over the hills, run errands against the clock, or sit back on a guided tour past the sights.',
  'home.explore': 'Explore before you ride',
  'home.explore.sights': 'From Coit Tower to Fort Point: what to see, and a button that takes you there.',
  'home.explore.eat': 'Every café, bar and restaurant on the map, filterable by kind and cuisine.',
  'home.explore.streets': 'An A–Z of every street, alley, plaza and park in the game.',
  'home.cta': 'Your bike is <em>waiting</em>.',
  'home.cta.sub': 'Runs in any modern browser. Best with a keyboard on a laptop or desktop.',

  'game.title': 'The <em>game</em>',
  'game.lede': 'Part game, part model city. Instant San Francisco is a 3D version of the city built from open data, where you ride around, look about and, soon, race and play missions.',
  'game.what': 'So what is it?',
  'game.modes': 'Modes',
  'game.rides': 'Four ways to get around',
  'game.controls': 'Controls',
  'game.weather': 'Weather and time',
  'game.made': 'How it’s made',
  'game.faq': 'Questions',

  'sights.title': 'Sights in <em>San Francisco</em>',
  'sights.lede': 'The landmarks the game knows by name. Read a line about each, then jump straight there on your bike.',
  'sights.jump': 'Jump to a sight',
  'sights.map': 'OpenStreetMap',
  'sights.alt': 'In-game view of {name}',

  'eat.title': 'Eat <em>&amp;</em> drink',
  'eat.lede': 'Every restaurant, café and bar mapped in the game, straight from OpenStreetMap. Find one, then ride there.',
  'eat.search': 'Search by name, cuisine or neighbourhood',
  'eat.all': 'All',
  'eat.food': 'Restaurants',
  'eat.cafe': 'Cafés',
  'eat.bar': 'Bars',
  'eat.k.food': 'Restaurant',
  'eat.k.cafe': 'Café',
  'eat.k.bar': 'Bar',
  'eat.hood': 'Neighbourhood',
  'eat.anyhood': 'All neighbourhoods',
  'eat.count': '{n} places',
  'eat.of': 'Showing {n} of {total}',

  'streets.title': 'Streets <em>&amp;</em> squares',
  'streets.lede': 'Every named street, alley, stair, plaza and park in the game, A to Z. Pick one to start riding there.',
  'streets.search': 'Find a street or square',
  'streets.count': '{n} names',
  'streets.streets': 'Streets',
  'streets.squares': 'Squares & parks',
  'streets.street': 'Street',
  'streets.square': 'Square',
  'streets.park': 'Park',
  'streets.letters': 'Letters',

  'ui.loading': 'Loading the map…',
  'ui.error': 'Could not load the map data. Try reloading the page.',
  'ui.more': 'Show more',
  'ui.none': 'Nothing matches that. Try another word.',
  'ui.filter': 'Filter',

  'footer.tagline': 'A free 3D game of San Francisco, made for fun.',
  'footer.data': 'Map data © OpenStreetMap contributors, ODbL. Elevation: USGS 3DEP via AWS Terrain Tiles. Rendered with three.js.',
  'footer.made': 'Made with Claude',
  'footer.privacy': 'Privacy',
  'footer.terms': 'Terms',
  'footer.notaffiliated': 'Not affiliated with the City and County of San Francisco.',
};

const es = {
  'nav.skip': 'Ir al contenido',
  'nav.home': 'Inicio',
  'nav.game': 'El juego',
  'nav.sights': 'Lugares',
  'nav.eat': 'Comer y beber',
  'nav.streets': 'Calles y plazas',
  'nav.play': 'Jugar',
  'nav.menu': 'Menú',
  'nav.language': 'Idioma',
  'nav.explore': 'Explora la ciudad',
  'hero.kicker': 'Un juego 3D gratis en tu navegador',
  'hero.title': 'Instant <em>San Francisco</em>',
  'hero.sub': 'Recorre la ciudad real. Cada edificio a su altura medida, cada colina con su pendiente real, del Ferry Building al Golden Gate.',
  'hero.meta': 'Gratis · sin cuenta · sin instalar nada',
  'hero.caption': 'En el juego',
  'btn.play': 'Jugar ahora',
  'btn.tour': 'Visita virtual',
  'btn.soon': 'Próximamente',
  'btn.goto': 'Ir allí en el juego',
  'btn.ride': 'Pedalea aquí',
  'btn.pause': 'Pausar',
  'btn.resume': 'Reanudar',
  'home.features': 'Qué incluye',
  'home.explore': 'Explora antes de pedalear',
  'home.cta': 'Tu bici te <em>espera</em>.',
  'game.title': 'El <em>juego</em>',
  'sights.title': 'Lugares de <em>San Francisco</em>',
  'eat.title': 'Comer <em>y</em> beber',
  'eat.all': 'Todo', 'eat.food': 'Restaurantes', 'eat.cafe': 'Cafés', 'eat.bar': 'Bares',
  'eat.k.food': 'Restaurante', 'eat.k.cafe': 'Café', 'eat.k.bar': 'Bar',
  'streets.title': 'Calles <em>y</em> plazas',
  'streets.streets': 'Calles', 'streets.squares': 'Plazas y parques',
  'ui.loading': 'Cargando el mapa…',
  'ui.more': 'Ver más',
  'footer.made': 'Hecho con Claude',
  'footer.privacy': 'Privacidad',
  'footer.terms': 'Condiciones',
};

const zh = {
  'nav.skip': '跳到正文',
  'nav.home': '首页',
  'nav.game': '游戏',
  'nav.sights': '景点',
  'nav.eat': '美食饮品',
  'nav.streets': '街道与广场',
  'nav.play': '开玩',
  'nav.menu': '菜单',
  'nav.language': '语言',
  'nav.explore': '探索城市',
  'hero.kicker': '浏览器里的免费 3D 游戏',
  'hero.title': 'Instant <em>旧金山</em>',
  'hero.sub': '骑行真实的城市。每栋建筑都按实测高度建造，每座山丘都是真实坡度，从渡轮大厦一路到金门大桥。',
  'hero.meta': '免费 · 无需账号 · 无需安装',
  'hero.caption': '游戏画面',
  'btn.play': '立即开玩',
  'btn.tour': '虚拟导览',
  'btn.soon': '即将推出',
  'btn.goto': '在游戏中前往',
  'btn.ride': '从这里出发',
  'btn.pause': '暂停轮播',
  'btn.resume': '继续轮播',
  'home.features': '游戏内容',
  'home.explore': '出发前先看看',
  'home.cta': '你的单车正在<em>等你</em>。',
  'game.title': '关于<em>游戏</em>',
  'sights.title': '<em>旧金山</em>景点',
  'eat.title': '美食<em>与</em>饮品',
  'eat.all': '全部', 'eat.food': '餐厅', 'eat.cafe': '咖啡馆', 'eat.bar': '酒吧',
  'eat.k.food': '餐厅', 'eat.k.cafe': '咖啡馆', 'eat.k.bar': '酒吧',
  'streets.title': '街道<em>与</em>广场',
  'streets.streets': '街道', 'streets.squares': '广场与公园',
  'ui.loading': '正在加载地图…',
  'ui.more': '显示更多',
  'footer.made': '由 Claude 协助制作',
  'footer.privacy': '隐私',
  'footer.terms': '条款',
};

const nl = {
  'nav.skip': 'Naar de inhoud',
  'nav.home': 'Home',
  'nav.game': 'Het spel',
  'nav.sights': 'Bezienswaardigheden',
  'nav.eat': 'Eten & drinken',
  'nav.streets': 'Straten & pleinen',
  'nav.play': 'Spelen',
  'nav.menu': 'Menu',
  'nav.language': 'Taal',
  'nav.explore': 'Verken de stad',
  'hero.kicker': 'Een gratis 3D-spel in je browser',
  'hero.title': 'Instant <em>San Francisco</em>',
  'hero.sub': 'Fiets door de echte stad. Elk gebouw op zijn gemeten hoogte, elke heuvel met zijn echte helling, van het Ferry Building tot de Golden Gate.',
  'hero.meta': 'Gratis · geen account · niets te installeren',
  'hero.caption': 'In het spel',
  'btn.play': 'Speel nu',
  'btn.tour': 'Virtuele tour',
  'btn.soon': 'Binnenkort',
  'btn.goto': 'Ga erheen in het spel',
  'btn.ride': 'Fiets hierheen',
  'btn.pause': 'Diavoorstelling pauzeren',
  'btn.resume': 'Diavoorstelling afspelen',
  'home.features': 'Wat zit erin',
  'home.explore': 'Verken voor je vertrekt',
  'home.cta': 'Je fiets <em>staat klaar</em>.',
  'game.title': 'Het <em>spel</em>',
  'sights.title': 'Bezienswaardigheden in <em>San Francisco</em>',
  'eat.title': 'Eten <em>&amp;</em> drinken',
  'eat.all': 'Alles', 'eat.food': 'Restaurants', 'eat.cafe': 'Cafés', 'eat.bar': 'Bars',
  'eat.k.food': 'Restaurant', 'eat.k.cafe': 'Café', 'eat.k.bar': 'Bar',
  'streets.title': 'Straten <em>&amp;</em> pleinen',
  'streets.streets': 'Straten', 'streets.squares': 'Pleinen & parken',
  'ui.loading': 'De kaart laden…',
  'ui.more': 'Meer tonen',
  'footer.made': 'Gemaakt met Claude',
  'footer.privacy': 'Privacy',
  'footer.terms': 'Voorwaarden',
};

export const STRINGS = { en, es, zh, nl };
const KEY = 'isf.lang';

export function getLang() {
  let l = null;
  try { l = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (l && STRINGS[l]) return l;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return STRINGS[nav] ? nav : 'en';
}

export function storeLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ }
}

let current = 'en';
export const lang = () => current;

/** Look up a string; falls back to English, then to the key itself. */
export function t(key, vars) {
  let s = STRINGS[current]?.[key] ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return s;
}

/** Apply the language to every marked element under root. */
export function applyLang(l, root = document) {
  current = STRINGS[l] ? l : 'en';
  document.documentElement.lang = current === 'zh' ? 'zh-Hans' : current;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  document.dispatchEvent(new CustomEvent('langchange', { detail: current }));
}
