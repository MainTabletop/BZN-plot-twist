import { NextApiRequest, NextApiResponse } from 'next';

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

    // In a real implementation, this would call an AI service (OpenAI, etc.)
    // For now, we'll create a simple script based on the descriptions
    
    const script = generateMockScript(descriptions, players, settings);
    
    return res.status(200).json({ script });
  } catch (error) {
    console.error('Error generating script:', error);
    return res.status(500).json({ error: 'Failed to generate script' });
  }
}

function generateMockScript(
  descriptions: PlayerDescription[],
  players: { id: string; name: string }[],
  settings: GameSettings
): string {
  // Get player names by their IDs
  const getPlayerName = (id: string) => {
    const player = players.find(p => p.id === id);
    return player ? player.name : 'Unknown Player';
  };

  // Map descriptions with character names
  const characters = descriptions.map(desc => {
    const describer = getPlayerName(desc.playerId);
    const character = getPlayerName(desc.assignedPlayerId);
    
    return {
      character,
      description: desc.description,
      describer
    };
  });

  // Create an intro based on the settings
  let script = `Setting: A ${settings.scene}\nTone: ${settings.tone}\n\n`;
  script += `NARRATOR: It was a ${settings.tone === 'Dramatic' ? 'stormy' : settings.tone === 'Funny' ? 'ridiculous' : 'typical'} day at the ${settings.scene}...\n\n`;

  // Add character introductions
  characters.forEach(({ character, description }) => {
    script += `[Enter ${character}]\n\n`;
    script += `NARRATOR: ${character} walks in. ${description.substring(0, 100)}...\n\n`;
  });

  // Create some dialogue between characters
  for (let i = 0; i < characters.length; i++) {
    const current = characters[i];
    const next = characters[(i + 1) % characters.length];
    
    script += `${current.character}: Hey ${next.character}, how's it going?\n\n`;
    script += `${next.character}: Oh, you know, just ${settings.tone === 'Dramatic' ? 'dealing with my inner demons' : settings.tone === 'Funny' ? 'trying not to spill my coffee again' : 'hanging out'}.\n\n`;
  }

  // Create a conclusion
  script += `NARRATOR: And so, our characters continued their adventure at the ${settings.scene}, each with their own story to tell...\n\n`;
  script += `[THE END]`;

  return script;
} 