import { NextApiRequest, NextApiResponse } from 'next';
import { OpenAI } from 'openai';
import { sanitizePrompt } from '../../lib/prompt';

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

/**
 * Cleans script content by removing markdown artifacts
 */
function cleanScript(script: string): string {
  return script
    // Remove markdown code block markers
    .replace(/```(?:plaintext|markdown|)/g, '')
    // Remove trailing backticks at the end of script
    .replace(/```\s*$/g, '')
    // Clean up any double newlines that might have been created
    .replace(/\n{3,}/g, '\n\n')
    // Trim any whitespace at start and end
    .trim();
}

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
      return player ? sanitizePrompt(player.name) : 'Unknown Player';
    };

    // Create character list for the prompt
    const charactersList = descriptions.map(desc => {
      const character = getPlayerName(desc.assignedPlayerId);
      return `• ${character} – ${sanitizePrompt(desc.description)}`;
    }).join('\n');

    // Map length setting to token limits
    const tokenMap = { 
      short: 900, 
      medium: 2200, 
      long: 3600 
    };
    
    // Get max tokens based on length setting (default to medium if invalid)
    const maxTokens = tokenMap[settings.length.toLowerCase() as keyof typeof tokenMap] || tokenMap.medium;

    // Create structured prompt
    const system = `You are an award‑winning screenwriter. Write a tight, highly readable screenplay that works as a live table‑read for 4–10 friends. Can be Rated R. Use every character provided in depth. Make sure to use their descriptions as much as you can, while making it seem natrually the way you bring in the details from the descriptions.`;
    
    const user = `
# PlotTwist Scene
• Setting : ${sanitizePrompt(settings.scene)}
• Tone    : ${sanitizePrompt(settings.tone)}
• Target  : ${sanitizePrompt(settings.length)}        // short (900 tokens) | medium (2200 tokens) | long (3600 tokens)
• Dialogue: Each character must speak at least three times.
• Ending  : Finish on a cliff‑hanger.

## Characters
${charactersList}

## Rules
1. Include every trait from descriptions, but try to be as natural as possible.
2. Spotlight the most creative description.
3. Use standard screenplay format (CHARACTER, dialogue, brief stage directions).
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const rawScript = response.choices[0].message.content || '';
    const cleanedScript = cleanScript(rawScript);
    
    // Generate consistent title based on game settings
    const scriptTitle = `A ${settings.tone} Adventure at the ${settings.scene}`;
    
    // Add the title directly to the script at the beginning
    const script = `[TITLE: "${scriptTitle}"]\n\n${cleanedScript}`;
    
    return res.status(200).json({ script });
  } catch (error) {
    console.error('Error generating script:', error);
    return res.status(500).json({ error: 'Failed to generate script' });
  }
} 
