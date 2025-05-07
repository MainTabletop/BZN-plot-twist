import { NextApiRequest, NextApiResponse } from 'next';
import { OpenAI } from 'openai';

type PlayerDescription = { 
  playerId: string; 
  assignedPlayerId: string; 
  description: string;
};

type GameSettings = {
  tone: 'Serious' | 'Funny' | 'Dramatic';
  scene: 'Coffee Shop' | 'Party' | 'Classroom';
  length: 'Short' | 'Medium' | 'Long';
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { descriptions, players, settings } = req.body as {
      descriptions: PlayerDescription[];
      players: { id: string; name: string }[];
      settings: GameSettings;
    };

    if (!descriptions || !Array.isArray(descriptions) || descriptions.length < 2) {
      return res.status(400).json({ error: 'At least 2 character descriptions are required' });
    }

    if (!players || !Array.isArray(players)) {
      return res.status(400).json({ error: 'Players information is required' });
    }

    if (!settings) {
      return res.status(400).json({ error: 'Game settings are required' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Map descriptions with character names
    const getPlayerName = (id: string) => {
      const player = players.find(p => p.id === id);
      return player ? player.name : 'Unknown Player';
    };

    // Create character list for the prompt
    const charactersList = descriptions.map(desc => {
      const character = getPlayerName(desc.assignedPlayerId);
      return `• ${character} – ${desc.description}`;
    }).join('\n');

    const systemMessage = `You are an award‑winning screenwriter. Write tight, highly readable screenplays that work as live table‑reads for 4–10 friends. Can be Rated R. Use every character provided in depth. Make sure to use their descriptions as much as you can.`;

    const userMessage = `# PlotTwist Scene Request
Setting: ${settings.scene} (slugline: INT/EXT as fits)
Tone: ${settings.tone}
Target length: ${settings.length}
--- Characters ---
${charactersList}
--- Rules ---
1. Every character must speak at least twice.
2. Use screenplay format (CHARACTER, parentheticals, etc.).
3. Finish on a cliff hanger.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: 900,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage }
      ]
    });

    const script = response.choices[0].message.content || '';
    
    return res.status(200).json({ script });
  } catch (error) {
    console.error('Error generating script:', error);
    return res.status(500).json({ error: 'Failed to generate script' });
  }
} 