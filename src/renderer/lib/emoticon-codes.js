// The classic messenger emoticon set: what each one is called, the text codes
// (":)", "(Y)", …) that turn into it, and how a pack's files map onto it.
// Plain data and matching, no DOM.
import { fileTitle } from '../../shared/pack.js';

// [name, title, codes, other file names a pack may use], in picker order.
// A pack file matches on the name, the title or one of those file names.
const TABLE = [
  ['smile', 'Smile', [':)', ':-)'], ['regular_smile']],
  ['grin', 'Open-mouthed', [':D', ':-D'], ['teeth_smile', 'big_smile']],
  ['wink', 'Wink', [';)', ';-)'], ['wink_smile']],
  ['surprised', 'Surprised', [':O', ':-O'], ['omg_smile']],
  ['tongue', 'Tongue out', [':P', ':-P'], ['tongue_smile']],
  ['cool', 'Hot', ['(H)'], ['shades_smile']],
  ['angry', 'Angry', [':@', ':-@'], ['angry_smile']],
  ['embarrassed', 'Embarrassed', [':$', ':-$'], ['embarrassed_smile', 'embaressed_smile', 'red_smile']],
  ['confused', 'Confused', [':S', ':-S'], ['confused_smile']],
  ['sad', 'Sad', [':(', ':-('], ['sad_smile']],
  ['crying', 'Crying', [":'("], ['cry_smile', 'cry']],
  ['disappointed', 'Disappointed', [':|', ':-|'], ['whatchutalkingabout_smile']],
  ['angel', 'Angel', ['(A)'], ['angel_smile']],
  ['devil', 'Devil', ['(6)'], ['devil_smile']],
  ['dontTell', "Don't tell anyone", [':-#'], ['zipped', 'mouth_shut']],
  ['baringTeeth', 'Baring teeth', ['8o|'], ['teeth']],
  ['nerd', 'Nerd', ['8-|'], ['nerd_smile']],
  ['sarcastic', 'Sarcastic', ['^o)'], ['sarcastic_smile']],
  ['secret', 'Secret telling', [':-*'], ['whisper']],
  ['sick', 'Sick', ['+o('], ['sick_smile']],
  ['dontKnow', "I don't know", [':^)'], ['dont_know', 'shrug']],
  ['thinking', 'Thinking', ['*-)'], ['thinking_smile']],
  ['party', 'Party', ['<:o)'], ['party_smile']],
  ['eyeRoll', 'Eye-rolling', ['8-)'], ['rolling_eyes', 'eyeroll_smile']],
  ['sleepy', 'Sleepy', ['|-)'], ['tired', 'sleepy_smile']],
  ['thumbsUp', 'Thumbs up', ['(Y)'], []],
  ['thumbsDown', 'Thumbs down', ['(N)'], []],
  ['heart', 'Red heart', ['(L)', '<3'], []],
  ['brokenHeart', 'Broken heart', ['(U)'], []],
  ['lips', 'Red lips', ['(K)'], ['kiss']],
  ['rose', 'Red rose', ['(F)'], ['flower']],
  ['wiltedRose', 'Wilted rose', ['(W)'], ['wilted_flower']],
  ['leftHug', 'Left hug', ['({)'], ['dude_hug', 'hug_left']],
  ['rightHug', 'Right hug', ['(})'], ['girl_hug', 'hug_right']],
  ['girl', 'Girl', ['(X)'], ['girl_handsacrossamerica']],
  ['boy', 'Boy', ['(Z)'], ['guy_handsacrossamerica', 'guy']],
  ['star', 'Star', ['(*)'], []],
  ['moon', 'Sleeping half-moon', ['(S)'], ['half_moon']],
  ['sun', 'Sun', ['(#)'], []],
  ['rainbow', 'Rainbow', ['(R)'], []],
  ['coffee', 'Coffee cup', ['(C)'], []],
  ['beer', 'Beer mug', ['(B)'], ['beer_yum']],
  ['martini', 'Martini glass', ['(D)'], ['martini_shaken', 'cocktail']],
  ['cake', 'Birthday cake', ['(^)'], []],
  ['gift', 'Gift with a bow', ['(G)'], ['present']],
  ['bulb', 'Light bulb', ['(I)'], []],
  ['note', 'Note', ['(8)'], ['musical_note', 'music']],
  ['phone', 'Telephone receiver', ['(T)'], ['telephone']],
  ['camera', 'Camera', ['(P)'], []],
  ['film', 'Filmstrip', ['(~)'], ['movie']],
  ['email', 'E-mail', ['(E)'], ['envelope', 'mail']],
  ['clock', 'Clock', ['(O)'], []],
  ['messenger', 'Messenger icon', ['(M)'], ['msn', 'msn_messenger', 'msn_messenger_icon']],
  ['cat', 'Cat face', ['(@)'], ['kittykay']],
  ['dog', 'Dog face', ['(&)'], ['bowwow']],
  ['bat', 'Vampire bat', [':[', ':-['], []],
  ['snail', 'Snail', ['(sn)'], []],
  ['sheep', 'Black sheep', ['(bah)'], []],
  ['goat', 'Goat', ['(nah)'], []],
  ['turtle', 'Turtle', ['(tu)'], []],
  ['plate', 'Plate', ['(pl)'], []],
  ['bowl', 'Bowl', ['(||)'], []],
  ['pizza', 'Pizza', ['(pi)'], []],
  ['soccer', 'Soccer ball', ['(so)'], ['football']],
  ['car', 'Auto', ['(au)'], []],
  ['airplane', 'Airplane', ['(ap)'], ['plane']],
  ['umbrella', 'Umbrella', ['(um)'], []],
  ['island', 'Island with a palm tree', ['(ip)'], ['palm_tree']],
  ['computer', 'Computer', ['(co)'], []],
  ['mobile', 'Mobile phone', ['(mp)'], ['cellphone']],
  ['storm', 'Stormy cloud', ['(st)'], ['storm_cloud', 'rain']],
  ['lightning', 'Lightning', ['(li)'], []],
  ['money', 'Money', ['(mo)'], []],
  ['fingersCrossed', 'Fingers crossed', ['(yn)'], []],
  ['highFive', 'High five', ['(h5)'], []],
  ['brb', 'Be right back', ['(brb)'], []],
  ['cigarette', 'Cigarette', ['(ci)'], ['smoking']],
  ['xbox', 'Xbox', ['(xx)'], []],
];

