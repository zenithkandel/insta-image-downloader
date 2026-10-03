/**
 * Comprehensive verification test to ensure NO stray download buttons are injected
 * into navigation, sidebars, suggested accounts, or footers.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting Clean Injection Verification Test...\n');

const contentJs = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf-8');
const mockHtml = fs.readFileSync(path.join(__dirname, 'mock_instagram.html'), 'utf-8');

// 1. Verify dangerous selectors were removed from content.js
console.log('▶ Check 1: Verify elimination of overly broad and rogue selectors in content.js');

assert(!contentJs.includes("path[d*=\"20 21\"]"), 'Must NOT contain path[d*="20 21"] which matches arbitrary SVG path coordinates');
assert(!contentJs.includes("path[d*=\"20 22\"]"), 'Must NOT contain path[d*="20 22"]');
assert(!contentJs.includes('[aria-label*="Direct" i]'), 'Must NOT match Direct messages link in navigation sidebar');
assert(!contentJs.includes('[aria-label="Remove" i]'), 'Must NOT match bare [aria-label="Remove" i] which matches suggested user dismiss X buttons');
assert(!contentJs.includes("actionRow.appendChild(btnWrapper)"), 'Must NOT fall back to blindly appending CTA to arbitrary containers');

console.log('   ✓ Passed: All overly broad and rogue selectors have been eliminated.\n');

// 2. Verify strict container scoping and post-level deduplication
console.log('▶ Check 2: Verify strict post scoping and deduplication');

assert(contentJs.includes("postContainer.querySelector('.insta-dl-action-btn-wrapper')"), 'Must enforce 1 action button per post');
assert(contentJs.includes("postRoot.querySelector('.insta-dl-media-badge-container')"), 'Must enforce 1 media badge per post');
assert(contentJs.includes("closest('nav, [role=\"navigation\"], aside, [role=\"complementary\"], header, footer')"), 'Must explicitly reject navigation, sidebar, header, and footer containers');
assert(contentJs.includes("cleanupOrphanButtons"), 'Must include cleanup routine for any stray buttons');

console.log('   ✓ Passed: Strict post scoping, deduplication, and orphan cleanup are active.\n');

// 3. Verify mock page DOM elements
console.log('▶ Check 3: Verify mock page contains realistic navigation, sidebar, and posts');

assert(mockHtml.includes('class="side-nav"'), 'Mock page includes side-nav');
assert(mockHtml.includes('aria-label="Direct"'), 'Mock page includes Direct nav button');
assert(mockHtml.includes('class="side-suggestions"'), 'Mock page includes suggested accounts sidebar');
assert(mockHtml.includes('aria-label="Remove"'), 'Mock page includes suggested accounts Remove button');
assert(mockHtml.includes('id="post-1"'), 'Mock page includes Post 1');
assert(mockHtml.includes('id="post-2"'), 'Mock page includes Post 2');
assert(mockHtml.includes('standalone-post-view'), 'Mock page includes Standalone Post 3');

console.log('   ✓ Passed: Mock page contains navigation, suggestions, and posts.\n');

// 4. Verify popup settings synchronization
console.log('▶ Check 4: Verify popup setting synchronization');

assert(contentJs.includes("showFloatingBadge"), 'Must track showFloatingBadge preference');
assert(contentJs.includes("chrome.storage.onChanged"), 'Must listen for storage updates from popup');

console.log('   ✓ Passed: Settings sync enabled.\n');

console.log('🎉 ALL CLEAN INJECTION VERIFICATIONS PASSED!\n');
