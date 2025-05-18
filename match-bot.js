const axios = require('axios');
const cheerio = require('cheerio');

const CONFIG = {
  blogId: process.env.BLOG_ID,
  apiKey: process.env.BLOGGER_API_KEY,
  
  matchSources: {
    yesterday: 'https://www.kooraliive.com/matches-yesterday/',
    today: 'https://www.kooraliive.com/matches-today/',
    tomorrow: 'https://www.kooraliive.com/matches-tomorrow/'
  },
  
  corsProxy: 'https://api.allorigins.win/raw?url=',
  
  defaultStreamUrl: 'https://live4all.net/frame.php?ch=bein3',
  
  requestDelay: 2000,
  
  maxRetries: 3,
  
  backoffMultiplier: 1.5
};

async function fetchMatches(day = 'today') {
  try {
    if (!CONFIG.matchSources[day]) {
      console.error(`Invalid day parameter: ${day}`);
      return [];
    }
    
    const url = CONFIG.matchSources[day];
    console.log(`Fetching matches for ${day} from ${url}`);
    
    const response = await axios.get(CONFIG.corsProxy + encodeURIComponent(url), {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.data) {
      console.error(`No data returned from ${url}`);
      return [];
    }
    
    const html = response.data;
    const $ = cheerio.load(html);
    const matches = [];
    
    $('.AY_Match').each((index, element) => {
      try {
        const homeTeam = $(element).find('.TM1 .TM_Name').text().trim();
        const awayTeam = $(element).find('.TM2 .TM_Name').text().trim();
        
        if (!homeTeam || !awayTeam) {
          console.log(`Skipping match #${index} - missing team data`);
          return;
        }
        
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
        
        const matchUrl = $(element).find('a').attr('href') || '';
        
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
          matchUrl: matchUrl
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
    const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${CONFIG.blogId}/posts/search?q=${encodeURIComponent(title)}&key=${CONFIG.apiKey}`;
    const response = await axios.get(searchUrl);
    
    if (response.data.items && response.data.items.length > 0) {
      console.log(`Post with similar title already exists: ${title}`);
      return true;
    }
    
    return false;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return false;
    }
    
    console.error('Error checking if post exists:', error);
    return false; 
  }
}

async function createPostWithRetry(match, maxRetries = CONFIG.maxRetries) {
  let delay = CONFIG.requestDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await createPost(match);
    } catch (error) {
      const isRateLimited = error.response && (error.response.status === 429 || error.response.status === 403);
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        console.error(`Failed to create post after ${maxRetries} attempts:`, error.message);
        return null;
      }
      
      if (isRateLimited) {
        delay *= CONFIG.backoffMultiplier;
        console.log(`Rate limiting detected. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})`);
      } else {
        console.log(`Error creating post. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
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
    
    const now = new Date();
    const dateString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    
    const postTitle = `${match.homeTeam} Faces ${match.awayTeam} in Thrilling ${match.league} Match Tonight`;
    
    const introText = `On ${dateString}, football fans are gearing up for an electrifying showdown as ${match.homeTeam} takes on ${match.awayTeam} in the ${match.league}. Kicking off at ${match.time}, this high-stakes match promises to be a tactical battle between two formidable sides.`;
    
    const teamsText = `${match.homeTeam} enters the match with determination, looking to secure a vital victory. Meanwhile, ${match.awayTeam} will aim to counter with their own strengths. With broadcasting available on ${match.broadcaster}, fans won't want to miss this exciting clash.`;
    
    const content = `
    <p>&nbsp;<b style="background-color: white; font-size: 16px; text-align: center; white-space-collapse: preserve;">${postTitle}</b></p>
    <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="background-color: #e3fee0; font-size: 16px; white-space-collapse: preserve;">
      <b>
        <div style="text-align: center;">${introText}</div>
        <div style="text-align: center;">${teamsText}</div>
      </b>
    </span>
    <p></p>
    <p style="text-align: center;">
      <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="background-color: #e3fee0; font-size: 16px; white-space-collapse: preserve;">
        <b><br /></b>
      </span>
    </p>
    
    <div class="separator" style="clear: both; text-align: center;">
      <b>
        <div style="display: flex; justify-content: center; align-items: center; margin: 20px 0;">
          <div style="text-align: center; margin: 0 20px;">
            <img src="${match.homeTeamLogo}" alt="${match.homeTeam}" width="100" height="100" />
            <p>${match.homeTeam}</p>
          </div>
          <div style="font-size: 24px; font-weight: bold; margin: 0 15px;">VS</div>
          <div style="text-align: center; margin: 0 20px;">
            <img src="${match.awayTeamLogo}" alt="${match.awayTeam}" width="100" height="100" />
            <p>${match.awayTeam}</p>
          </div>
        </div>
      </b>
    </div>
    
    <b style="background-color: white;"><br /><br /></b>
    
    <p style="text-align: center;">
      <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="font-size: 16px; white-space-collapse: preserve;">
        <b style="background-color: white;">Match Time: ${match.time} | Competition: ${match.league} | Broadcaster: ${match.broadcaster}</b>
      </span>
    </p>
    
    <p style="text-align: center;">
      <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="font-size: 16px; white-space-collapse: preserve;">
        <b style="background-color: white;"><iframe allowfullscreen="" frameborder="0" height="400" src="${CONFIG.defaultStreamUrl}" width="100%"></iframe></b>
      </span>
    </p>
    
    <p style="text-align: center;">
      <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="font-size: 16px; white-space-collapse: preserve;">
        <b style="background-color: white;">Don't miss this exciting matchup between ${match.homeTeam} and ${match.awayTeam}. Which team do you think will come out on top? Share your predictions in the comments below!</b>
      </span>
    </p>
    `;
    
    const url = `https://www.googleapis.com/blogger/v3/blogs/${CONFIG.blogId}/posts?key=${CONFIG.apiKey}`;
    
    const response = await axios.post(url, {
      kind: 'blogger#post',
      blog: { id: CONFIG.blogId },
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
    throw error; 
  }
}

async function createMatchPosts() {
  try {
    console.log('Starting to create match posts...');
    
    if (!CONFIG.blogId || !CONFIG.apiKey) {
      console.error('Missing required environment variables. Please set BLOG_ID and API_KEY.');
      return 0;
    }
    
    console.log('Fetching today\'s matches...');
    const todayMatches = await fetchMatches('today');
    
    console.log('Fetching tomorrow\'s matches...');
    const tomorrowMatches = await fetchMatches('tomorrow');
    
    const allMatches = [...todayMatches, ...tomorrowMatches];
    
    console.log(`Found ${todayMatches.length} matches for today and ${tomorrowMatches.length} matches for tomorrow (${allMatches.length} total)`);
    
    let createdCount = 0;
    for (const match of allMatches) {
      const post = await createPostWithRetry(match);
      if (post) {
        createdCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
    }
    
    console.log(`Finished creating match posts. Created ${createdCount} new posts.`);
    return createdCount;
  } catch (error) {
    console.error('Error in createMatchPosts:', error);
    return 0;
  }
}

createMatchPosts().catch(error => {
  console.error('Error in main process:', error);
  process.exit(1);
});
