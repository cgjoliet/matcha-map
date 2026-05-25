#!/usr/bin/env node
// Daily Places API refresh — run by GitHub Actions, outputs places-cache.json
// Uses Google Places API (New) REST endpoint so no browser SDK needed.

const fs   = require('fs');
const path = require('path');

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BASE_ID        = 'apph243NPR5JjRPav';
const TABLE_ID       = 'tblRNrmF9zlhpC9fh';
const OUTPUT_FILE    = path.join(__dirname, '..', 'places-cache.json');

if (!AIRTABLE_TOKEN)  throw new Error('AIRTABLE_TOKEN env var is required');
if (!GOOGLE_API_KEY)  throw new Error('GOOGLE_PLACES_API_KEY env var is required');

// ── 1. Fetch published spot names from Airtable ───────────────────────────────
async function fetchSpotNames() {
  const formula = encodeURIComponent("{publish}='publish'");   // matches index.html
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`
    + `?fields%5B%5D=Name&filterByFormula=${formula}&pageSize=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  const { records } = await res.json();
  return records.map(r => r.fields.Name).filter(Boolean);
}

// ── 2. Fetch place details from Google Places API (New) REST ──────────────────
async function fetchPlaceDetails(name) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   GOOGLE_API_KEY,
      'X-Goog-FieldMask': [
        'places.rating',
        'places.userRatingCount',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.regularOpeningHours.weekdayDescriptions',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery:      `${name} Indianapolis Indiana`,
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    console.warn(`  ⚠ Places API error for "${name}": ${res.status}`);
    return null;
  }

  const json = await res.json();
  const p = json.places?.[0];
  if (!p) {
    console.warn(`  ⚠ No result for "${name}"`);
    return null;
  }

  return {
    rating:              p.rating              ?? null,
    userRatingCount:     p.userRatingCount      ?? null,
    weekdayDescriptions: p.regularOpeningHours?.weekdayDescriptions || [],
    // isOpenNow omitted — client computes it from weekdayDescriptions at load time
    nationalPhoneNumber: p.nationalPhoneNumber  ?? null,
    websiteURI:          p.websiteUri           ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching spot names from Airtable…');
  const names = await fetchSpotNames();
  console.log(`Found ${names.length} published spots: ${names.join(', ')}`);

  const spots = {};
  for (const name of names) {
    process.stdout.write(`  Fetching "${name}"… `);
    const data = await fetchPlaceDetails(name);
    if (data) {
      spots[name] = data;
      console.log('✓');
    }
    // 200 ms between calls to stay well under rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  const cache = { cached_at: new Date().toISOString(), spots };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2));
  console.log(`\nWrote ${Object.keys(spots).length} entries to places-cache.json ✓`);
}

main().catch(err => { console.error(err); process.exit(1); });