/** @typedef {{ name: string, title: string, codes: string[], files: string[] }} Emoticon */

/** @type {Emoticon[]} */
export const EMOTICONS = TABLE.map(([name, title, codes, files]) => ({ name, title, codes, files }));

// Claude's replies only get the unambiguous faces, so "(C)" in a list stays "(C)".
export const SAFE_CODES = [":'(", ':-)', ':)', ':-D', ':D', ';-)', ';)', ':-(', ':(', ':-P', ':P', '<3', '(Y)', '(N)'];

// "Thumbs Up.PNG", "thumbs_up.gif" and "thumbsUp" are all the same name.
const fileKey = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const byFileKey = new Map();
for (const emoticon of EMOTICONS) {
  for (const key of [emoticon.name, emoticon.title, ...emoticon.files].map(fileKey)) {
    if (!byFileKey.has(key)) byFileKey.set(key, emoticon);
  }
}

/**
 * The emoticons on offer: the ones with built-in art, plus whatever the pack
 * brings. A pack file named after an emoticon is its picture; any other file
 * is a custom emoticon you type as "(file name)".
 * @param {string[]} files  the pack's emoticon files
 * @param {(name: string) => boolean} hasArt  is there built-in art for this name?
 * @returns {{ name: string, title: string, code: string, codes: string[], file: string | null }[]}
 */
export function availableEmoticons(files, hasArt) {
  const pictures = new Map();
  const others = [];
  for (const file of files) {
    const emoticon = byFileKey.get(fileKey(file));
    if (emoticon && !pictures.has(emoticon.name)) pictures.set(emoticon.name, file);
    else others.push(file);
  }
  const list = EMOTICONS.filter(({ name }) => pictures.has(name) || hasArt(name)).map(({ name, title, codes }) => ({
    name,
    title,
    code: codes[0],
    codes,
    file: pictures.get(name) || null,
  }));
  const taken = new Set(list.flatMap((e) => e.codes.map((code) => code.toLowerCase())));
  for (const file of others) {
    const code = `(${file.replace(/\.[^.]+$/, '')})`;
    if (taken.has(code.toLowerCase())) continue;
    taken.add(code.toLowerCase());
    list.push({ name: `custom:${file}`, title: fileTitle(file), code, codes: [code], file });
  }
  return list;
}

/**
 * Finds any of `codes` standing on its own in a text. Match 1 is what comes
 * before the code, match 2 the code. Longer codes win, case doesn't matter.
 * @param {string[]} codes
 */
export function codePattern(codes) {
  if (!codes.length) return /(?!)/g;
  const alternatives = [...codes]
    .sort((a, b) => b.length - a.length)
    .map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[\\s"'])(${alternatives.join('|')})(?=$|[\\s.,!?"'])`, 'gi');
}
