// San Francisco, hand-curated: the sights the game knows by name, with a short line about each.
// Positions are lat/lon; the game projects them (see region.js).

export const NAME = 'San Francisco';

export const SIGHTS = [
  { id: 'ferry', name: 'Ferry Building', lat: 37.79555, lon: -122.39366, blurb: 'The 1898 clock tower at the foot of Market Street, now a food hall with ferries out back.' },
  { id: 'coit', name: 'Coit Tower', lat: 37.80239, lon: -122.40582, blurb: 'A 64 m fluted concrete column on Telegraph Hill, its base wrapped in 1930s murals.' },
  { id: 'transamerica', name: 'Transamerica Pyramid', lat: 37.79519, lon: -122.40279, blurb: 'The 260 m pyramid that defined the skyline from 1972.' },
  { id: 'salesforce', name: 'Salesforce Tower', lat: 37.78974, lon: -122.39687, blurb: 'At 326 m the tallest in town; its crown is an LED screen at night.' },
  { id: 'lombard', name: 'Lombard Street', lat: 37.80214, lon: -122.41874, blurb: 'Eight hairpin bends down one steep block of Russian Hill, lined with hydrangeas.' },
  { id: 'painted', name: 'Painted Ladies', lat: 37.77625, lon: -122.43272, blurb: 'The row of Victorian houses on Steiner Street facing Alamo Square, with downtown behind.' },
  { id: 'alamo', name: 'Alamo Square', lat: 37.77640, lon: -122.43460, blurb: 'A hilltop park with the classic postcard view of the Painted Ladies and the skyline.' },
  { id: 'unionsq', name: 'Union Square', lat: 37.78795, lon: -122.40750, blurb: 'The shopping heart of downtown, with the Dewey Monument in the middle.' },
  { id: 'cablecarturn', name: 'Powell & Market Turnaround', lat: 37.78487, lon: -122.40776, blurb: 'Where cable cars are spun around by hand on a wooden turntable.' },
  { id: 'chinatown', name: 'Dragon Gate', lat: 37.79072, lon: -122.40553, blurb: 'The gateway to Chinatown on Grant Avenue, the oldest Chinatown in North America.' },
  { id: 'pier39', name: 'Pier 39', lat: 37.80867, lon: -122.40981, blurb: 'Carousel, chowder and the famous sea lions lounging on the K-Dock.' },
  { id: 'wharf', name: "Fisherman's Wharf", lat: 37.80800, lon: -122.41770, blurb: 'Crab stands, sourdough and the old fishing fleet along Jefferson Street.' },
  { id: 'ghirardelli', name: 'Ghirardelli Square', lat: 37.80590, lon: -122.42290, blurb: 'A brick chocolate factory turned shopping square, with its glowing sign.' },
  { id: 'palace', name: 'Palace of Fine Arts', lat: 37.80290, lon: -122.44840, blurb: 'A Roman-style rotunda by a lagoon, built for the 1915 Panama-Pacific Exposition.' },
  { id: 'crissy', name: 'Crissy Field', lat: 37.80390, lon: -122.46400, blurb: 'A former airfield turned shoreline meadow with the best Golden Gate views.' },
  { id: 'fortpoint', name: 'Fort Point', lat: 37.81060, lon: -122.47700, blurb: 'A brick Civil War fort tucked under the south end of the Golden Gate Bridge.' },
  { id: 'ggb', name: 'Golden Gate Bridge', lat: 37.81990, lon: -122.47830, blurb: '2.7 km of International Orange across the strait, opened in 1937.' },
  { id: 'alcatraz', name: 'Alcatraz', lat: 37.82670, lon: -122.42300, blurb: 'The island prison in the middle of the Bay, closed in 1963.' },
  { id: 'cityhall', name: 'City Hall', lat: 37.77927, lon: -122.41924, blurb: 'A Beaux-Arts dome taller than the US Capitol’s, in the Civic Center.' },
  { id: 'gracecathedral', name: 'Grace Cathedral', lat: 37.79194, lon: -122.41314, blurb: 'Gothic cathedral on top of Nob Hill, with a labyrinth on the plaza.' },
  { id: 'cablecarmuseum', name: 'Cable Car Museum', lat: 37.79460, lon: -122.41150, blurb: 'The powerhouse where giant wheels still pull the cables under the streets.' },
  { id: 'washingtonsq', name: 'Washington Square', lat: 37.80080, lon: -122.41010, blurb: 'North Beach’s lawn, watched over by the twin spires of Saints Peter and Paul.' },
  { id: 'ballpark', name: 'Oracle Park', lat: 37.77860, lon: -122.38930, blurb: 'The Giants’ ballpark, where home runs splash into McCovey Cove.' },
  { id: 'baybridge', name: 'Bay Bridge', lat: 37.78830, lon: -122.38400, blurb: 'The double-deck bridge to Oakland, strung with 25,000 LEDs.' },
  { id: 'fortmason', name: 'Fort Mason', lat: 37.80630, lon: -122.43150, blurb: 'Old army piers turned arts centre, with a great lawn over the Marina.' },
  { id: 'japantown', name: 'Peace Pagoda', lat: 37.78510, lon: -122.42950, blurb: 'The five-tiered pagoda in Japantown, a gift from Osaka.' },
  { id: 'filbertsteps', name: 'Filbert Steps', lat: 37.80180, lon: -122.40330, blurb: 'Wooden stairs through hidden gardens down the east face of Telegraph Hill.' },
  { id: 'embarcadero', name: 'Embarcadero Center', lat: 37.79470, lon: -122.39870, blurb: 'Four slab towers outlined in lights, linked by sky bridges.' },
];

