// benchmarks/fuzzy_match_benchmark.mjs
// Benchmark for fuzzy matching using the exact production implementation.

import fs from 'fs';
import path from 'path';
import stringSimilarity from 'string-similarity';

// Load hardcodedReplies from backend/server.js
const serverPath = path.join(process.cwd(), 'backend', 'server.js');
const serverSrc = fs.readFileSync(serverPath, 'utf8');
const hardcodedMatch = serverSrc.match(/const\s+hardcodedReplies\s*=\s*\{([\s\S]*?)\};/);
if (!hardcodedMatch) {
  console.error('Failed to locate hardcodedReplies');
  process.exit(1);
}
const objectLiteral = `{${hardcodedMatch[1]}}`;
// eslint-disable-next-line no-eval
const hardcodedReplies = eval(objectLiteral);

function getFuzzyMatchReply(userInput) {
  const normalizedInput = userInput.toLowerCase().replace(/[^\w\s]/gi, "");
  const questions = Object.keys(hardcodedReplies);
  const match = stringSimilarity.findBestMatch(normalizedInput, questions);
  if (match.bestMatch.rating > 0.6) {
    return hardcodedReplies[match.bestMatch.target];
  }
  return null;
}

function baselineMatch(userInput) {
  const normalized = userInput.toLowerCase().replace(/[^\w\s]/gi, "");
  return hardcodedReplies[normalized] || null;
}

// Generate realistic perturbations for a given query
function generatePerturbations(query) {
  const variations = [];
  // spelling mistake (swap two adjacent chars)
  if (query.length > 3) {
    const i = Math.floor(query.length / 2);
    const swapped = query.slice(0, i - 1) + query[i] + query[i - 1] + query.slice(i + 1);
    variations.push(swapped);
  }
  // missing character
  if (query.length > 2) {
    const i = Math.floor(query.length / 3);
    variations.push(query.slice(0, i) + query.slice(i + 1));
  }
  // duplicated character
  if (query.length > 2) {
    const i = Math.floor(query.length / 4);
    variations.push(query.slice(0, i) + query[i] + query[i] + query.slice(i + 1));
  }
  // missing spaces
  variations.push(query.replace(/ /g, ''));
  // extra spaces
  variations.push(' ' + query + ' ');
  // punctuation variation
  variations.push(query + '!!');
  // upper‑case version
  variations.push(query.toUpperCase());
  // common typo map
  const typoMap = { a: 's', s: 'a', e: 'r', r: 'e', i: 'o', o: 'i', n: 'b', b: 'n' };
  for (let i = 0; i < query.length; i++) {
    const lower = query[i].toLowerCase();
    if (typoMap[lower]) {
      const alt = query[i] === lower ? typoMap[lower] : typoMap[lower].toUpperCase();
      variations.push(query.slice(0, i) + alt + query.slice(i + 1));
      break;
    }
  }
  return variations;
}

let total = 0;
let baselineMatches = 0;
let baselineMisses = 0;
let fuzzyRecovered = 0;
let fuzzyMissed = 0;
let falsePositives = 0;

for (const q of Object.keys(hardcodedReplies)) {
  const perturbs = generatePerturbations(q);
  for (const p of perturbs) {
    total++;
    const baseline = baselineMatch(p);
    if (baseline) {
      baselineMatches++;
      const fuzzy = getFuzzyMatchReply(p);
      if (fuzzy && fuzzy !== baseline) {
        falsePositives++;
      }
      continue;
    }
    baselineMisses++;
    const fuzzy = getFuzzyMatchReply(p);
    if (fuzzy) {
      fuzzyRecovered++;
    } else {
      fuzzyMissed++;
    }
  }
}

const recoveryRate = baselineMisses ? (fuzzyRecovered / baselineMisses) * 100 : 0;
const fuzzyAccuracy = total ? ((baselineMatches + fuzzyRecovered) / total) * 100 : 0;

console.log('=== Fuzzy Matching Benchmark ===');
console.log(`Total cases: ${total}`);
console.log(`Baseline matches: ${baselineMatches}`);
console.log(`Baseline misses: ${baselineMisses}`);
console.log(`Fuzzy recovered: ${fuzzyRecovered}`);
console.log(`Fuzzy missed: ${fuzzyMissed}`);
console.log(`False positives: ${falsePositives}`);
console.log(`Recovery rate (among baseline misses): ${recoveryRate.toFixed(2)}%`);
console.log(`Overall fuzzy accuracy: ${fuzzyAccuracy.toFixed(2)}%`);
