export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY

    // Fetch football news from multiple sources in parallel
    const [sportsNews, transferNews] = await Promise.all([

      // General football news
      fetch('https://sport-news-live.p.rapidapi.com/news/football', {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'sport-news-live.p.rapidapi.com',
        }
      }).then(r => r.json()).catch(() => ({ articles: [] })),

      // Transfer and injury news
      fetch('https://sport-news-live.p.rapidapi.com/news/football/transfers', {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'sport-news-live.p.rapidapi.com',
        }
      }).then(r => r.json()).catch(() => ({ articles: [] })),
    ])

    // Combine and format news
    const allNews = []

    const processArticles = (data, category) => {
      const articles = data?.articles || data?.data || data?.results || []
      if (Array.isArray(articles)) {
        articles.slice(0, 20).forEach(article => {
          allNews.push({
            title: article.title || article.headline || '',
            summary: article.description || article.summary || article.excerpt || '',
            source: article.source?.name || article.source || category,
            publishedAt: article.publishedAt || article.date || '',
            category,
          })
        })
      }
    }

    processArticles(sportsNews, 'Football News')
    processArticles(transferNews, 'Transfers & Injuries')

    // Sort by date
    allNews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

    return new Response(JSON.stringify({
      news: allNews.slice(0, 30),
      total: allNews.length,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, news: [] }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}

export const config = {
  path: '/api/news'
}
