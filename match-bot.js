const axios = require('axios');
const cheerio = require('cheerio');

const BLOG_ID = process.env.BLOG_ID;
const API_KEY = process.env.API_KEY;
let ACCESS_TOKEN = null; 
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

async function refreshAccessToken() {
  try {
    console.log('🔄 Refreshing access token...');
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    });
    
    ACCESS_TOKEN = response.data.access_token;
    console.log('✅ Access token refreshed successfully');
    return ACCESS_TOKEN;
  } catch (error) {
    console.error('❌ Error refreshing access token:', error.response?.data || error.message);
    throw error;
  }
}

async function makeAuthenticatedRequest(url, data, method = 'GET') {
  try {
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
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('🔑 Token expired, refreshing...');
      await refreshAccessToken();
      
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
    throw error;
  }
}

async function fetchMatches(day = 'tomorrow') {
  try {
    let url;
    if (day === 'yesterday') {
      url = 'https://www.kooraliive.com/matches-yesterday/';
    } else if (day === 'today') {
      url = 'https://www.kooraliive.com/matches-today/';
    } else {
      url = 'https://www.kooraliive.com/matches-tomorrow/';
    }
    
    console.log(`Fetching matches for ${day} from ${url}`);
    
    const corsProxy = 'https://api.allorigins.win/raw?url=';
    const response = await axios.get(corsProxy + encodeURIComponent(url));
    const html = response.data;
    
    const $ = cheerio.load(html);
    const matches = [];
    
    $('.AY_Match').each((index, element) => {
      try {
        const homeTeam = $(element).find('.TM1 .TM_Name').text().trim();
        const awayTeam = $(element).find('.TM2 .TM_Name').text().trim();
        
        let homeTeamLogo = $(element).find('.TM1 .TM_Logo img').attr('src');
        if (homeTeamLogo && homeTeamLogo.includes('data:image/gif;base64')) {
          homeTeamLogo = $(element).find('.TM1 .TM_Logo img').attr('data-src');
        }
        
        let awayTeamLogo = $(element).find('.TM2 .TM_Logo img').attr('src');
        if (awayTeamLogo && awayTeamLogo.includes('data:image/gif;base64')) {
          awayTeamLogo = $(element).find('.TM2 .TM_Logo img').attr('data-src');
        }
        
        const time = $(element).find('.MT_Time').text().trim();
        const league = $(element).find('.MT_Info li:last-child span').text().trim();
        const broadcaster = $(element).find('.MT_Info li:first-child span').text().trim();
        
        // Get the match link for iframe extraction
        const matchLink = $(element).find('a').attr('href');
        
        if (!homeTeam || !awayTeam) {
          console.log(`Skipping match #${index} - missing team data`);
          return;
        }
        
        const match = {
          id: `${day}-${index}`,
          homeTeam,
          awayTeam,
          homeTeamLogo: homeTeamLogo || '',
          awayTeamLogo: awayTeamLogo || '',
          time: time || 'TBD',
          league: league || 'Football Match',
          broadcaster: broadcaster || 'TBD',
          date: day,
          matchLink: matchLink ? `https://www.kooraliive.com${matchLink}` : null
        };
        
        matches.push(match);
      } catch (error) {
        console.error(`Error parsing match ${index}:`, error);
      }
    });
    
    console.log(`Found ${matches.length} matches for ${day}`);
    return matches;
  } catch (error) {
    console.error('Error fetching matches:', error);
    return [];
  }
}

