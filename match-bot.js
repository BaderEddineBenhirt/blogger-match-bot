const content = `
      <div class="match-details" style="font-family: Arial, sans-serif; direction: rtl; text-align: center;">
        <h2 style="color: #1976d2; margin-bottom: 20px;">${match.league}</h2>
        <div class="teams" style="display: flex; align-items: center; justify-content: space-between; margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 10px;">
          <div class="team home" style="text-align: center; flex: 1;">
            ${match.homeTeamLogo ? `<img src="${match.homeTeamLogo}" alt="${match.homeTeam}" style="width: 80px; height: 80px; object-fit: contain; margin-bottom: 10px;">` : ''}
            <h3 style="margin: 0; color: #333; font-size: 18px;">${match.homeTeam}</h3>
          </div>
          <div class="match-time" style="text-align: center; flex: 0 0 auto; margin: 0 20px;">
            <p style="font-size: 24px; font-weight: bold; color: #1976d2; margin: 5px 0;">${match.time}</p>
            <p style="font-size: 16px; color: #666; margin: 5px 0;">${match.date === 'today' ? 'اليوم' : match.date === 'tomorrow' ? 'غداً' : 'أمس'}</p>
          </div>
          <div class="team away" style="text-align: center; flex: 1;">
            ${match.awayTeamLogo ? `<img src="${match.awayTeamLogo}" alt="${match.awayTeam}" style="width: 80px; height: 80px; object-fit: contain; margin-bottom: 10px;">` : ''}
            <h3 style="margin: 0; color: #333; font-size: 18px;">${match.awayTeam}</h3>
          </div>
        </div>
        <div class="match-info" style="margin: 20px 0; padding: 15px; background: #e3f2fd; border-radius: 8px;">
          <p style="margin: 0; font-size: 16px; color: #1976d2;">📺 ${match.broadcaster}</p>
        </div>
        ${playerSection}
      </div>
    `;const axios = require('axios');
const cheerio = require('cheerio');

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
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    let iframe = null;
    
    const iframeSelectors = [
      '.entry-content iframe', 
      '.entry iframe',
      '#the-post iframe',
      'article iframe',
      '.post-content iframe',
      'iframe[src*="alkoora"]', 
      'iframe[src*="albaplayer"]',
      'iframe[src*="player"]',
      'iframe[src*="stream"]',
      'iframe[src*="live"]',
      'iframe[allowfullscreen]',  
      'iframe[height="500px"]',   
      'iframe'  
    ];
    
    for (const selector of iframeSelectors) {
      const foundIframes = $(selector);
      
      foundIframes.each((index, element) => {
        const src = $(element).attr('src');
        
        if (src && 
            !src.includes('ads') && 
            !src.includes('advertisement') && 
            !src.includes('banner') &&
            !src.includes('aqle3.com') && 
            !src.includes('bvtpk.com') && 
            src.length > 10) { 
          
          iframe = {
            src: src.startsWith('//') ? `https:${src}` : src,
            width: $(element).attr('width') || '100%',
            height: $(element).attr('height') || '500px',
            allowfullscreen: $(element).attr('allowfullscreen') !== undefined,
            frameborder: $(element).attr('frameborder') || '0',
            scrolling: $(element).attr('scrolling') || 'no'
          };
          
          console.log(`✅ Found iframe: ${iframe.src}`);
          return false;
        }
      });
      
      if (iframe) break; 
    }
    
    if (!iframe) {
      const allIframes = $('iframe');
      console.log(`No suitable iframe found. Total iframes on page: ${allIframes.length}`);
      allIframes.each((index, element) => {
        const src = $(element).attr('src');
        console.log(`Iframe ${index + 1}: ${src}`);
      });
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
    
    const iframeData = await extractIframeFromMatch(match.matchLink);
    
    let playerSection;
    if (iframeData) {
      const bloggerSafeIframe = `
        <div id="match-player" style="text-align: center; margin: 20px 0;">
          <div class="player-container" style="position: relative; width: 100%; height: 0; padding-bottom: 56.25%; background: #000;">
            <iframe 
              src="${iframeData.src}" 
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"
              allowfullscreen="allowfullscreen"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy">
            </iframe>
          </div>
        </div>`;
      
      playerSection = bloggerSafeIframe;
    } else {
      playerSection = `
        <div id="match-player" style="text-align: center; margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
          <div class="player-container">
            <p style="margin: 10px 0; color: #666;">سيتم إضافة بث المباراة قبل موعد المباراة</p>
            ${match.matchLink ? `<p style="margin: 10px 0;"><a href="${match.matchLink}" target="_blank" rel="noopener" style="color: #1976d2; text-decoration: none;">🔗 رابط المباراة</a></p>` : ''}
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
    
    console.log(`✅ Post created: ${response.data.url}`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 403) {
      const errorMessage = error.response?.data?.error?.message || 'Rate limit exceeded';
      if (errorMessage.includes('limit') || errorMessage.includes('timeframe')) {
        console.log(`⏸️  Rate limit hit for: ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`⏳ Waiting 5 minutes before retrying...`);
        await new Promise(resolve => setTimeout(resolve, 300000)); 
        
        try {
          const retryResponse = await makeAuthenticatedRequest(url, postData, 'POST');
          console.log(`✅ Post created after retry: ${retryResponse.data.url}`);
          return retryResponse.data;
        } catch (retryError) {
          console.log(`❌ Still rate limited after 5 minutes, skipping: ${match.homeTeam} vs ${match.awayTeam}`);
          return { skipped: true, reason: 'rate_limit' };
        }
      }
    }
    
    console.error('❌ Error creating post:', error.response?.data || error.message);
    return null;
  }
}

async function createMatchPosts() {
  try {
    console.log('🚀 Starting to create match posts...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('✅ All required environment variables found');
    console.log(`📝 Blog ID: ${BLOG_ID}`);
    
    const matches = await fetchMatches('tomorrow');
    
    if (matches.length === 0) {
      console.log('ℹ️  No matches found for tomorrow');
      return;
    }
    
    let createdCount = 0;
    let skippedCount = 0;
    
    for (const match of matches) {
      console.log(`\n⚽ Processing: ${match.homeTeam} vs ${match.awayTeam}`);
      const post = await createPost(match);
      
      if (post && post.skipped) {
        skippedCount++;
      } else if (post) {
        createdCount++;
      }
      
      if (createdCount > 0) {
        console.log('⏳ Waiting 30 seconds to respect Blogger rate limits...');
        await new Promise(resolve => setTimeout(resolve, 30000)); 
      } else {
        console.log('⏳ Waiting 5 seconds before next attempt...');
        await new Promise(resolve => setTimeout(resolve, 5000)); 
      }
    }
    
    console.log(`\n🎉 Finished! Created ${createdCount} new posts, skipped ${skippedCount} due to rate limits.`);
  } catch (error) {
    console.error('❌ Error in createMatchPosts:', error);
    process.exit(1);
  }
}

createMatchPosts();
