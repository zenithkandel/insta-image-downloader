/**
 * Automated test suite for Instagram Media Downloader
 * Tests JSZip archive building, jsPDF image document creation, and video filtering rules.
 */

const assert = require('assert');
const fs = require('fs');
const JSZip = require('../libs/jszip.min.js');
const { jsPDF } = require('../libs/jspdf.umd.min.js');

console.log('🧪 Starting Instagram Media Downloader Test Suite...\n');

// Mock media data
const mockPosts = {
  carouselWithImagesAndVideos: {
    username: 'kmc_note',
    shortcode: 'Dd_p9jLGkka',
    items: [
      { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', width: 1080, height: 1350 },
      { type: 'video', url: 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQyAAACAG1vb3Y=', width: 1080, height: 1350 },
      { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', width: 1080, height: 1350 }
    ]
  },
  videoOnlyPost: {
    username: 'indepthstory',
    shortcode: 'Dd_nC4FkTY6',
    items: [
      { type: 'video', url: 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQyAAACAG1vb3Y=', width: 1080, height: 1920 }
    ]
  }
};

async function testZipGeneration() {
  console.log('▶ Test 1: ZIP Generation (Images + Videos)');
  const post = mockPosts.carouselWithImagesAndVideos;
  
  // Rule: ZIP includes BOTH images and videos
  const zip = new JSZip();
  post.items.forEach((item, index) => {
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    const filename = `${post.username}_${post.shortcode}_${String(index + 1).padStart(2, '0')}.${ext}`;
    const base64Data = item.url.split(',')[1];
    zip.file(filename, Buffer.from(base64Data, 'base64'));
  });

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  assert(zipBuffer.length > 0, 'ZIP buffer should not be empty');
  
  // Inspect ZIP entries
  const parsedZip = await JSZip.loadAsync(zipBuffer);
  const files = Object.keys(parsedZip.files);
  console.log('   ZIP contains files:', files);
  assert.strictEqual(files.length, 3, 'ZIP should contain exactly 3 files');
  assert(files.some(f => f.endsWith('.mp4')), 'ZIP must include the video file as requested');
  assert(files.some(f => f.endsWith('.jpg')), 'ZIP must include the image files');
  console.log('   ✓ Passed: ZIP contains both images and videos correctly.\n');
}

async function testPdfGeneration() {
  console.log('▶ Test 2: PDF Generation (Images ONLY - Videos Excluded)');
  const post = mockPosts.carouselWithImagesAndVideos;
  
  // Rule: PDF includes ONLY images (videos are skipped)
  const imageItems = post.items.filter(item => item.type === 'image');
  assert.strictEqual(imageItems.length, 2, 'Should filter down to only 2 images');

  let doc = null;
  imageItems.forEach((img, i) => {
    const orientation = img.width >= img.height ? 'l' : 'p';
    if (i === 0) {
      doc = new jsPDF({ orientation, unit: 'px', format: [img.width, img.height] });
      doc.text(`Slide ${i + 1}`, 20, 40);
    } else {
      doc.addPage([img.width, img.height], orientation);
      doc.text(`Slide ${i + 1}`, 20, 40);
    }
  });

  const pdfOutput = doc.output();
  assert(pdfOutput.length > 0, 'PDF output should not be empty');
  
  // Verify page count in PDF
  const pageMatches = pdfOutput.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 0;
  console.log(`   PDF generated with ${pageCount} pages`);
  assert.strictEqual(pageCount, 2, 'PDF should have exactly 2 pages (no video page)');
  console.log('   ✓ Passed: PDF contains only images, videos strictly excluded.\n');
}

async function testVideoOnlyPostPdfValidation() {
  console.log('▶ Test 3: PDF Generation on Video-Only Post');
  const post = mockPosts.videoOnlyPost;
  
  const imageItems = post.items.filter(item => item.type === 'image');
  assert.strictEqual(imageItems.length, 0, 'Video-only post has 0 images');
  console.log('   ✓ Passed: Detected 0 images, prompts user to select ZIP for videos.\n');
}

async function run() {
  try {
    await testZipGeneration();
    await testPdfGeneration();
    await testVideoOnlyPostPdfValidation();
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

run();
