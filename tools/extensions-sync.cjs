#!/usr/bin/env node

/**
 * Scans ~/extensions/* /manifest.json and generates ~/extensions/index.json
 * 
 * Usage: node tools/extensions-sync.js
 * 
 * Run after placing/updating plugins in ~/extensions/
 */

const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = path.resolve(__dirname, '..', 'extensions');
const INDEX_PATH = path.join(EXTENSIONS_DIR, 'index.json');

function scanExtensions() {
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    console.error(`Extensions directory not found: ${EXTENSIONS_DIR}`);
    process.exit(1);
  }

  const entries = [];
  const dirs = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const manifestPath = path.join(EXTENSIONS_DIR, dir.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.warn(`Skipping ${dir.name}: no manifest.json`);
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      entries.push({
        id: manifest.id,
        name: manifest.name || manifest.id,
        version: manifest.version || '?',
        manifestUrl: `/extensions/${dir.name}/manifest.json`,
        icon: manifest.icon || undefined,
      });
    } catch (e) {
      console.error(`Failed to parse ${manifestPath}:`, e.message);
    }
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
  console.log(`Generated ${INDEX_PATH} with ${entries.length} plugins`);
}

scanExtensions();