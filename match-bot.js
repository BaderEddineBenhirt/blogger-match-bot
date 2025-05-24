const axios = require('axios');
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
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    let iframe = null;
    
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
    
    console.log(`✅ Post created: ${response.data.url}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error creating post:', error);
    if (error.response) {
      console.error('Error details:', error.response.data);
    }
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
    for (const match of matches) {
      console.log(`\n⚽ Processing: ${match.homeTeam} vs ${match.awayTeam}`);
      const post = await createPost(match);
      if (post) {
        createdCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log(`\n🎉 Finished! Created ${createdCount} new posts.`);
  } catch (error) {
    console.error('❌ Error in createMatchPosts:', error);
    process.exit(1);
  }
}

createMatchPosts();
