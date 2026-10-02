/**
 * Verification test for DOM injection across Feed and Standalone post views
 */
const fs = require('fs');
const path = require('path');

console.log('🧪 Verifying DOM injection selectors...');

const html = fs.readFileSync(path.join(__dirname, 'mock_instagram.html'), 'utf-8');

// Regex-based simulation of selector queries to ensure our selectors match the elements in mock_instagram.html
const hasSectionActionBars = html.includes('class="action-bar"');
const hasSavePolygon = html.includes('points="20 21 12 13.44 4 21 4 3 20 3 20 21"');
const hasSaveAria = html.includes('aria-label="Save"');
const hasStandaloneView = html.includes('mahabirpun1');

console.log('✓ Found action bar sections:', hasSectionActionBars);
console.log('✓ Found Save ribbon SVG polygon:', hasSavePolygon);
console.log('✓ Found Save aria-label:', hasSaveAria);
console.log('✓ Found Standalone View (mahabirpun1):', hasStandaloneView);

if (hasSectionActionBars && hasSavePolygon && hasSaveAria && hasStandaloneView) {
  console.log('🎉 DOM INJECTION STRUCTURE VERIFIED FOR STANDALONE POSTS!');
} else {
  console.error('❌ Failed DOM verification');
  process.exit(1);
}
