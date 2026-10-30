#!/usr/bin/env node

/**
 * Scans ~/extensions/* /manifest.json and generates ~/extensions/index.json
 *
 * Usage: node tools/extensions-sync.cjs
 *
 * Run after placing/updating plugins in ~/extensions/
 * (tools/tessera-ext.cjs runs it automatically after install/update/remove).
 */

const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = process.env.TESSERA_EXTENSIONS_DIR
  ? path.resolve(process.env.TESSERA_EXTENSIONS_DIR)
  : path.resolve(__dirname, '..', 'extensions');

/** Written by tools/tessera-ext.cjs next to manifest.json of registry plugins. */
const ORIGIN_FILE = '.tessera-origin.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scanExtensions(extensionsDir = EXTENSIONS_DIR, log = console) {
  if (!fs.existsSync(extensionsDir)) {
    throw new Error(`Extensions directory not found: ${extensionsDir}`);
  }

  const entries = [];
  const dirs = fs.readdirSync(extensionsDir, { withFileTypes: true });

  for (const dir of dirs) {
    // скрытые папки — staging/backup установщика
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;

    const manifestPath = path.join(extensionsDir, dir.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      log.warn(`Skipping ${dir.name}: no manifest.json`);
      continue;
    }

    try {
      const manifest = readJson(manifestPath);

      let origin = null;
      const originPath = path.join(extensionsDir, dir.name, ORIGIN_FILE);
      if (fs.existsSync(originPath)) {
        try {
          origin = readJson(originPath);
        } catch (e) {
          log.warn(`Ignoring broken ${originPath}: ${e.message}`);
        }
      }

      entries.push({
        id: manifest.id,
        name: manifest.name || manifest.id,
        version: manifest.version || '?',
        manifestUrl: `/extensions/${dir.name}/manifest.json`,
        icon: manifest.icon || undefined,
        description: manifest.description || undefined,
        origin: origin ? 'registry' : 'local',
        sha256: origin?.sha256 || undefined,
      });
    } catch (e) {
      log.error(`Failed to parse ${manifestPath}:`, e.message);
    }
  }

  const indexPath = path.join(extensionsDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2));
  log.log(`Generated ${indexPath} with ${entries.length} plugins`);
  return entries;
}

module.exports = { scanExtensions, EXTENSIONS_DIR, ORIGIN_FILE };

if (require.main === module) {
  try {
    scanExtensions();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
