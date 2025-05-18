const axios = require('axios');
const cheerio = require('cheerio');
const { google } = require('googleapis');

const BLOG_ID = process.env.BLOG_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const MATCH_SOURCES = {
  yesterday: 'https://www.kooraliive.com/matches-yesterday/',
  today: 'https://www.kooraliive.com/matches-today/',
  tomorrow: 'https://www.kooraliive.com/matches-tomorrow/'
};
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const DEFAULT_STREAM_URL = 'https://live4all.net/frame.php?ch=bein3';
const REQUEST_DELAY = 2000;
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 1.5;

async function getOAuth2Client() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing environment variables for OAuth');
  }
  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  await oauth2Client.getAccessToken();
  return oauth2Client;
}

async function getBloggerClient() {
  const oauth2Client = await getOAuth2Client();
  return google.blogger({ version: 'v3', auth: oauth2Client });
}

async function fetchMatches(day = 'today') {
  if (!MATCH_SOURCES[day]) return [];
  const url = MATCH_SOURCES[day];
  const response = await axios.get(CORS_PROXY + encodeURIComponent(url), {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });
  const html = response.data;
  const $ = cheerio.load(html);
  const matches = [];
  $('.AY_Match').each((index, element) => {
    const homeTeam = $(element).find('.TM1 .TM_Name').text().trim();
    const awayTeam = $(element).find('.TM2 .TM_Name').text().trim();
    if (!homeTeam || !awayTeam) return;
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
    matches.push({
      id: `${day}-${index}`,
      homeTeam,
      awayTeam,
      homeTeamLogo: homeTeamLogo || '',
      awayTeamLogo: awayTeamLogo || '',
      time: time || 'TBD',
      league: league || 'Football Match',
      broadcaster: broadcaster || 'TBD',
      date: day,
      matchUrl
    });
  });
  return matches;
}

async function checkPostExists(title, bloggerClient) {
  if (!BLOG_ID) throw new Error('BLOG_ID not set');
  const response = await bloggerClient.posts.search({
    blogId: BLOG_ID,
    q: title
  });
  return response.data.items && response.data.items.length > 0;
}

async function createPostWithRetry(match, bloggerClient, maxRetries = MAX_RETRIES) {
  let delay = REQUEST_DELAY;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await createPost(match, bloggerClient);
    } catch (error) {
      const rateLimit = error.response && (error.response.status === 429 || error.response.status === 403);
      if (attempt === maxRetries) return null;
      if (rateLimit) delay *= BACKOFF_MULTIPLIER;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

async function createPost(match, bloggerClient) {
  if (!BLOG_ID) throw new Error('BLOG_ID not set');
  const title = `${match.homeTeam} vs ${match.awayTeam} - ${match.league}`;
  const exists = await checkPostExists(title, bloggerClient);
  if (exists) return null;
  const slugify = text => text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  const slug = `${slugify(match.homeTeam)}-vs-${slugify(match.awayTeam)}`;
  const now = new Date();
  const dateString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const postTitle = `${match.homeTeam} Faces ${match.awayTeam} in ${match.league} - ${dateString}`;
  const content = `
    <h2>${match.homeTeam} vs ${match.awayTeam}</h2>
    <p><strong>Time:</strong> ${match.time}</p>
    <p><strong>League:</strong> ${match.league}</p>
    <p><strong>Broadcasted on:</strong> ${match.broadcaster}</p>
    <p><a href="${match.matchUrl || DEFAULT_STREAM_URL}" target="_blank">Watch Live</a></p>
    <img src="${match.homeTeamLogo}" alt="${match.homeTeam}" width="100"/>
    <span>vs</span>
    <img src="${match.awayTeamLogo}" alt="${match.awayTeam}" width="100"/>
  `;
  return await bloggerClient.posts.insert({
    blogId: BLOG_ID,
    requestBody: {
      title: postTitle,
      content,
      labels: [match.league, match.date],
      url: `/${slug}`
    }
  });
}
