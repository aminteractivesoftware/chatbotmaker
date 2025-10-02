import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Extract book cover from a book URL (Goodreads, Amazon, etc.)
 * @param {string} url - URL to the book page
 * @returns {Promise<string>} Cover image URL
 */
export async function extractCoverFromUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    let coverUrl = null;

    // Goodreads
    if (url.includes('goodreads.com')) {
      coverUrl = $('img.ResponsiveImage').first().attr('src') ||
                 $('img[class*="BookCover"]').first().attr('src') ||
                 $('img[alt*="Cover"]').first().attr('src');
    }

    // Amazon
    else if (url.includes('amazon.com')) {
      coverUrl = $('#imgBlkFront').attr('src') ||
                 $('#ebooksImgBlkFront').attr('src') ||
                 $('img[data-a-image-name="landingImage"]').attr('src') ||
                 $('img.a-dynamic-image').first().attr('src');
    }

    // Generic fallback - try to find largest image
    else {
      const images = $('img');
      let largestImg = null;
      let maxSize = 0;

      images.each((i, img) => {
        const src = $(img).attr('src');
        const alt = $(img).attr('alt') || '';
        const width = parseInt($(img).attr('width') || 0);
        const height = parseInt($(img).attr('height') || 0);
        const size = width * height;

        if (src && (alt.toLowerCase().includes('cover') || size > maxSize)) {
          if (alt.toLowerCase().includes('cover')) {
            largestImg = src;
            return false; // break
          }
          if (size > maxSize) {
            maxSize = size;
            largestImg = src;
          }
        }
      });

      coverUrl = largestImg;
    }

    if (!coverUrl) {
      throw new Error('Could not find cover image on page');
    }

    // Handle relative URLs
    if (coverUrl.startsWith('//')) {
      coverUrl = 'https:' + coverUrl;
    } else if (coverUrl.startsWith('/')) {
      const urlObj = new URL(url);
      coverUrl = urlObj.origin + coverUrl;
    }

    return coverUrl;
  } catch (error) {
    throw new Error(`Failed to extract cover from URL: ${error.message}`);
  }
}

/**
 * Download image from URL
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<Buffer>} Image buffer
 */
export async function downloadImage(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Failed to download image: ${error.message}`);
  }
}
