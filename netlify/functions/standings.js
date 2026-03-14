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

    const leagueIds = [
      39,   // Premier League
      40,   // Championship
      61,   // Ligue 1
      78,   // Bundesliga
      135,  // Serie A
      140,  // La Liga
      94,   // Primeira Liga
      88,   // Eredivisie
      144,  // Pro League Belgium
      307,  // Saudi Pro League
    ]

    const season = 2024

    // Fetch standings and recent results in parallel
    const [standingResults, recentResults] = await Promise.all([

      // Standings for each league
      Pro
