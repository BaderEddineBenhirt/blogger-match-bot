const axios = require('axios');
const fs = require('fs').promises;

const BLOG_ID = process.env.BLOG_ID;
const API_KEY = process.env.API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

async function makeAuthenticatedRequest(url, data, method = 'GET') {
  const config = {
    method,
    url,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  
  if (data && method !== 'GET') {
    config.data = data;
  }
  
  return await axios(config);
}

function isMatchFinished(timeString, publishedDate) {
  if (!timeString || timeString === 'TBD' || timeString === 'انتهت') {
    return true;
  }
  
  try {
    const publishedTime = new Date(publishedDate);
    const now = new Date();
    
    const timeParts = timeString.match(/(\d{1,2}):(\d{2})/);
    if (!timeParts) return true;
    
    let matchHour = parseInt(timeParts[1]);
    let matchMinute = parseInt(timeParts[2]);
    
    if (timeString.toLowerCase().includes('pm') && matchHour !== 12) {
      matchHour += 12;
    } else if (timeString.toLowerCase().includes('am') && matchHour === 12) {
      matchHour = 0;
    }
    
    const matchDate = new Date(publishedTime);
    matchDate.setHours(matchHour, matchMinute, 0, 0);
    
    const matchEndTime = new Date(matchDate.getTime() + (3 * 60 * 60 * 1000));
    
    return now > matchEndTime;
  } catch (error) {
    console.error('Error parsing match time:', error);
    return true;
  }
}

async function loadUrlMappings() {
  const path = './match-urls.json';
  
  try {
    const data = await fs.readFile(path, 'utf8');
    const mappings = JSON.parse(data);
    console.log(`Loaded ${Object.keys(mappings).length} URL mappings`);
    return mappings;
  } catch (error) {
    console.log('No URL mappings file found');
    return {};
  }
}

async function saveUrlMappings(mappings) {
  const path = './match-urls.json';
  
  try {
    await fs.writeFile(path, JSON.stringify(mappings, null, 2));
    console.log(`Updated URL mappings saved (${Object.keys(mappings).length} entries)`);
  } catch (error) {
    console.error('Error saving URL mappings:', error);
  }
}

async function extractPostIdFromUrl(postUrl) {
  try {
    if (postUrl.includes('/posts/')) {
      const matches = postUrl.match(/\/posts\/(\d+)/);
      if (matches && matches[1]) {
        return matches[1];
      }
    }
    
    const urlParts = postUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const postTitle = fileName.replace('.html', '').replace(/-/g, ' ');
    
    const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/search?q=${encodeURIComponent(postTitle)}&key=${API_KEY}`;
    const response = await axios.get(searchUrl);
    
    if (response.data.items && response.data.items.length > 0) {
      const exactMatch = response.data.items.find(post => post.url === postUrl);
      if (exactMatch) {
        return exactMatch.id;
      }
      return response.data.items[0].id;
    }
    
    console.log(`No post found for URL: ${postUrl}`);
    return null;
  } catch (error) {
    console.error(`Error extracting post ID from URL ${postUrl}:`, error);
    return null;
  }
}

async function deletePost(postId) {
  try {
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${postId}`;
    await makeAuthenticatedRequest(url, null, 'DELETE');
    console.log(`Successfully deleted post ${postId}`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`Post ${postId} not found (already deleted)`);
      return true;
    }
    console.error(`Error deleting post ${postId}:`, error.response?.data || error.message);
    return false;
  }
}

