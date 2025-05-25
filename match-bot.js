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

function isMatchCurrentOrFuture(timeString) {
  if (!timeString || timeString === 'TBD' || timeString === 'انتهت') {
    return false;
  }
  
  try {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    console.log(`🕐 Current time: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} (${currentTime} minutes)`);
    
    // Handle both "06:00 PM" and "18:00" formats
    let matchHour, matchMinute;
    
    if (timeString.includes('PM') || timeString.includes('AM')) {
      // 12-hour format: "06:00 PM"
      const timeParts = timeString.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!timeParts) {
        console.log(`❌ Could not parse time format: ${timeString}`);
        return false;
      }
      
      matchHour = parseInt(timeParts[1]);
      matchMinute = parseInt(timeParts[2]);
      const period = timeParts[3].toUpperCase();
      
      // Convert to 24-hour format
      if (period === 'PM' && matchHour !== 12) {
        matchHour += 12;
      } else if (period === 'AM' && matchHour === 12) {
        matchHour = 0;
      }
    } else {
      // 24-hour format: "18:00"
      const timeParts = timeString.match(/(\d{1,2}):(\d{2})/);
      if (!timeParts) {
        console.log(`❌ Could not parse time format: ${timeString}`);
        return false;
      }
      
      matchHour = parseInt(timeParts[1]);
      matchMinute = parseInt(timeParts[2]);
    }
    
    const matchTime = matchHour * 60 + matchMinute;
    
    console.log(`⚽ Match "${timeString}" → ${matchHour}:${matchMinute.toString().padStart(2, '0')} (${matchTime} minutes)`);
    console.log(`📊 Comparison: Match time ${matchTime} vs Current time ${currentTime}`);
    
    // Allow matches that start within the next 30 minutes or are in the future
    const isCurrentOrFuture = matchTime >= (currentTime - 30);
    
    console.log(`✅ Result: ${isCurrentOrFuture ? 'FUTURE/CURRENT' : 'PAST'} (threshold: ${currentTime - 30})`);
    
    return isCurrentOrFuture;
  } catch (error) {
    console.error('Error parsing match time:', error);
    return false;
  }
}

function filterTodayMatches(matches) {
  return matches.filter(match => {
    if (match.date !== 'today') {
      console.log(`🔄 Filtering out non-today match: ${match.homeTeam} vs ${match.awayTeam} (${match.date})`);
      return false;
    }
    
    if (!isMatchCurrentOrFuture(match.time)) {
      console.log(`⏰ Filtering out past match: ${match.homeTeam} vs ${match.awayTeam} at ${match.time}`);
      return false;
    }
    
    console.log(`✅ Including current/future match: ${match.homeTeam} vs ${match.awayTeam} at ${match.time}`);
    return true;
  });
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
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    let iframe = null;
    
    const allIframes = $('iframe');
    console.log(`📊 Total iframes found: ${allIframes.length}`);
    
    allIframes.each((index, element) => {
      const src = $(element).attr('src');
      console.log(`  ${index + 1}. ${src}`);
    });
    
    const iframeSelectors = [
      '.entry-content iframe',
      '.entry iframe', 
      '#the-post iframe',
      'article iframe',
      '.post-content iframe',
      'p iframe',
      'div iframe',
      'iframe'
    ];
    
    for (const selector of iframeSelectors) {
      const foundIframes = $(selector);
      console.log(`🔍 Selector "${selector}" found ${foundIframes.length} iframe(s)`);
      
      foundIframes.each((index, element) => {
        const src = $(element).attr('src');
        
        if (src && 
            !src.includes('aqle3.com') && 
            !src.includes('bvtpk.com') &&
            !src.includes('googletagmanager') &&
            !src.includes('gtag.js') &&
            src.length > 10) {
          
          iframe = {
            src: src.startsWith('//') ? `https:${src}` : src,
            width: $(element).attr('width') || '100%',
            height: $(element).attr('height') || '500px',
            allowfullscreen: $(element).attr('allowfullscreen') || 'true',
            frameborder: $(element).attr('frameborder') || '0',
            scrolling: $(element).attr('scrolling') || '1'
          };
          
          console.log(`✅ Selected iframe: ${iframe.src}`);
          console.log(`   - Selector used: ${selector}`);
          console.log(`   - Dimensions: ${iframe.width} x ${iframe.height}`);
          return false;
        }
      });
      
      if (iframe) break;
    }
    
    if (!iframe && allIframes.length > 0) {
      console.log('🔄 Taking first non-ad iframe...');
      
      allIframes.each((index, element) => {
        const src = $(element).attr('src');
        
        if (src && 
            !src.includes('aqle3.com') && 
            !src.includes('bvtpk.com') &&
            !src.includes('googletagmanager') &&
            !src.includes('gtag.js') &&
            src.length > 10) {
          
          iframe = {
            src: src.startsWith('//') ? `https:${src}` : src,
            width: $(element).attr('width') || '100%',
            height: $(element).attr('height') || '500px',
            allowfullscreen: $(element).attr('allowfullscreen') || 'true',
            frameborder: $(element).attr('frameborder') || '0',
            scrolling: $(element).attr('scrolling') || '1'
          };
          
          console.log(`🔄 Using first valid iframe: ${iframe.src}`);
          return false;
        }
      });
    }
    
    if (!iframe) {
      console.log(`❌ No suitable iframe found in ${allIframes.length} total iframes`);
      
      if (allIframes.length > 0) {
        console.log('📋 All iframe sources found:');
        allIframes.each((index, element) => {
          const src = $(element).attr('src');
          const fullHtml = $(element).toString();
          console.log(`  ${index + 1}. Source: ${src}`);
          console.log(`     HTML: ${fullHtml.substring(0, 150)}...`);
        });
      }
    }
    
    return iframe;
  } catch (error) {
    console.error('❌ Error extracting iframe:', error.message);
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

function createMatchKey(homeTeam, awayTeam, date) {
  const combined = `${homeTeam}_vs_${awayTeam}_${date}`;
  return Buffer.from(combined, 'utf8').toString('base64')
    .replace(/[^A-Za-z0-9]/g, '') 
    .substring(0, 32);
}

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
    
    const readableKey = `${match.homeTeam} vs ${match.awayTeam} (${match.date})`;
    
    mappings[matchKey] = {
      url: actualUrl,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: match.league,
      date: match.date,
      published: publishedDate,
      lastUpdated: new Date().toISOString(),
      readableKey: readableKey 
    };
    
    await fs.writeFile(path, JSON.stringify(mappings, null, 2));
    console.log(`📝 URL mapping stored: ${readableKey} -> ${actualUrl}`);
  } catch (error) {
    console.error('Error storing URL mapping:', error);
  }
}