export const START = { lat: 37.79540, lon: -122.39470, heading: Math.PI / 2 + 0.25 }; // on the Embarcadero, facing the Ferry Building

// Races follow the shortest bike route between their waypoints. laps > 1 makes a circuit.
export const RACES = [
  {
    id: 'embarcadero', name: 'Embarcadero Sprint', laps: 1,
    blurb: 'Flat out along the waterfront: from the Ferry Building past the piers to Pier 39.',
    way: [[37.79440, -122.39340], [37.80030, -122.39900], [37.80420, -122.40250], [37.80790, -122.40800]],
  },
  {
    id: 'hyde', name: 'Hyde Street Hills', laps: 1,
    blurb: 'From the cable car turnaround at Aquatic Park, up and over Russian Hill and down to Union Square.',
    way: [[37.80620, -122.42060], [37.80200, -122.41880], [37.79450, -122.41740], [37.79100, -122.41680], [37.78950, -122.40880], [37.78790, -122.40760]],
  },
  {
    id: 'goldengate', name: 'Golden Gate Dash', laps: 1,
    blurb: 'Along Crissy Field, past Fort Point, up to the toll plaza and out across the bridge to mid-span.',
    way: [[37.80420, -122.45700], [37.80580, -122.46800], [37.80650, -122.47500], [37.81070, -122.47770], [37.81990, -122.47830]],
  },
  {
    id: 'lombard', name: 'Lombard Loop', laps: 2,
    blurb: 'Two laps of Russian Hill: down the eight bends of the crooked street and back up Hyde.',
    way: [[37.80210, -122.41880], [37.80192, -122.41790], [37.80400, -122.41750], [37.80450, -122.41960]],
  },
];

export const RIVALS = [
  { name: 'Juniper', color: 0x2e5f8a },
  { name: 'Mateo', color: 0x2f6b4f },
  { name: 'Ling', color: 0xd6a12b },
];