async function getAllBlogPosts(maxResults = 500) {
  try {
    console.log(`Fetching all blog posts (max: ${maxResults})`);
    
    let allPosts = [];
    let pageToken = '';
    let pageCount = 0;
    
    do {
      pageCount++;
      let url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=50&key=${API_KEY}`;
      
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }
      
      console.log(`Fetching page ${pageCount}...`);
      const response = await axios.get(url);
      
      if (response.data.items) {
        allPosts = allPosts.concat(response.data.items);
        console.log(`Added ${response.data.items.length} posts (total: ${allPosts.length})`);
      }
      
      pageToken = response.data.nextPageToken;
      
      if (allPosts.length >= maxResults) {
        allPosts = allPosts.slice(0, maxResults);
        break;
      }
      
      if (pageToken) {
        console.log('Waiting 2 seconds before next page...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } while (pageToken && allPosts.length < maxResults);
    
    console.log(`Total posts fetched: ${allPosts.length}`);
    return allPosts;
  } catch (error) {
    console.error('Error fetching blog posts:', error.response?.data || error.message);
    return [];
  }
}

function isMatchPost(postTitle) {
  const matchPatterns = [
    /vs\s/i,
    /\s-\s.*(?:league|cup|championship|liga|premier|serie|bundesliga|ligue)/i,
    /مباراة/,
    /ضد/
  ];
  
  return matchPatterns.some(pattern => pattern.test(postTitle));
}

async function deleteOldMatchPosts() {
  try {
    console.log('Starting to delete old match posts...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('All required environment variables found');
    console.log(`Blog ID: ${BLOG_ID}`);
    
    const urlMappings = await loadUrlMappings();
    let allPosts = await getAllBlogPosts();
    
    if (allPosts.length === 0) {
      console.log('No posts found to process');
      return;
    }
    
    const matchPosts = allPosts.filter(post => isMatchPost(post.title));
    console.log(`Found ${matchPosts.length} match posts out of ${allPosts.length} total posts`);
    
    let deletedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const deletedMappings = [];
    
    for (const post of matchPosts) {
      console.log(`\nProcessing: ${post.title}`);
      console.log(`Published: ${new Date(post.published).toLocaleString()}`);
      
      const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
      console.log(`Post age: ${postAge.toFixed(1)} hours`);
      
      let shouldDelete = false;
      let reason = '';
      
      if (postAge > 24) {
        shouldDelete = true;
        reason = `Post is ${postAge.toFixed(1)} hours old (>24h)`;
      } else {
        const timeMatch = post.content?.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
        const matchTime = timeMatch ? timeMatch[1] : null;
        
        if (matchTime) {
          const isFinished = isMatchFinished(matchTime, post.published);
          if (isFinished) {
            shouldDelete = true;
            reason = `Match at ${matchTime} is finished`;
          } else {
            reason = `Match at ${matchTime} is still current/future`;
          }
        } else {
          if (postAge > 6) {
            shouldDelete = true;
            reason = `No match time found and post is ${postAge.toFixed(1)} hours old (>6h)`;
          } else {
            reason = `No match time found but post is only ${postAge.toFixed(1)} hours old (<6h)`;
          }
        }
      }
      
      console.log(`Decision: ${shouldDelete ? 'DELETE' : 'KEEP'} - ${reason}`);
      
      if (shouldDelete) {
        const success = await deletePost(post.id);
        
        if (success) {
          deletedCount++;
          
          const mappingKey = Object.keys(urlMappings).find(key => 
            urlMappings[key].url === post.url
          );
          
          if (mappingKey) {
            deletedMappings.push(mappingKey);
            console.log(`Marked mapping for deletion: ${urlMappings[mappingKey].readableKey}`);
          }
        } else {
          errorCount++;
        }
        
        console.log('Waiting 10 seconds to respect rate limits...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        skippedCount++;
      }
    }
    
    deletedMappings.forEach(key => {
      delete urlMappings[key];
    });
    
    if (deletedMappings.length > 0) {
      await saveUrlMappings(urlMappings);
    }
    
    console.log(`\nDeletion Complete!`);
    console.log(`   Deleted: ${deletedCount} posts`);
    console.log(`   Skipped: ${skippedCount} posts`);
    console.log(`   Errors: ${errorCount} posts`);
    console.log(`   Total processed: ${deletedCount + skippedCount + errorCount}`);
    console.log(`   Cleaned mappings: ${deletedMappings.length} entries`);
    
  } catch (error) {
    console.error('Error in deleteOldMatchPosts:', error);
    process.exit(1);
  }
}

deleteOldMatchPosts();
