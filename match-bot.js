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
        
        // Get match URL for the live stream
        const matchUrl = $(element).find('a').attr('href') || '';
        
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
    // Generate post title similar to the example
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
    
    // Get the current date for the post
    const now = new Date();
    const dateString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    
    // Generate an engaging title for the post
    const postTitle = `${match.homeTeam} Faces ${match.awayTeam} in Thrilling ${match.league} Match Tonight`;
    
    // Create an engaging introduction paragraph
    const introText = `On ${dateString}, football fans are gearing up for an electrifying showdown as ${match.homeTeam} takes on ${match.awayTeam} in the ${match.league}. Kicking off at ${match.time}, this high-stakes match promises to be a tactical battle between two formidable sides.`;
    
    // Create a second paragraph about the teams
    const teamsText = `${match.homeTeam} enters the match with determination, looking to secure a vital victory. Meanwhile, ${match.awayTeam} will aim to counter with their own strengths. With broadcasting available on ${match.broadcaster}, fans won't want to miss this exciting clash.`;
    
    // Generate a combined team logo image URL (can be customized further)
    const combinedImageUrl = `https://i.ibb.co/SvKz0KD/vs-template.png`;
    
    // Create the HTML content with your preferred format
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
        <b style="background-color: white;"><iframe allowfullscreen="" frameborder="0" height="400" src="https://live4all.net/frame.php?ch=bein3" width="100%"></iframe></b>
      </span>
    </p>
    
    <p style="text-align: center;">
      <span face="Roboto, -apple-system, Apple Color Emoji, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen-Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif" style="font-size: 16px; white-space-collapse: preserve;">
        <b style="background-color: white;">Don't miss this exciting matchup between ${match.homeTeam} and ${match.awayTeam}. Which team do you think will come out on top? Share your predictions in the comments below!</b>
      </span>
    </p>
    `;
    
    // Important: Use API Key authentication with the correct URL
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`;
    
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
    
    // Fetch both today's and tomorrow's matches
    console.log('Fetching today\'s matches...');
    const todayMatches = await fetchMatches('today');
    
    console.log('Fetching tomorrow\'s matches...');
    const tomorrowMatches = await fetchMatches('tomorrow');
    
    // Combine all matches
    const allMatches = [...todayMatches, ...tomorrowMatches];
    
    console.log(`Found ${todayMatches.length} matches for today and ${tomorrowMatches.length} matches for tomorrow (${allMatches.length} total)`);
    
    // Create posts for all matches
    let createdCount = 0;
    for (const match of allMatches) {
      const post = await createPost(match);
      if (post) {
        createdCount++;
      }
      // Add a small delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`Finished creating match posts. Created ${createdCount} new posts.`);
  } catch (error) {
    console.error('Error in createMatchPosts:', error);
  }
}

// Start the process
createMatchPosts();