function cleanIframeContent(iframeData) {
  if (!iframeData) return null;
  
  return `
    <div class="albaplayer_server-body">
      <div class="video-con embed-responsive">
        <iframe allowfullscreen="${iframeData.allowfullscreen}" 
                class="cf" 
                frameborder="${iframeData.frameborder}" 
                height="${iframeData.height}" 
                name="search_iframe" 
                rel="nofollow" 
                sandbox="allow-forms allow-same-origin allow-scripts" 
                scrolling="no" 
                src="${iframeData.src}" 
                width="${iframeData.width}">
        </iframe>
      </div>
      <div class="albaplayer_videos_channel">
        <a class="button refresh" href="javascript:window.location.reload()">تحديث</a>
        <div id="showshare" style="display: block;" title="مشاركة">
          <span href="javascript:void(0)" onclick="document.getElementById('showother').style.display='block';document.getElementById('showshare').style.display='none'">
            <div class="button share">مشاركة</div>
          </span>
        </div>
        <div class="showother" id="showother" style="display: none;">
          <span href="javascript:void(0)" onclick="document.getElementById('showother').style.display='none';document.getElementById('showshare').style.display='block'" title="اغلاق">
            <div class="button close">اغلاق</div>
          </span>
          <div id="albaplayer_share_channel">
            <div class="share-channel">
              <div class="albaplayer_share_title">كود التضمين</div>
              <textarea id="albaplayer_player_share" onclick="this.select();" onfocus="this.select();">&lt;iframe allowfullscreen='true' frameborder='0' height='500px' scrolling='1' src='${iframeData.src}' width='100%'&gt;&lt;/iframe&gt;</textarea>
              <button class="custom-btn" onclick="document.querySelector('#albaplayer_player_share').select();document.execCommand('copy');">انقر للنسخ</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <style>
      #tme, 
      #tme_message,
      .telegram-popup,
      .telegram-widget,
      [id*="telegram"],
      [class*="telegram"],
      .subscription-popup,
      .social-popup {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      
      .albaplayer_server-body {
        position: relative !important;
        overflow: hidden !important;
      }
      
      div[style*="position: fixed"],
      div[style*="position: absolute"][style*="bottom"],
      div[style*="position: absolute"][style*="right"] {
        display: none !important;
      }
    </style>`;
}

