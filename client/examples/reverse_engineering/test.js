// test.js
// Test driver for the reverse engineering pipeline.
//
// Usage:
//   node test.js <path-to-jsx-file>
//
// Examples:
//   node test.js ../../../SpringStorageReport.jsx
//   node test.js ../../../Box-Distribution-by-Tag.jsx
//   node test.js ../../../Category-Distribution-Tag-Cloud-Report.jsx
//
// To change language or passes, edit config.json:
//   outputLanguage: "en" | "zh-TW" | "zh-CN" | "ja" | "ko" | "fr" | "de" | "es"
//   refinePasses:   0 | 1 | 2

import fs from 'fs';
import path from 'path';
import { reverseEngineer } from './index.js';
import { JobCancelledError } from '../../client.js';

const jsxFile = process.argv[2];

if (!jsxFile) {
  console.error('Usage: node test.js <path-to-jsx-file>');
  process.exit(1);
}

const jsxPath = path.resolve(jsxFile);
if (!fs.existsSync(jsxPath)) {
  console.error(`File not found: ${jsxPath}`);
  process.exit(1);
}

const jsxSource = fs.readFileSync(jsxPath, 'utf8');

console.log('─'.repeat(60));
console.log(`📄 File    : ${path.basename(jsxPath)}`);
console.log(`📏 Size    : ${jsxSource.length} chars`);
console.log('─'.repeat(60));

try {
  const start  = Date.now();
  const result = await reverseEngineer(jsxSource);
  const total  = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n✅ RESULT\n');
  console.log(`TITLE: ${result.title}`);
  console.log(`\nDESCRIPTION: ${result.description}`);
  console.log(`\nPROMPT:\n${result.prompt}`);
  console.log('─'.repeat(60));
  console.log(`⏱  Total time : ${total}s`);
  console.log(`🔄 Passes done: ${result.passes}`);
  console.log(`🌐 Language   : ${result.language}`);
  console.log('─'.repeat(60));

} catch (err) {
  if (err instanceof JobCancelledError) {
    console.error('Job was cancelled:', err.jobId);
  } else {
    console.error('Error:', err.message);
  }
  process.exit(1);
}
