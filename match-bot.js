const axios = require('axios');
const cheerio = require('cheerio');

const BLOG_ID = process.env.BLOG_ID;
const API_KEY = process.env.BLOGGER_API_KEY;

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
          date: day
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
    
    const content = `
      <div class="match-details">
        <h2>${match.league}</h2>
        <div class="teams">
          <div class="team home">
            <img src="${match.homeTeamLogo}" alt="${match.homeTeam}">
            <h3>${match.homeTeam}</h3>
          </div>
          <div class="match-time">
            <p>${match.time}</p>
            <p>${match.date === 'today' ? 'اليوم' : match.date === 'tomorrow' ? 'غداً' : 'أمس'}</p>
          </div>
          <div class="team away">
            <img src="${match.awayTeamLogo}" alt="${match.awayTeam}">
            <h3>${match.awayTeam}</h3>
          </div>
        </div>
        <div class="match-info">
          <p>📺 ${match.broadcaster}</p>
        </div>
        <div id="match-player">
          <div class="player-container">
            <p>سيتم إضافة بث المباراة قبل موعد المباراة</p>
          </div>
        </div>
      </div>
    `;
    
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?key=${API_KEY}`;
    
    const response = await axios.post(url, {
      kind: 'blogger#post',
      blog: { id: BLOG_ID },
      title: title,
      content: content,
      url: `https://badertalks.blogspot.com/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${slug}.html`
    });
    
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
    
    console.log('Fetching today\'s matches...');
    const todayMatches = await fetchMatches('today');
    
    console.log('Fetching tomorrow\'s matches...');
    const tomorrowMatches = await fetchMatches('tomorrow');
    
    const allMatches = [...todayMatches, ...tomorrowMatches];
    
    console.log(`Found ${todayMatches.length} matches for today and ${tomorrowMatches.length} matches for tomorrow (${allMatches.length} total)`);
    
    let createdCount = 0;
    for (const match of allMatches) {
      const post = await createPost(match);
      if (post) {
        createdCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`Finished creating match posts. Created ${createdCount} new posts.`);
  } catch (error) {
    console.error('Error in createMatchPosts:', error);
  }
}

createMatchPosts();
