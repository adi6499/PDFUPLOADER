// What Jini understands (public/js/jini-brain.js), checked on messages people really type.
//   node tools/test-jini.mjs
import { read, intentOf, decodeBearing, convert, siteHelp, isYes, isNo } from '../public/js/jini-brain.js';

let ok = 0, bad = 0;
const check = (label, got, want) => {
  const pass = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++; else { bad++; console.log(`  FAIL ${label}\n       got  ${JSON.stringify(got)}`); }
};

// whole sentences
let r = read('I need 40 pcs of 22220 EJW33 for Pune, I am Rakesh Shah 98200 11223');
check('qty', r.qty, '40'); check('unit', r.unit, 'nos'); check('part', r.parts[0], (p) => /22220/.test(p)); check('name', r.name, 'Rakesh Shah');
check('phone', r.phone, '98200 11223'); check('city', r.city, 'Pune'); check('part exact', r.parts[0], '22220 EJW33');
r = read('price for 6205-2RS C3 qty 100, rakesh@tatasteel.com from Tata Steel');
check('part 6205', r.parts[0], (p) => /6205/.test(p)); check('qty 100', r.qty, '100'); check('email', r.email, 'rakesh@tatasteel.com'); check('company', r.company, 'Tata Steel');
r = read('need 20 litres shell omala s2 gx 220 urgently');
check('litres', [r.qty, r.unit], ['20', 'litres']); check('brand shell', r.brands, ['Shell']); check('urgent', r.urgent, true);
r = read('lovejoy L100 jaw coupling 2 nos'); check('lovejoy', r.brands, ['Timken Lovejoy']); check('qty 2', r.qty, '2');
r = read('UCP 208 pillow block x 6'); check('x 6', r.qty, '6'); check('UCP', r.parts[0], (p) => /UCP/.test(p));

check('what is 6205', read('what is 6205 2rs').parts, ['6205 2RS']);
check('6205-2RS C3', read('price for 6205-2RS C3 qty 100').parts[0], '6205-2RS C3');
check('NU 2210', read('need NU 2210 bearing 4 nos').parts[0], 'NU 2210');
check('L100', read('lovejoy L100 jaw coupling').parts, ['L100']);
check('no viscosity', read('shell omala s2 gx 220 20 litres').parts.includes('220'), false);
// what it is about
const want = { 'hi': 'greet', 'Good morning': 'greet', 'are you a bot?': 'bot', 'thanks a lot': 'thanks', 'ok bye': 'bye',
  'can someone call me': 'person', 'what is your whatsapp number': 'person', 'where is your office': 'where', 'what are your timings': 'hours',
  'is 6205 in stock': 'stock', 'how much for 22220': 'price', '25 mm to inch': 'convert', '5 hp in kw': 'convert',
  'what is 6205 2rs': 'decode', 'send me the timken catalogue pdf': 'catalog', 'which brands do you have': 'brands', 'how do i download': 'help',
  'where is my order': 'order' };
for (const [msg, w] of Object.entries(want)) check(`intent "${msg}"`, intentOf(msg), w);

// bearing numbers
let b = decodeBearing('6205-2RS'); check('6205 kind', b && b.kind, (k) => /deep groove/.test(k)); check('6205 bore', b && b.bore, 25); check('2RS', b && b.notes.join(' '), (n) => /rubber seals on both/.test(n));
b = decodeBearing('22220 EJW33'); check('22220 kind', b && b.kind, (k) => /spherical roller/.test(k)); check('22220 bore', b && b.bore, 100); check('EJW33', b && b.notes.join(' '), (n) => /W33/.test(n));
b = decodeBearing('6308 ZZ C3'); check('6308 bore', b && b.bore, 40); check('ZZ C3', b && b.notes.join(' '), (n) => /shields/.test(n) && /C3/.test(n));
b = decodeBearing('NU 2210'); check('NU', b && b.kind, (k) => /cylindrical/.test(k)); check('NU bore', b && b.bore, 50);
b = decodeBearing('UCP208'); check('UCP', b && b.kind, (k) => /pillow block/.test(k)); check('UCP bore', b && b.bore, 40);
b = decodeBearing('32210'); check('taper', b && b.kind, (k) => /tapered/.test(k));
b = decodeBearing('608 2RS'); check('608', b && b.bore, 8);
b = decodeBearing('LM48548'); check('inch', b && b.kind, (k) => /inch tapered/.test(k));
check('not a bearing', decodeBearing('hello'), null);

// units
check('25 mm', convert('25 mm to inch'), (s) => /0\.98 in/.test(s));
check('5 hp', convert('5 hp in kw'), (s) => /3\.73 kW/.test(s));
check('100 c', convert('100 c to f'), (s) => /212 °F/.test(s));
check('20 l', convert('20 litres to gallons'), (s) => /5\.28 US gal/.test(s));
// site help, yes / no
check('help download', siteHelp('how do i download the pdf'), (s) => /Download/.test(s));
check('help dark', siteHelp('how to turn on dark mode'), (s) => /Dark/.test(s));
check('yes', isYes('yes please'), true); check('no', isNo('no thanks'), true);

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
