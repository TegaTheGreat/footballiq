import { GoogleGenerativeAI } from "@google/generative-ai";

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const ODDS_API_KEY = process.env.ODDS_API_KEY;
    const APISPORTS_KEY = process.env.APISPORTS_KEY;

    const bodyText = await req.text();
    const body = JSON.parse(bodyText);
    const { messages, question } = body;
    const userPrompt = question || 'Give me the best bets this weekend';

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // ============================================
    // STEP 1 & 2: FETCH ODDS AND STANDINGS
    // ============================================
    // (Keep your exact existing code for fetching ODDS_API and APISPORTS_KEY here)
    // For brevity, let's assume fixturesContext and standingsContext are generated here exactly as before.
    let fixturesContext = "..."; // (Your existing odds code)
    let standingsContext = "..."; // (Your existing standings code)


    // ============================================
    // STEP 3: AGENT 1 - GEMINI (THE SCOUT)
    // ============================================
    // We ask Gemini to search the web specifically for the matches the user is asking about.
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} }], 
    });

    const scoutPrompt = `Search the live internet for current match facts, injuries, team news, and recent results related to this query: "${userPrompt}". Date today is ${today}. Return a concise bulleted list of raw facts.`;
    
    let geminiResearch = "";
    try {
      const geminiResult = await geminiModel.generateContent(scoutPrompt);
      geminiResearch = geminiResult.response.text();
    } catch (e) {
      console.log('Gemini Search Error:', e.message);
      geminiResearch = "No live web data could be retrieved at this moment.";
    }

    // ============================================
    // STEP 4: AGENT 2 - CLAUDE (THE QUANT)
    // ============================================
    const systemPrompt = `You are FootballIQ, an elite football analyst and betting advisor for the 2025/26 season. You are warm, intelligent and conversational.

TODAY: ${today}

=== LIVE WEB RESEARCH (Gathered by your Scout) ===
${geminiResearch}

=== LIVE FIXTURES & ODDS ===
${fixturesContext}

=== CURRENT STANDINGS ===
${standingsContext}

HOW YOU COMMUNICATE:
- Act as the elite Quant. Use Expected Value (EV) logic.
- You now have live web data from your scout. Incorporate this context (injuries, Leg 1 scores) heavily into your math.
- NEVER say you cannot access live data. 
- Format predictions using your standard HTML table format.`;

    const allMessages = [
      ...messages, // Keep conversation history
      { role: 'user', content: userPrompt }
    ];

    // Call Claude to do the final reasoning and stream it to the user
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Or claude-3-5-sonnet if you want higher intelligence
        max_tokens: 8000,
        stream: true,
        system: systemPrompt,
        messages: allMessages,
      }),
    });

    // ============================================
    // STEP 5: STREAM CLAUDE'S RESPONSE TO CLIENT
    // ============================================
    // (Keep your exact existing TransformStream code here that handles Claude's SSE streaming format)
    
    // ... [Stream processing code remains exactly the same as your original snippet] ...
