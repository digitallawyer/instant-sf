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