async function createPost(match) {
  try {
    const title = `${match.homeTeam} vs ${match.awayTeam} - ${match.league}`;
    
    const exists = await checkPostExists(title);
    if (exists) {
      console.log(`Post already exists: ${title}`);
      
      if (match.date === 'today' && isMatchCurrentOrFuture(match.time)) {
        try {
          const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/search?q=${encodeURIComponent(title)}&key=${API_KEY}`;
          const response = await axios.get(searchUrl);
          
          if (response.data.items && response.data.items.length > 0) {
            const existingPost = response.data.items[0];
            
            const postDate = existingPost.published.split('T')[0];
            const today = new Date().toISOString().split('T')[0];
            
            if (postDate === today) {
              await storeUrlMapping(match, existingPost.url, existingPost.published);
              console.log(`📝 Registered existing current/future post: ${title}`);
              return { existing: true, title: title };
            } else {
              console.log(`⏰ Existing post is from ${postDate}, not today (${today}) - skipping registration`);
              return { existing: false, reason: 'old_date' };
            }
          }
        } catch (error) {
          console.error('Error registering existing post:', error);
        }
      } else {
        console.log(`⏰ Existing post is not current/future today - skipping registration`);
        return { existing: false, reason: 'not_current_future' };
      }
      
      return { existing: false, reason: 'not_tracked' };
    }
    
    console.log(`Creating post for: ${title}`);
    
    const iframeData = await extractIframeFromMatch(match.matchLink);
    
    let playerSection;
    if (iframeData) {
      const cleanContent = cleanIframeContent(iframeData);
      playerSection = `
        <div id="match-player" style="text-align: center; margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); border-radius: 15px; box-shadow: 0 6px 12px rgba(0,0,0,0.3);">
          <h3 style="color: #fff; margin-bottom: 15px; font-size: clamp(18px, 4vw, 22px); text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🎥 مشاهدة المباراة مباشرة</h3>
          ${cleanContent}
          <p style="margin-top: 15px; color: #ccc; font-size: 14px;">اضغط على زر التشغيل لبدء المشاهدة</p>
        </div>`;
    } else {
      playerSection = `
        <div id="match-player" style="text-align: center; margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%); border-radius: 15px; box-shadow: 0 6px 12px rgba(0,0,0,0.15);">
          <div class="player-container">
            <h3 style="color: #fff; margin-bottom: 15px; font-size: clamp(18px, 4vw, 20px); text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">⏰ سيتم إضافة بث المباراة قبل موعد المباراة</h3>
          </div>
        </div>`;
    }
    
    const content = `
      <style>
        @media (max-width: 768px) {
          .match-teams {
            flex-direction: column !important;
            gap: 20px;
          }
          .team img {
            width: 80px !important;
            height: 80px !important;
          }
          .match-time {
            margin: 0 !important;
            order: -1;
          }
        }
        @media (max-width: 480px) {
          .team img {
            width: 60px !important;
            height: 60px !important;
          }
        }
        .external-link, .original-link {
          display: none !important;
        }
      </style>
      
      <div class="match-details" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: center; width: 100%; padding: 15px; background: #ffffff; box-sizing: border-box;">
        <h2 style="color: #1976d2; margin-bottom: 25px; font-size: clamp(24px, 6vw, 32px); font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.1); background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">🏆 ${match.league}</h2>
        
        <div class="teams match-teams" style="display: flex; align-items: center; justify-content: space-between; margin: 25px 0; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 20px; box-shadow: 0 6px 15px rgba(0,0,0,0.08); border: 1px solid #dee2e6; flex-wrap: wrap;">
          <div class="team home" style="text-align: center; flex: 1; min-width: 150px;">
            ${match.homeTeamLogo ? `<img src="${match.homeTeamLogo}" alt="${match.homeTeam}" style="width: clamp(80px, 15vw, 120px); height: clamp(80px, 15vw, 120px); object-fit: contain; margin-bottom: 15px; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 3px solid #fff; background: #fff;">` : ''}
            <h3 style="margin: 0; color: #2c3e50; font-size: clamp(16px, 4vw, 22px); font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.05); word-wrap: break-word;">${match.homeTeam}</h3>
          </div>
          
          <div class="match-time" style="text-align: center; flex: 0 0 auto; margin: 0 20px; padding: 20px; background: linear-gradient(135deg, #fff 0%, #f8f9fa 100%); border-radius: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 2px solid #1976d2; min-width: 150px;">
            <p style="font-size: clamp(28px, 8vw, 36px); font-weight: bold; color: #1976d2; margin: 8px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">⏰ ${match.time}</p>
            <p style="font-size: clamp(16px, 4vw, 20px); color: #666; margin: 8px 0; font-weight: 600; background: #e3f2fd; padding: 8px 15px; border-radius: 20px;">اليوم</p>
          </div>
          
          <div class="team away" style="text-align: center; flex: 1; min-width: 150px;">
            ${match.awayTeamLogo ? `<img src="${match.awayTeamLogo}" alt="${match.awayTeam}" style="width: clamp(80px, 15vw, 120px); height: clamp(80px, 15vw, 120px); object-fit: contain; margin-bottom: 15px; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 3px solid #fff; background: #fff;">` : ''}
            <h3 style="margin: 0; color: #2c3e50; font-size: clamp(16px, 4vw, 22px); font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.05); word-wrap: break-word;">${match.awayTeam}</h3>
          </div>
        </div>
        
        <div class="match-info" style="margin: clamp(15px, 4vw, 25px) 0; padding: clamp(15px, 4vw, 25px); background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: clamp(12px, 3vw, 18px); box-shadow: 0 clamp(4px, 1.5vw, 8px) clamp(10px, 3vw, 20px) rgba(102, 126, 234, 0.3); position: relative; overflow: hidden;">
          <div style="position: absolute; top: -50%; right: -50%; width: 100%; height: 100%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); pointer-events: none;"></div>
          <div style="position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: clamp(8px, 2vw, 12px); flex-wrap: wrap;">
            <div style="background: rgba(255,255,255,0.15); padding: clamp(8px, 2vw, 12px); border-radius: 50%; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2);">
              <span style="font-size: clamp(20px, 5vw, 28px); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">📺</span>
            </div>
            <p style="margin: 0; font-size: clamp(14px, 3.5vw, 18px); font-weight: 600; text-shadow: 0 2px 4px rgba(0,0,0,0.4); text-align: center; line-height: 1.4; letter-spacing: 0.5px;">
              <span style="display: block; font-size: clamp(12px, 3vw, 14px); opacity: 0.9; margin-bottom: 2px;">القناة الناقلة</span>
              <span style="font-size: clamp(16px, 4vw, 20px); font-weight: 700;">${match.broadcaster}</span>
            </p>
          </div>
          <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7), rgba(255,255,255,0.3));"></div>
        </div>
        
        ${playerSection}
        
        <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-radius: 15px; border-left: 6px solid #4caf50; box-shadow: 0 4px 10px rgba(76, 175, 80, 0.2);">
          <p style="margin: 0; color: #2e7d32; font-size: clamp(14px, 4vw, 18px); font-weight: 600; text-shadow: 1px 1px 2px rgba(0,0,0,0.05);">💡 استمتع بمشاهدة المباراة بجودة عالية ومجاناً على موقعنا</p>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px; border-top: 3px solid #17a2b8;">
          <p style="margin: 0; color: #6c757d; font-size: clamp(12px, 3vw, 14px); font-style: italic;">تابعونا للحصول على أحدث مباريات كرة القدم وأهم الأحداث الرياضية</p>
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
          const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`;
          const postData = {
            kind: 'blogger#post',
            blog: { id: BLOG_ID },
            title: `${match.homeTeam} vs ${match.awayTeam} - ${match.league}`,
            content: content
          };
          
          const retryResponse = await makeAuthenticatedRequest(url, postData, 'POST');
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
    console.log('🚀 Starting to create match posts with filtering...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('✅ All required environment variables found');
    console.log(`📝 Blog ID: ${BLOG_ID}`);
    
    const todayMatches = await fetchMatches('today');
    
    console.log(`\n📊 Match Summary:`);
    console.log(`   Today: ${todayMatches.length} matches`);
    
    const filteredTodayMatches = filterTodayMatches(todayMatches);
    console.log(`\n🔍 After filtering - Today's current/future matches: ${filteredTodayMatches.length}`);
    
    if (filteredTodayMatches.length === 0) {
      console.log('ℹ️  No current or future matches found for today');
      return;
    }
    
    let createdCount = 0;
    let skippedCount = 0;
    let existingCount = 0;
    
    console.log('\n⚽ Processing today\'s current and future matches...');
    for (const match of filteredTodayMatches) {
      console.log(`\n⚽ Processing: ${match.homeTeam} vs ${match.awayTeam} at ${match.time}`);
      const post = await createPost(match);
      
      if (post && post.skipped) {
        skippedCount++;
      } else if (post && post.existing) {
        existingCount++;
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
    
    console.log(`\n🎉 Processing Complete!`);
    console.log(`   ✅ Created ${createdCount} new match posts`);
    console.log(`   📋 Registered ${existingCount} existing posts`);
    console.log(`   ⏸️  Skipped ${skippedCount} due to rate limits`);
    console.log(`   📊 Total processed: ${createdCount + existingCount + skippedCount}`);
    console.log(`   📝 All current/future posts are now tracked in match-urls.json`);
    
  } catch (error) {
    console.error('❌ Error in createMatchPosts:', error);
    process.exit(1);
  }
}

createMatchPosts();