// Timed missions. Positions are [lat, lon]; limits in seconds.
export const MISSIONS = [
  {
    id: 'sealion', type: 'catch', name: 'Sea Lion Escape', limit: 150, icon: '🦭',
    blurb: 'One of the Pier 39 sea lions has gone walkabout along the Wharf. Catch it before it makes it back to the Bay.',
    win: 'Gently returned to the K-Dock. The other sea lions barked their approval.', lose: 'With a final flop it slid into Aquatic Park and was gone.',
    start: [37.80860, -122.40930], heading: -1.75,
    path: [[37.80840, -122.41080], [37.80790, -122.41400], [37.80760, -122.41700], [37.80720, -122.41980], [37.80640, -122.42150], [37.80710, -122.42320]],
  },
  {
    id: 'cablecar', type: 'goto', name: 'The Last Cable Car', limit: 150, icon: '🚋',
    blurb: 'The last Powell–Hyde car of the night leaves the Hyde Street turnaround soon. From Washington Square, over Russian Hill. Go.',
    win: 'You swung onto the running board just as the gripman rang the bell.', lose: 'Its bell faded away down Hyde Street. Long walk home.',
    start: [37.80060, -122.41030], heading: -1.4, to: [37.80640, -122.42070], toName: 'Hyde Street turnaround',
  },
  {
    id: 'cookies', type: 'deliver', name: 'Fortune Cookie Run', limit: 240, icon: '🥠',
    blurb: 'Pick up a fresh batch at the fortune cookie factory in Ross Alley and deliver it across the city while it is still warm.',
    win: 'Every cookie delivered. Your fortune: “A fast bike brings sweet rewards.”', lose: 'The cookies went stale. Your fortune: “Pedal faster next time.”',
    start: [37.79480, -122.40640], heading: Math.PI,
    stops: [[[37.79550, -122.40720], 'Ross Alley factory'], [[37.79760, -122.40650], 'City Lights Books'], [[37.79190, -122.41310], 'Grace Cathedral'], [[37.78800, -122.40750], 'Union Square'], [[37.79550, -122.39370], 'Ferry Building']],
  },
  {
    id: 'breakers', type: 'crowd', name: 'Bay to Breakers', limit: 150, icon: '🏃',
    blurb: 'Race day. Get from Civic Center up the Hayes Street hill to Alamo Square through thousands of runners in costume. Bump one and you stumble.',
    win: 'Through the salmon, the centipede and the tortillas — you made it.', lose: 'Swallowed by a conga line of bananas.',
    start: [37.77745, -122.41930], heading: -1.62, to: [37.77630, -122.43440], toName: 'Alamo Square',
    crowd: [[37.77745, -122.41930], [37.77630, -122.43440]],
  },
  {
    id: 'postcards', type: 'collect', name: 'Lost Postcards', limit: 180, icon: '💌',
    blurb: 'A gust off the Pacific scattered a tourist’s postcards all over Alamo Square and the streets around it. Find all eight.',
    win: 'All eight found. Wish you were here!', lose: 'Some postcards are still out there, blowing towards the Haight.',
    start: [37.77640, -122.43460], heading: 1.6,
    items: [[37.77760, -122.43290], [37.77520, -122.43620], [37.77850, -122.43650], [37.77450, -122.43100], [37.77920, -122.43010], [37.77350, -122.43700], [37.77700, -122.42800], [37.78000, -122.43400]],
  },
];

// The virtual tour: camera stops at sights (bearing = where the camera sits, degrees from north).
export const TOUR = [
  { sight: 'ggb', dist: 520, height: 140, bearing: 145, hour: 6.8, karl: 0.55 },
  { sight: 'palace', dist: 150, height: 45, bearing: 120, hour: 7.6, karl: 0.3 },
  { sight: 'lombard', dist: 160, height: 70, bearing: 90, hour: 9 },
  { sight: 'coit', dist: 260, height: 110, bearing: 140, hour: 10.5 },
  { sight: 'pier39', dist: 140, height: 40, bearing: 210, hour: 11.5 },
  { sight: 'alcatraz', dist: 900, height: 160, bearing: 170, hour: 12.5 },
  { sight: 'ferry', dist: 220, height: 70, bearing: 95, hour: 13.5 },
  { sight: 'transamerica', dist: 340, height: 160, bearing: 60, hour: 14.5 },
  { sight: 'chinatown', dist: 70, height: 14, bearing: 175, hour: 15.3 },
  { sight: 'cablecarturn', dist: 60, height: 18, bearing: 200, hour: 16 },
  { sight: 'cityhall', dist: 300, height: 90, bearing: 80, hour: 17 },
  { sight: 'painted', dist: 150, height: 32, bearing: 300, hour: 17.9 },
  { sight: 'salesforce', dist: 900, height: 260, bearing: 260, hour: 19.6 },
];
