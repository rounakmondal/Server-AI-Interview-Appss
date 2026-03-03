import fetch from 'node-fetch';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Search YouTube for videos matching a query.
 * @param {string} query - Search keywords
 * @param {number} maxResults - Number of videos to return
 * @returns {Promise<Array<{title: string, url: string, reason: string}>>}
 */
export async function searchYouTubeVideos(query, maxResults = 3) {
    if (!YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY missing');
    const params = new URLSearchParams({
        key: YOUTUBE_API_KEY,
        q: query,
        part: 'snippet',
        maxResults: maxResults.toString(),
        type: 'video'
    });
    const url = `${YOUTUBE_SEARCH_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('YouTube API error');
    const data = await res.json();
    return (data.items || []).map(item => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        reason: `Recommended for: ${query}`
    }));
}