async function extractIframeFromMatch(matchUrl) {
  try {
    if (!matchUrl) {
      console.log('No match URL provided');
      return null;
    }
    
    console.log(`Extracting iframe from: ${matchUrl}`);
    
    const corsProxy = 'https://api.allorigins.win/raw?url=';
    const response = await axios.get(corsProxy + encodeURIComponent(matchUrl), {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Look for various iframe patterns commonly used for video streaming
    let iframe = null;
    
    // Try different selectors for iframes
    const iframeSelectors = [
      'iframe[src*="youtube"]',
      'iframe[src*="twitch"]',
      'iframe[src*="stream"]',
      'iframe[src*="player"]',
      'iframe[src*="embed"]',
      '.video-player iframe',
      '.player-container iframe',
      '#player iframe',
      '.stream-player iframe',
      'iframe'
    ];
    
    for (const selector of iframeSelectors) {
      const foundIframe = $(selector).first();
      if (foundIframe.length > 0) {
        const src = foundIframe.attr('src');
        if (src && !src.includes('ads') && !src.includes('advertisement')) {
          iframe = {
            src: src.startsWith('//') ? `https:${src}` : src,
            width: foundIframe.attr('width') || '100%',
            height: foundIframe.attr('height') || '400',
            allowfullscreen: foundIframe.attr('allowfullscreen') !== undefined,
            frameborder: foundIframe.attr('frameborder') || '0'
          };
          console.log(`Found iframe: ${iframe.src}`);
          break;
        }
      }
    }
    
    // If no iframe found, look for video tags or embedded players
    if (!iframe) {
      // Look for video elements
      const video = $('video source').first();
      if (video.length > 0) {
        const src = video.attr('src');
        if (src) {
          iframe = {
            src: src.startsWith('//') ? `https:${src}` : src,
            width: '100%',
            height: '400',
            isVideo: true
          };
          console.log(`Found video source: ${iframe.src}`);
        }
      }
    }
    
    // Look for embedded player scripts or data attributes
    if (!iframe) {
      const playerData = $('[data-player]').first();
      if (playerData.length > 0) {
        const playerUrl = playerData.attr('data-player');
        if (playerUrl) {
          iframe = {
            src: playerUrl.startsWith('//') ? `https:${playerUrl}` : playerUrl,
            width: '100%',
            height: '400'
          };
          console.log(`Found player data: ${iframe.src}`);
        }
      }
    }
    
    return iframe;
  } catch (error) {
    console.error('Error extracting iframe:', error.message);
    return null;
  }
}

async function checkPostExists(title) {
  try {
    const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/search?q=${encodeURIComponent(title)}&key=${API_KEY}`;
    const response = await axios.get(searchUrl);
    
    if (response.data.items && response.data.items.length > 0) {
      console.log(`Post with similar title already exists: ${title}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if post exists:', error);
    return false;
  }
}

async function createPost(match) {
  try {
    const title = `${match.homeTeam} vs ${match.awayTeam} - ${match.league}`;
    
    const exists = await checkPostExists(title);
    if (exists) {
      return null;
    }
    
    console.log(`Creating post for: ${title}`);
    
    // Extract iframe from the match page
    const iframeData = await extractIframeFromMatch(match.matchLink);
    
    const slugify = text => text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
    
    const slug = `${slugify(match.homeTeam)}-vs-${slugify(match.awayTeam)}`;
    
    // Build the player section based on whether we found an iframe
    let playerSection;
    if (iframeData) {
      if (iframeData.isVideo) {
        playerSection = `
          <div id="match-player">
            <div class="player-container">
              <video controls width="${iframeData.width}" height="${iframeData.height}">
                <source src="${iframeData.src}" type="video/mp4">
                Your browser does not support the video tag.
              </video>
            </div>
          </div>`;
      } else {
        playerSection = `
          <div id="match-player">
            <div class="player-container">
              <iframe 
                src="${iframeData.src}" 
                width="${iframeData.width}" 
                height="${iframeData.height}"
                frameborder="${iframeData.frameborder}"
                ${iframeData.allowfullscreen ? 'allowfullscreen' : ''}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
              </iframe>
            </div>
          </div>`;
      }
    } else {
      playerSection = `
        <div id="match-player">
          <div class="player-container">
            <p>سيتم إضافة بث المباراة قبل موعد المباراة</p>
            ${match.matchLink ? `<p><a href="${match.matchLink}" target="_blank">رابط المباراة</a></p>` : ''}
          </div>
        </div>`;
    }
    
    const content = `
      <div class="match-details">
        <h2>${match.league}</h2>
        <div class="teams">
          <div class="team home">
            ${match.homeTeamLogo ? `<img src="${match.homeTeamLogo}" alt="${match.homeTeam}">` : ''}
            <h3>${match.homeTeam}</h3>
          </div>
          <div class="match-time">
            <p>${match.time}</p>
            <p>${match.date === 'today' ? 'اليوم' : match.date === 'tomorrow' ? 'غداً' : 'أمس'}</p>
          </div>
          <div class="team away">
            ${match.awayTeamLogo ? `<img src="${match.awayTeamLogo}" alt="${match.awayTeam}">` : ''}
            <h3>${match.awayTeam}</h3>
          </div>
        </div>
        <div class="match-info">
          <p>📺 ${match.broadcaster}</p>
        </div>
        ${playerSection}
      </div>
    `;
    
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`;
    
    const postData = {
      kind: 'blogger#post',
      blog: { id: BLOG_ID },
      title: title,
      content: content
    };
    
    const response = await makeAuthenticatedRequest(url, postData, 'POST');
    
    console.log(`Post created: ${response.data.url}`);
    return response.data;
  } catch (error) {
    console.error('Error creating post:', error);
    if (error.response) {
      console.error('Error details:', error.response.data);
    }
    return null;
  }
}

async function createMatchPosts() {
  try {
    console.log('Starting to create match posts...');
    
    if (!BLOG_ID || !API_KEY || !REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
      console.error('❌ Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, REFRESH_TOKEN, CLIENT_ID, CLIENT_SECRET');
      process.exit(1);
    }
    
    console.log('🔑 Generating access token from refresh token...');
    try {
      await refreshAccessToken();
    } catch (error) {
      console.error('❌ Failed to generate access token. Check your refresh token and credentials.');
      return;
    }
    
    const matches = await fetchMatches('tomorrow');
    
    if (matches.length === 0) {
      console.log('No matches found for tomorrow');
      return;
    }
    
    let createdCount = 0;
    for (const match of matches) {
      console.log(`\nProcessing: ${match.homeTeam} vs ${match.awayTeam}`);
      const post = await createPost(match);
      if (post) {
        createdCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log(`\nFinished creating match posts. Created ${createdCount} new posts.`);
  } catch (error) {
    console.error('Error in createMatchPosts:', error);
  }
}

module.exports = {
  createMatchPosts,
  fetchMatches,
  extractIframeFromMatch,
  refreshAccessToken
};

if (require.main === module) {
  createMatchPosts();
}
