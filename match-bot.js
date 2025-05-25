const axios = require('axios');
const cheerio = require('cheerio');
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

async function fetchMatches(day = 'today') {
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
        
        const matchLinkElement = $(element).find('a');
        let matchLink = null;
        
        if (matchLinkElement.length > 0) {
          let href = matchLinkElement.attr('href');
          if (href) {
            if (href.startsWith('http')) {
              matchLink = href;
            } else if (href.startsWith('/')) {
              matchLink = `https://www.kooraliive.com${href}`;
            } else {
              matchLink = `https://www.kooraliive.com/${href}`;
            }
            console.log(`Found match link: ${matchLink}`);
          }
        }
        
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
          matchLink: matchLink
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
      'p iframe[allowfullscreen][height="500px"]',
      'iframe[allowfullscreen][height="500px"]',
      'iframe[src*="alkoora.live"]',
      'iframe[src*="albaplayer"]',
      '.entry-content iframe',
      '.entry iframe',
      '#the-post iframe',
      'article iframe',
      'iframe[allowfullscreen]',
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
            allowfullscreen: $(element).attr('allowfullscreen') || 'true',
            frameborder: $(element).attr('frameborder') || '0',
            scrolling: $(element).attr('scrolling') || '1'
          };
          
          console.log(`✅ Found iframe: ${iframe.src}`);
          console.log(`   - Width: ${iframe.width}, Height: ${iframe.height}`);
          console.log(`   - Allowfullscreen: ${iframe.allowfullscreen}, Scrolling: ${iframe.scrolling}`);
          return false;
        }
      });
      
      if (iframe) break;
    }
    
    if (!iframe) {
      const allIframes = $('iframe');
      console.log(`❌ No suitable iframe found. Total iframes on page: ${allIframes.length}`);
      
      if (allIframes.length > 0) {
        console.log('Available iframes:');
        allIframes.each((index, element) => {
          const src = $(element).attr('src');
          const width = $(element).attr('width');
          const height = $(element).attr('height');
          console.log(`  ${index + 1}. src: ${src}`);
          console.log(`     width: ${width}, height: ${height}`);
        });
      }
      
      const videoElements = $('video, embed, object');
      if (videoElements.length > 0) {
        console.log(`Found ${videoElements.length} other video elements`);
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

// ADDED: Function to create match key (same as browser will use)
function createMatchKey(homeTeam, awayTeam, date) {
  const combined = `${homeTeam}_${awayTeam}_${date}`.toLowerCase();
  return combined.replace(/\s+/g, '_').replace(/[^\w_]/g, '');
}

// ADDED: Function to store URL mapping
async function storeUrlMapping(match, actualUrl, publishedDate) {
  const path = './match-urls.json';
  
  try {
    let mappings = {};
    try {
      const data = await fs.readFile(path, 'utf8');
      mappings = JSON.parse(data);
    } catch (e) {
      console.log('Creating new URL mappings file');
    }
    
    const matchKey = createMatchKey(match.homeTeam, match.awayTeam, match.date);
    
    mappings[matchKey] = {
      url: actualUrl,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: match.league,
      date: match.date,
      published: publishedDate,
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(path, JSON.stringify(mappings, null, 2));
    console.log(`📝 URL mapping stored: ${matchKey} -> ${actualUrl}`);
  } catch (error) {
    console.error('Error storing URL mapping:', error);
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
      playerSection = `
        <div id="match-player" style="text-align: center; margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); border-radius: 15px; box-shadow: 0 6px 12px rgba(0,0,0,0.3);">
          <h3 style="color: #fff; margin-bottom: 20px; font-size: 22px; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🎥 مشاهدة المباراة مباشرة</h3>
          <p><iframe allowfullscreen='${iframeData.allowfullscreen}' frameborder='${iframeData.frameborder}' height='${iframeData.height}' scrolling='${iframeData.scrolling}' src='${iframeData.src}' width='${iframeData.width}'></iframe></p>
          <p style="margin-top: 15px; color: #ccc; font-size: 14px;">اضغط على زر التشغيل لبدء المشاهدة</p>
        </div>`;
    } else {
      playerSection = `
        <div id="match-player" style="text-align: center; margin: 30px 0; padding: 30px; background: linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%); border-radius: 15px; box-shadow: 0 6px 12px rgba(0,0,0,0.15);">
          <div class="player-container">
            <h3 style="color: #fff; margin-bottom: 15px; font-size: 20px; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">⏰ بث المباراة قريباً</h3>
            <p style="margin: 15px 0; color: #fff; font-size: 16px; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">سيتم إضافة بث المباراة قبل موعد المباراة</p>
            ${match.matchLink ? `<p style="margin: 15px 0;"><a href="${match.matchLink}" target="_blank" rel="noopener" style="display: inline-block; padding: 12px 25px; background: #fff; color: #ff7e5f; text-decoration: none; border-radius: 25px; font-weight: bold; box-shadow: 0 3px 6px rgba(0,0,0,0.2); transition: transform 0.2s; text-shadow: none;">🔗 رابط المباراة الأصلي</a></p>` : ''}
          </div>
        </div>`;
    }
    
    const content = `
      <div class="match-details" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: center; max-width: 900px; margin: 0 auto; padding: 25px; background: #ffffff; border-radius: 20px; box-shadow: 0 8px 25px rgba(0,0,0,0.1);">
        <h2 style="color: #1976d2; margin-bottom: 25px; font-size: 32px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.1); background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">🏆 ${match.league}</h2>
        
        <div class="teams" style="display: flex; align-items: center; justify-content: space-between; margin: 35px 0; padding: 35px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 20px; box-shadow: 0 6px 15px rgba(0,0,0,0.08); border: 1px solid #dee2e6;">
          <div class="team home" style="text-align: center; flex: 1;">
            ${match.homeTeamLogo ? `<img src="${match.homeTeamLogo}" alt="${match.homeTeam}" style="width: 120px; height: 120px; object-fit: contain; margin-bottom: 20px; border-radius: 60px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 3px solid #fff; background: #fff;">` : ''}
            <h3 style="margin: 0; color: #2c3e50; font-size: 22px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.05);">${match.homeTeam}</h3>
          </div>
          
          <div class="match-time" style="text-align: center; flex: 0 0 auto; margin: 0 35px; padding: 25px; background: linear-gradient(135deg, #fff 0%, #f8f9fa 100%); border-radius: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 2px solid #1976d2;">
            <p style="font-size: 36px; font-weight: bold; color: #1976d2; margin: 8px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">⏰ ${match.time}</p>
            <p style="font-size: 20px; color: #666; margin: 8px 0; font-weight: 600; background: #e3f2fd; padding: 8px 15px; border-radius: 20px;">${match.date === 'today' ? 'اليوم' : match.date === 'tomorrow' ? 'غداً' : 'أمس'}</p>
          </div>
          
          <div class="team away" style="text-align: center; flex: 1;">
            ${match.awayTeamLogo ? `<img src="${match.awayTeamLogo}" alt="${match.awayTeam}" style="width: 120px; height: 120px; object-fit: contain; margin-bottom: 20px; border-radius: 60px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 3px solid #fff; background: #fff;">` : ''}
            <h3 style="margin: 0; color: #2c3e50; font-size: 22px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.05);">${match.awayTeam}</h3>
          </div>
        </div>
        
        <div class="match-info" style="margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 15px; box-shadow: 0 6px 15px rgba(102, 126, 234, 0.3);">
          <p style="margin: 0; font-size: 20px; font-weight: 600; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">📺 القناة الناقلة: ${match.broadcaster}</p>
        </div>
        
        ${playerSection}
        
        <div style="margin-top: 35px; padding: 25px; background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-radius: 15px; border-left: 6px solid #4caf50; box-shadow: 0 4px 10px rgba(76, 175, 80, 0.2);">
          <p style="margin: 0; color: #2e7d32; font-size: 18px; font-weight: 600; text-shadow: 1px 1px 2px rgba(0,0,0,0.05);">💡 استمتع بمشاهدة المباراة بجودة عالية ومجاناً على موقعنا</p>
        </div>
        
        <div style="margin-top: 25px; padding: 20px; background: #f8f9fa; border-radius: 10px; border-top: 3px solid #17a2b8;">
          <p style="margin: 0; color: #6c757d; font-size: 14px; font-style: italic;">تابعونا للحصول على أحدث مباريات كرة القدم وأهم الأحداث الرياضية</p>
        </div>
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
    
    // ADDED: Store the URL mapping after successful post creation
    await storeUrlMapping(match, response.data.url, response.data.published);
    
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
          // ADDED: Store URL mapping for retry as well
          await storeUrlMapping(match, retryResponse.data.url, retryResponse.data.published);
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
    
    const matches = await fetchMatches('today');
    
    if (matches.length === 0) {
      console.log('ℹ️  No matches found for today');
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
