#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN   || '';
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const BASE_ID        = 'apph243NPR5JjRPav';
const TABLE_ID       = 'tblRNrmF9zlhpC9fh';
const OUTPUT_FILE    = path.join(__dirname, '..', 'places-cache.json');

console.log('=== Indy Matcha — Places Cache Refresh ===');
console.log('Node version:', process.version);
console.log('AIRTABLE_TOKEN set:', AIRTABLE_TOKEN.length > 0);
console.log('GOOGLE_PLACES_API_KEY set:', GOOGLE_API_KEY.length > 0);

if (!AIRTABLE_TOKEN)  { console.error('ERROR: AIRTABLE_TOKEN secret is missing or empty'); process.exit(1); }
if (!GOOGLE_API_KEY)  { console.error('ERROR: GOOGLE_PLACES_API_KEY secret is missing or empty'); process.exit(1); }

// ── 1. Fetch published spot names from Airtable ───────────────────────────────
async function fetchSpotNames() {
  const formula = encodeURIComponent("{publish}='publish'");
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?fields%5B%5D=Name&filterByFormula=${formula}&pageSize=100`;
  console.log('\nFetching spots from Airtable…');
  console.log('URL:', url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const text = await res.text();
  console.log('Airtable response status:', res.status);
  if (!res.ok) {
    console.error('Airtable error body:', text);
    throw new Error(`Airtable error ${res.status}`);
  }
  const { records } = JSON.parse(text);
  const names = (records || []).map(r => r.fields.Name).filter(Boolean);
  console.log('Spots found:', names.length, names);
  return names;
}

// ── 2. Fetch place details from Google Places API (New) REST ──────────────────
async function fetchPlaceDetails(name) {
  const body = JSON.stringify({
    textQuery:      `${name} Indianapolis Indiana`,
    maxResultCount: 1,
  });

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours.weekdayDescriptions',
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    console.warn(`  ⚠ Places API ${res.status} for "${name}":`, text.slice(0, 200));
    return null;
  }

  const json = JSON.parse(text);
  const p = json.places?.[0];
  if (!p) { console.warn(`  ⚠ No Places result for "${name}"`); return null; }

  return {
    rating:              p.rating              ?? null,
    userRatingCount:     p.userRatingCount      ?? null,
    weekdayDescriptions: p.regularOpeningHours?.weekdayDescriptions || [],
    nationalPhoneNumber: p.nationalPhoneNumber  ?? null,
    websiteURI:          p.websiteUri           ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const names = await fetchSpotNames();
  if (names.length === 0) {
    console.warn('No published spots found — writing empty cache.');
  }

  const spots = {};
  for (const name of names) {
    process.stdout.write(`  Fetching Places data for "${name}"… `);
    try {
      const data = await fetchPlaceDetails(name);
      if (data) { spots[name] = data; console.log('✓'); }
      else       { console.log('no result'); }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const cache = { cached_at: new Date().toISOString(), spots };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2));
  console.log(`\nDone — wrote ${Object.keys(spots).length} entries to places-cache.json`);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
