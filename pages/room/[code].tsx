import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { supa } from "../../lib/supa";

type Player = { id: string; name: string; joinedAt: number; status: 'ready' | 'writing' };
type GameSettings = {
  tone: 'Serious' | 'Funny' | 'Dramatic';
  scene: 'Coffee Shop' | 'Party' | 'Classroom';
  length: 'Short' | 'Medium' | 'Long';
};
type GamePhase = 'lobby' | 'description' | 'reading' | 'guessing' | 'results';
type PlayerAssignment = { playerId: string; assignedPlayerId: string };
type PlayerDescription = { 
  playerId: string; 
  assignedPlayerId: string; 
  description: string;
};

export default function Room() {
  const router = useRouter();
  const { code: slug } = router.query;
  const [players, setPlayers] = useState<Player[]>([]);
  const [username, setUsername] = useState("");
  const [tempUsername, setTempUsername] = useState("");
  const [copied, setCopied] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [playerId] = useState(() => crypto.randomUUID());
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [playerAssignments, setPlayerAssignments] = useState<PlayerAssignment[]>([]);
  const [assignedPlayer, setAssignedPlayer] = useState<Player | null>(null);
  const [description, setDescription] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [descriptions, setDescriptions] = useState<PlayerDescription[]>([]);
  const [submittedPlayerIds, setSubmittedPlayerIds] = useState<string[]>([]);
  const [gameSettings, setGameSettings] = useState<GameSettings>({
    tone: 'Funny',
    scene: 'Party',
    length: 'Short'
  });
  const [generatedScript, setGeneratedScript] = useState<string>("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [playerGuesses, setPlayerGuesses] = useState<Record<string, string>>({});
  const [submittedGuesses, setSubmittedGuesses] = useState(false);
  const [allGuessResults, setAllGuessResults] = useState<Record<string, {correctGuesses: number, totalGuesses: number}>>({});
  const [originalHostId, setOriginalHostId] = useState<string | null>(null);
  
  // Track if host has been explicitly set in this session
  const hostInitializedRef = useRef(false);
  // Add game phase ref to know when we're transitioning between phases
  const lastGamePhaseRef = useRef<GamePhase>('lobby');
  // Add flag to prevent host reassignment during play again
  const preservingHostRef = useRef(false);

  // Add ref for channel to use across functions
  const channelRef = useRef<any>(null);

  // Load username from localStorage after mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedUsername = sessionStorage.getItem(`username_${slug}`);
    if (storedUsername) {
      setUsername(storedUsername);
    }
  }, [slug]);

  // Calculate if all players have submitted
  const allPlayersSubmitted = players.length > 0 && 
    players.every(player => player.status === 'ready' || player.id === hostId);

  // Calculate if current player is host with more explicit logging
  const isHost = playerId === hostId;
  
  // When game phase changes, store the previous phase
  useEffect(() => {
    // Don't run on initial render
    if (lastGamePhaseRef.current !== gamePhase) {
      console.log('DEBUG - Game phase transition:', {
        from: lastGamePhaseRef.current,
        to: gamePhase,
        hostId,
        isHost: hostId === playerId
      });
    }
    lastGamePhaseRef.current = gamePhase;
  }, [gamePhase, hostId, playerId]);

  // Log when host status changes
  useEffect(() => {
    console.log('DEBUG - Host status check:', { 
      playerId, 
      hostId, 
      originalHostId,
      isHost: playerId === hostId,
      playerCount: players.length,
      hostInitialized: hostInitializedRef.current
    });
  }, [hostId, playerId, players.length, originalHostId]);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      sessionStorage.removeItem(`username_${slug}`);
    };
  }, [slug]);

  // Fetch or initialize room state from Supabase
  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;

    const initializeRoomState = async () => {
      try {
        // Try to get existing room state
        const { data: roomState, error } = await supa
          .from('rooms')
          .select('*')
          .eq('room_code', slug)
          .single();
        
        if (error && error.code !== 'PGRST116') {
          console.error('DEBUG - Error fetching room state:', error);
          return;
        }
        
        if (roomState) {
          console.log('DEBUG - Found existing room state:', roomState);
          
          // Set original host ID from database
          setOriginalHostId(roomState.original_host_id);
          setHostId(roomState.current_host_id);
        } else {
          console.log('DEBUG - No existing room state found, will initialize on first player join');
        }
      } catch (err) {
        console.error('DEBUG - Error in room state initialization:', err);
      }
    };
    
    initializeRoomState();
  }, [slug]);

  // Determine if current player should be considered the host
  const determineHost = (players: Player[]): string => {
    if (!players.length) return '';
    
    // 1. If original host is still in the game, they remain host
    if (originalHostId && players.some(p => p.id === originalHostId)) {
      return originalHostId;
    }
    
    // 2. If there's a current host and they're still in the game, they remain host
    if (hostId && players.some(p => p.id === hostId)) {
      return hostId;
    }
    
    // 3. Otherwise, assign the first player by join time
    return players[0].id;
  };

  // Update Supabase channel setup
  useEffect(() => {
    if (!slug || !username || typeof window === 'undefined') return;

    console.log('DEBUG - Channel setup:', { 
      slug, 
      username, 
      playerId, 
      hostId
    });

    // Try to get persisted host information
    let persistedHostId: string | null = null;
    try {
      persistedHostId = sessionStorage.getItem(`host_${slug}`);
      if (persistedHostId) {
        console.log('DEBUG - Found persisted host:', persistedHostId);
      }
    } catch (e) {
      console.error('Failed to read host from session storage', e);
    }

    const channel = supa.channel(`room:${slug}`, {
      config: { 
        presence: { key: playerId },
        broadcast: { self: true }
      },
    });
    
    // Store channel reference for use in other functions
    channelRef.current = channel;

    let retryCount = 0;
    const maxRetries = 3;
    let isSubscribed = false;

    const setupChannel = async () => {
      if (isSubscribed) {
        console.log('DEBUG - Already subscribed, skipping');
        return;
      }
      
      try {
        channel
          .on("presence", { event: "sync" }, () => {
            const state = channel.presenceState<Player>();
            console.log('DEBUG - Presence sync:', { 
              state, 
              playerId, 
              hostId,
              originalHostId,
              hostInitialized: hostInitializedRef.current
            });
            
            const flat = Object.values(state).flat();
            console.log('DEBUG - Flattened players:', flat);
            
            // Remove duplicates by using a Map
            const uniquePlayers = Array.from(
              new Map(flat.map(player => [player.id, player])).values()
            );
            
            // Sort players by join time
            const sortedPlayers = uniquePlayers.sort((a, b) => a.joinedAt - b.joinedAt);
            console.log('DEBUG - Sorted players:', sortedPlayers);
            
            setPlayers(sortedPlayers);
            
            // Only set original host if it's not already set and this is the first player
            if (!originalHostId && sortedPlayers.length === 1 && sortedPlayers[0].id === playerId) {
              const firstPlayerId = sortedPlayers[0].id;
              console.log('DEBUG - Setting original host ID:', firstPlayerId);
              setOriginalHostId(firstPlayerId);
              
              // Broadcast the original host ID to all players
              try {
                channel.send({
                  type: 'broadcast',
                  event: 'original_host_set',
                  payload: { originalHostId: firstPlayerId }
                }).catch(err => console.error('DEBUG - Error broadcasting original host:', err));
              } catch (err) {
                console.error('DEBUG - Error sending original host:', err);
              }
            }
            
            const gameInProgress = isActiveGame(gamePhase);
            const hostIsMissing = !hostId || !sortedPlayers.some(p => p.id === hostId);
            const isLobbyPhase = gamePhase === 'lobby';
            
            // Only allow host changes in lobby or if host is missing, BUT respect the preservingHost flag
            const shouldAssignHost = 
              (!preservingHostRef.current && !hostInitializedRef.current) || // First time initialization, not preserving
              (hostIsMissing && (isLobbyPhase || !isLobbyPhase) && !preservingHostRef.current) || // Host left, not preserving
              (!gameInProgress && !hostId && !preservingHostRef.current); // In lobby with no host, not preserving
            
            // Log host decision factors
            console.log('DEBUG - Host determination factors:', {
              hostInitialized: hostInitializedRef.current,
              hostIsMissing,
              isLobbyPhase,
              shouldAssignHost,
              gameInProgress,
              preservingHost: preservingHostRef.current,
              currentHostId: hostId,
              originalHostId,
              playerId,
              gamePhase
            });
            
            // If we should assign/reassign the host
            if (shouldAssignHost) {
              const newHostId = determineHost(sortedPlayers);
              
              if (newHostId && (newHostId !== hostId || !hostInitializedRef.current)) {
                console.log('DEBUG - Setting host:', { 
                  newHostId,
                  oldHostId: hostId,
                  originalHostId,
                  playerId,
                  gamePhase
                });
                
                setHostId(newHostId);
                hostInitializedRef.current = true;
                
                // Store in session storage as backup
                if (typeof window !== 'undefined') {
                  try {
                    sessionStorage.setItem(`host_${slug}`, newHostId);
                  } catch (e) {
                    console.error('Failed to store host in session storage', e);
                  }
                }
                
                // If the current player becomes the host, broadcast this information
                if (playerId === newHostId) {
                  try {
                    channel.send({
                      type: 'broadcast',
                      event: 'host_update',
                      payload: { 
                        hostId: newHostId,
                        originalHostId,
                        gamePhase
                      }
                    }).catch(err => console.error('DEBUG - Error broadcasting host update:', err));
                  } catch (err) {
                    console.error('DEBUG - Error sending host update:', err);
                  }
                }
              }
            }
            
            // Update assigned player if we have assignments
            if (playerAssignments.length > 0) {
              const myAssignment = playerAssignments.find(a => a.playerId === playerId);
              if (myAssignment) {
                const assigned = sortedPlayers.find(p => p.id === myAssignment.assignedPlayerId);
                if (assigned) {
                  setAssignedPlayer(assigned);
                }
              }
            }
          })
          .on('broadcast', { event: 'remove_player' }, ({ payload }) => {
            console.log('DEBUG - Remove player broadcast:', payload);
            if (payload.playerId === playerId) {
              sessionStorage.removeItem(`username_${slug}`);
              setUsername('');
            }
            
            // Update player list
            setPlayers(prev => {
              const updatedPlayers = prev.filter(p => p.id !== payload.playerId);
              
              // If the removed player was the host, determine a new host
              if (payload.playerId === hostId && updatedPlayers.length > 0) {
                const newHostId = determineHost(updatedPlayers);
                console.log('DEBUG - Host was removed, selecting new host:', newHostId);
                
                setHostId(newHostId);
                
                // If current player is the new host, broadcast it
                if (playerId === newHostId) {
                  try {
                    channel.send({
                      type: 'broadcast',
                      event: 'host_update',
                      payload: { 
                        hostId: newHostId,
                        originalHostId 
                      }
                    }).catch(err => console.error('DEBUG - Error broadcasting host update after removal:', err));
                  } catch (err) {
                    console.error('DEBUG - Error sending host update after removal:', err);
                  }
                }
              }
              
              return updatedPlayers;
            });
          })
          .on('broadcast', { event: 'original_host_set' }, ({ payload }) => {
            console.log('DEBUG - Original host set broadcast:', payload);
            if (payload.originalHostId && !originalHostId) {
              setOriginalHostId(payload.originalHostId);
            }
          })
          .on('broadcast', { event: 'game_phase_change' }, ({ payload }) => {
            console.log('DEBUG - Game phase change:', payload);
            
            // Preserve current host during phase transitions
            const currentHostId = hostId;
            
            // If we're preserving the host (like when returning to lobby), set the flag
            if (payload.preserveHost) {
              console.log('DEBUG - Explicitly preserving host during phase change:', { 
                hostId,
                originalHostId,
                gamePhase: payload.phase
              });
              
              // Set the flag to prevent host reassignment in presence handler
              preservingHostRef.current = true;
              
              // Schedule a reset of the flag after a delay to allow for presence updates
              setTimeout(() => {
                preservingHostRef.current = false;
                console.log('DEBUG - Host preservation period ended');
              }, 5000); // 5 seconds should be enough
            }
            
            // Update game phase
            setGamePhase(payload.phase);
            
            // Ensure host is preserved across phase changes
            if (hostId && hostId !== currentHostId) {
              console.log('DEBUG - Host changed during phase transition, restoring:', {
                was: hostId,
                restoring: currentHostId,
                isHost: currentHostId === playerId
              });
              setHostId(currentHostId);
            }
            
            if (payload.phase === 'description' && payload.assignments) {
              setPlayerAssignments(payload.assignments);
              
              // Find my assignment
              const myAssignment = payload.assignments.find((a: PlayerAssignment) => a.playerId === playerId);
              console.log('DEBUG - My assignment:', myAssignment);
              
              if (myAssignment) {
                // Get current players list from channel presence
                const state = channelRef.current ? channelRef.current.presenceState() : {};
                const allPlayers = Object.values(state).flat() as Player[];
                
                // Find my assigned player
                const assigned = allPlayers.find(p => p.id === myAssignment.assignedPlayerId);
                console.log('DEBUG - Found assigned player:', assigned);
                
                if (assigned) {
                  setAssignedPlayer(assigned);
                } else {
                  console.log('DEBUG - Could not find assigned player with ID:', myAssignment.assignedPlayerId);
                }
              } else {
                console.log('DEBUG - No assignment found for my ID:', playerId);
              }

              // Reset submission state
              setHasSubmitted(false);
              setSubmittedPlayerIds([]);
              setDescriptions([]);
              setDescription("");

              // Update all players to "writing" status
              if (channelRef.current) {
                channelRef.current.track({ 
                  id: playerId, 
                  name: username,
                  joinedAt: Date.now(),
                  status: 'writing'
                });
              }
            }
            
            if (payload.phase === 'reading' && payload.script) {
              setGeneratedScript(payload.script);
              setCurrentLineIndex(0);
            }
            
            if (payload.phase === 'guessing') {
              // Reset guesses
              setPlayerGuesses({});
              setSubmittedGuesses(false);
            }
            
            if (payload.phase === 'results' && payload.results) {
              setAllGuessResults(payload.results);
            }
          })
          .on('broadcast', { event: 'player_status_change' }, ({ payload }) => {
            console.log('DEBUG - Player status change broadcast:', payload);
            
            // Update player status in the local players list
            setPlayers(prevPlayers => 
              prevPlayers.map(player => 
                player.id === payload.playerId 
                  ? { ...player, status: payload.status } 
                  : player
              )
            );
          })
          .on('broadcast', { event: 'submit_description' }, ({ payload }) => {
            console.log('DEBUG - Description submission broadcast:', payload);
            
            // Add to submitted descriptions
            if (payload.description) {
              setDescriptions(prev => {
                // Don't add duplicate descriptions
                if (prev.some(d => d.playerId === payload.playerId)) {
                  return prev;
                }
                return [...prev, payload.description];
              });
            }
            
            // Add to list of submitted player IDs
            setSubmittedPlayerIds(prev => {
              if (prev.includes(payload.playerId)) return prev;
              return [...prev, payload.playerId];
            });
          })
          .on('broadcast', { event: 'player_guess_submitted' }, ({ payload }) => {
            console.log('DEBUG - Player guess submitted:', payload);
            
            if (payload.playerId && payload.guesses) {
              // If we're the host, collect all guesses
              if (isHost) {
                // In a real implementation, we would store these guesses to calculate results
                console.log('Host received player guess:', payload);
              }
            }
          })
          .on('broadcast', { event: 'host_update' }, ({ payload }) => {
            console.log('DEBUG - Host update broadcast:', payload);
            
            // Always respect forced host updates
            if (payload.forcedUpdate) {
              console.log('DEBUG - Forced host update received:', payload.hostId);
              setHostId(payload.hostId);
            } else if (payload.hostId && !preservingHostRef.current) {
              // Only update host if we're not in a preservation period
              setHostId(payload.hostId);
            }
            
            if (payload.originalHostId && !originalHostId) {
              setOriginalHostId(payload.originalHostId);
            }
          })
          .subscribe(async (status) => {
            console.log('DEBUG - Channel status:', status);
            if (status === 'SUBSCRIBED') {
              isSubscribed = true;
              setIsConnected(true);
              console.log('DEBUG - Subscribing to channel:', { 
                playerId, 
                username
              });
              await channel.track({ 
                id: playerId, 
                name: username,
                joinedAt: Date.now(),
                status: 'ready'
              });
            }
          });
      } catch (error) {
        console.error('DEBUG - Channel setup error:', error);
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`DEBUG - Retrying connection (${retryCount}/${maxRetries})...`);
          setTimeout(setupChannel, 1000 * retryCount);
        }
      }
    };

    setupChannel();

    return () => {
      console.log('DEBUG - Cleaning up channel');
      channel.unsubscribe();
      setIsConnected(false);
      isSubscribed = false;
      channelRef.current = null;
    };
  }, [slug, username, playerId]);

  // Helper to check if a game is active
  const isActiveGame = (phase: GamePhase): boolean => {
    return phase !== 'lobby';
  };

  const handleUsernameSubmit = () => {
    if (!tempUsername.trim()) return;
    
    console.log('DEBUG - Username submit:', { 
      tempUsername, 
      currentUsername: username
    });
    
    // Capitalize the first letter of each word in the username
    const capitalizedUsername = tempUsername
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Store in sessionStorage and set username
    sessionStorage.setItem(`username_${slug}`, capitalizedUsername);
    setUsername(capitalizedUsername);
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 5000);
  };

  const handleSettingChange = (setting: keyof GameSettings, value: GameSettings[keyof GameSettings]) => {
    setGameSettings(prev => ({ ...prev, [setting]: value }));
  };

  const handleStartGame = async () => {
    if (!isHost || players.length < 2) return;
    
    // Create random player assignments
    const assignments: PlayerAssignment[] = [];
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    
    // Debug log the player list and shuffle
    console.log('DEBUG - Players for assignment:', players);
    console.log('DEBUG - Shuffled players:', shuffledPlayers);
    
    for (let i = 0; i < players.length; i++) {
      // Assign each player to describe the next player in the shuffled list
      // Wrap around to the beginning if we're at the end of the list
      const nextIndex = (i + 1) % players.length;
      assignments.push({
        playerId: shuffledPlayers[i].id,
        assignedPlayerId: shuffledPlayers[nextIndex].id
      });
    }
    
    console.log('DEBUG - Player assignments:', assignments);
    console.log('DEBUG - Starting game with host:', {
      currentHostId: hostId,
      playerId,
      originalHostId,
      isHost
    });
    
    // Update game phase and broadcast to all players
    const channel = supa.channel(`room:${slug}`);
    await channel.send({
      type: 'broadcast',
      event: 'game_phase_change',
      payload: { 
        phase: 'description',
        assignments,
        preserveHost: true  // Add this to ensure host doesn't change during transition
      }
    });
    
    setGamePhase('description');
    setPlayerAssignments(assignments);
    
    // Find and set my assigned player
    const myAssignment = assignments.find(a => a.playerId === playerId);
    if (myAssignment) {
      const myAssignedPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
      if (myAssignedPlayer) {
        setAssignedPlayer(myAssignedPlayer);
      }
    }
  };

  const handleSubmitDescription = async () => {
    if (!description.trim() || !assignedPlayer || hasSubmitted) return;
    
    console.log('DEBUG - Submitting description:', { 
      description, 
      assignedPlayerId: assignedPlayer.id
    });
    
    // Capitalize the first letter of the description
    const capitalizedDescription = description.trim().charAt(0).toUpperCase() + description.trim().slice(1);
    
    // Create description object
    const descriptionData: PlayerDescription = {
      playerId,
      assignedPlayerId: assignedPlayer.id,
      description: capitalizedDescription
    };
    
    try {
      if (!channelRef.current) {
        console.error('DEBUG - Channel not initialized');
        return;
      }
      
      // First broadcast player status change
      await channelRef.current.send({
        type: 'broadcast',
        event: 'player_status_change',
        payload: { 
          playerId,
          status: 'ready'
        }
      });
      
      // Then broadcast description submission
      await channelRef.current.send({
        type: 'broadcast',
        event: 'submit_description',
        payload: { 
          playerId,
          description: descriptionData
        }
      });
      
      // Update local state
      setHasSubmitted(true);
      
      // Add to submitted descriptions
      setDescriptions(prev => [...prev, descriptionData]);
      
      // Add to list of submitted player IDs
      setSubmittedPlayerIds(prev => [...prev, playerId]);
      
      console.log('DEBUG - Description submitted successfully');
    } catch (error) {
      console.error('DEBUG - Error submitting description:', error);
    }
  };

  const handleGenerateScript = async () => {
    if (!isHost || !allPlayersSubmitted) return;
    
    setIsGeneratingScript(true);
    
    try {
      console.log('DEBUG - Generating script with descriptions:', descriptions);
      
      // Get simplified player info for the API
      const playerInfo = players.map(p => ({ id: p.id, name: p.name }));
      
      // Call the API endpoint
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          descriptions,
          players: playerInfo,
          settings: gameSettings
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate script');
      }
      
      const data = await response.json();
      setGeneratedScript(data.script);
      
      // Update game phase to reading
      if (channelRef.current) {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'game_phase_change',
          payload: { 
            phase: 'reading',
            script: data.script
          }
        });
      }
      
      setGamePhase('reading');
    } catch (error) {
      console.error('Error generating script:', error);
      alert('Failed to generate script. Please try again.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleKickPlayer = async (playerId: string) => {
    if (!isHost || gamePhase !== 'lobby') return;
    
    const channel = supa.channel(`room:${slug}`);
    await channel.send({
      type: 'broadcast',
      event: 'remove_player',
      payload: { playerId }
    });
  };

  // Process script into lines for reading
  const scriptLines = generatedScript 
    ? generatedScript.split('\n\n').filter(line => line.trim() !== '') 
    : [];

  const handleFinishReading = () => {
    // Move to guessing phase
    if (isHost && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'game_phase_change',
        payload: { 
          phase: 'guessing'
        }
      });
    }
  };

  const handleGuessSelection = (targetPlayerId: string, guessedPlayerId: string) => {
    setPlayerGuesses(prev => ({
      ...prev,
      [targetPlayerId]: guessedPlayerId
    }));
  };

  const handleSubmitGuesses = async () => {
    if (submittedGuesses) return;
    
    try {
      console.log('DEBUG - Submitting guesses:', playerGuesses);
      
      if (!channelRef.current) {
        console.error('DEBUG - Channel not initialized');
        return;
      }
      
      // Broadcast guesses
      await channelRef.current.send({
        type: 'broadcast',
        event: 'player_guess_submitted',
        payload: { 
          playerId,
          guesses: playerGuesses
        }
      });
      
      setSubmittedGuesses(true);
      
      if (isHost) {
        // Calculate results
        const results: Record<string, {correctGuesses: number, totalGuesses: number}> = {};
        
        // Initialize results for each player
        players.forEach(p => {
          results[p.id] = { correctGuesses: 0, totalGuesses: 0 };
        });
        
        // Count correct guesses
        const correctAssignments = descriptions.reduce((acc, desc) => {
          acc[desc.assignedPlayerId] = desc.playerId;
          return acc;
        }, {} as Record<string, string>);
        
        if (playerGuesses) {
          Object.entries(playerGuesses).forEach(([targetId, guessedId]) => {
            const correctWriterId = correctAssignments[targetId];
            if (correctWriterId && correctWriterId === guessedId) {
              if (results[playerId]) {
                results[playerId].correctGuesses += 1;
              }
            }
            if (results[playerId]) {
              results[playerId].totalGuesses += 1;
            }
          });
        }
        
        setAllGuessResults(results);
        
        // Move to results phase
        await channelRef.current.send({
          type: 'broadcast',
          event: 'game_phase_change',
          payload: { 
            phase: 'results',
            results
          }
        });
      }
    } catch (error) {
      console.error('DEBUG - Error submitting guesses:', error);
    }
  };

  const handlePlayAgain = async () => {
    if (!isHost) return;
    
    try {
      if (!channelRef.current) {
        console.error('DEBUG - Channel not initialized');
        return;
      }
      
      console.log('DEBUG - Play again initiated by host:', {
        hostId,
        originalHostId,
        playerId
      });
      
      // Set the preservation flag to prevent host reassignment
      preservingHostRef.current = true;
      
      // Force all clients to recognize current host as the definitive host
      await channelRef.current.send({
        type: 'broadcast',
        event: 'host_update',
        payload: { 
          hostId,
          originalHostId,
          forcedUpdate: true
        }
      });
      
      // Reset back to lobby
      await channelRef.current.send({
        type: 'broadcast',
        event: 'game_phase_change',
        payload: { 
          phase: 'lobby',
          preserveHost: true,  // Signal to preserve the current host
          preservedHostId: hostId // Explicitly include the host ID to preserve
        }
      });
      
      // Reset states
      setGamePhase('lobby');
      setPlayerAssignments([]);
      setAssignedPlayer(null);
      setDescription("");
      setHasSubmitted(false);
      setDescriptions([]);
      setSubmittedPlayerIds([]);
      setGeneratedScript("");
      setCurrentLineIndex(0);
      setPlayerGuesses({});
      setSubmittedGuesses(false);
      setAllGuessResults({});
      
      // Update player status but keep host status intact
      channelRef.current.track({ 
        id: playerId, 
        name: username,
        joinedAt: Date.now(),
        status: 'ready'
      });
      
      // Schedule a reset of the preservation flag
      setTimeout(() => {
        preservingHostRef.current = false;
        console.log('DEBUG - Host preservation period ended after Play Again');
      }, 5000);
    } catch (error) {
      console.error('DEBUG - Error resetting game:', error);
    }
  };

  const syncHostStatus = () => {
    if (!channelRef.current || !players.length) return;
    
    // Determine who should be host using our improved logic
    const newHostId = determineHost(players);
    
    console.log('DEBUG - Manual host sync:', {
      currentHostId: hostId,
      determinedHostId: newHostId,
      originalHostId,
      playerId,
      players
    });
    
    // Update host ID locally
    setHostId(newHostId);
    
    // Broadcast the update
    try {
      channelRef.current.send({
        type: 'broadcast',
        event: 'host_update',
        payload: { 
          hostId: newHostId,
          originalHostId
        }
      });
    } catch (err) {
      console.error('DEBUG - Error broadcasting manual host update:', err);
    }
  };

  // Reading phase UI
  if (gamePhase === 'reading') {
    return (
      <main className="h-screen flex flex-col items-center p-6 bg-gray-50">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
          PlotTwist
        </h1>
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-5 text-gray-800 text-center">
            The Script
          </h2>
          
          <div className="p-8 bg-gray-50 rounded-lg mb-6 whitespace-pre-wrap font-serif text-lg leading-relaxed border-2 border-gray-200 max-h-[500px] overflow-y-auto">
            {generatedScript ? (
              generatedScript.split('\n\n').map((section, index) => {
                // Format different parts of the script with better styling
                if (section.startsWith('NARRATOR:')) {
                  return (
                    <div key={index} className="mb-4 italic text-gray-700">
                      {section}
                    </div>
                  );
                } else if (section.startsWith('[')) {
                  return (
                    <div key={index} className="mb-4 text-sm uppercase tracking-wider text-gray-500 font-semibold">
                      {section}
                    </div>
                  );
                } else if (section.includes(':')) {
                  const [character, dialogue] = section.split(':', 2);
                  return (
                    <div key={index} className="mb-4">
                      <span className="font-bold text-blue-700">{character}:</span>
                      <span className="text-gray-900">{dialogue}</span>
                    </div>
                  );
                } else {
                  return (
                    <div key={index} className="mb-4">
                      {section}
                    </div>
                  );
                }
              })
            ) : (
              <div className="text-center text-gray-500">
                Script loading...
              </div>
            )}
          </div>
          
          {isHost && (
            <div className="flex justify-center">
              <button
                onClick={handleFinishReading}
                className="px-8 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md transition-colors"
              >
                Everyone's Done Reading? Continue to Guessing
              </button>
            </div>
          )}
          {!isHost && (
            <div className="text-center text-gray-600 italic">
              Read the script together. The host will move everyone to the guessing phase when ready.
            </div>
          )}
        </div>
        
        <div className="w-full max-w-4xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {players.map((player) => (
              <div
                key={player.id}
                className={`p-4 rounded-lg ${
                  player.id === playerId ? 'bg-blue-100 border-blue-300 border-2' : 'bg-white'
                } shadow`}
              >
                <div className="font-semibold text-center truncate">{player.name}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Only show username input if no username is set
  if (!username) {
    console.log('DEBUG - Rendering username input:', { 
      playerId,
      currentUsername: username,
      tempUsername
    });

    return (
      <main className="h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text">
          PlotTwist
        </h1>
        <input
          type="text"
          placeholder="Enter your username"
          value={tempUsername}
          onChange={(e) => setTempUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleUsernameSubmit();
            }
          }}
          className="px-4 py-2 border rounded-lg text-lg capitalize"
        />
        <button
          onClick={handleUsernameSubmit}
          className="px-6 py-3 rounded-lg bg-black text-white text-lg"
        >
          Join Game
        </button>
      </main>
    );
  }

  // Show loading state while connecting
  if (!isConnected) {
    return (
      <main className="h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-xl">Connecting to game...</div>
      </main>
    );
  }

  // Description phase rendering
  if (gamePhase === 'description') {
    return (
      <main className="h-screen flex flex-col lg:flex-row items-start p-6 bg-gray-50">
        <div className="w-full lg:w-2/3 lg:pr-6">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
          
          <div className="w-full bg-white rounded-xl shadow-lg p-8 mb-6">
            <h2 className="text-2xl font-semibold mb-5 text-gray-800">
              Write a character description for:
            </h2>
            
            {assignedPlayer ? (
              <>
                <div className="mb-6 text-center">
                  <div className="text-2xl font-bold py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg shadow-md">
                    {assignedPlayer.name}
                  </div>
                </div>
                
                <p className="text-md text-gray-700 mb-5 leading-relaxed">
                  Write a fun character description for this player that will be used in our story. 
                  Be creative and specific! What's their character like? What's their background?
                </p>
                
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Write your description here..."
                  maxLength={1738}
                  disabled={hasSubmitted}
                  className={`w-full p-4 border-2 border-purple-200 rounded-lg h-40 mb-5 text-gray-800 
                    focus:border-purple-400 focus:ring focus:ring-purple-200 focus:ring-opacity-50 transition-colors
                    ${hasSubmitted ? 'bg-gray-100 text-gray-500' : ''}`}
                />
                
                <div className="flex justify-between items-center mb-5">
                  <div className="text-sm text-gray-500">
                    {description.length > 0 ? (
                      <span className={description.length > 1500 ? "text-orange-500" : ""}>
                        {description.length}
                      </span>
                    ) : (
                      <span>0</span>
                    )}
                    <span className="text-gray-400">/{1738} characters</span>
                  </div>
                  
                  {description.length > 1500 && description.length <= 1738 && (
                    <span className="text-sm text-orange-500">
                      {1738 - description.length} characters remaining
                    </span>
                  )}
                </div>
                
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-500 italic">
                    This description will be used to generate a script that we'll all read together.
                  </p>
                  
                  {!hasSubmitted ? (
                    <button
                      onClick={handleSubmitDescription}
                      disabled={!description.trim()}
                      className={`px-6 py-3 rounded-lg ${
                        !description.trim() 
                          ? 'bg-gray-400 cursor-not-allowed' 
                          : 'bg-green-600 hover:bg-green-700 cursor-pointer'
                      } text-white font-semibold shadow-md transition-colors`}
                    >
                      Submit Description
                    </button>
                  ) : (
                    <div className="bg-green-100 text-green-700 px-4 py-2 rounded-lg flex items-center">
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Description Submitted
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-gray-500">
                Loading assignment...
              </div>
            )}
          </div>
        </div>
        
        <div className="w-full lg:w-1/3 lg:pl-6 mt-6 lg:mt-0">
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-800">Players</h3>
            
            <div className="space-y-3">
              {players.map((player) => (
                <div 
                  key={player.id} 
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center mb-2 sm:mb-0">
                    <div className="text-lg font-bold text-gray-800 mr-2">{player.name}</div>
                    {player.id === hostId && (
                      <span className="ml-1 text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        Host
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center">
                    {player.status === 'ready' ? (
                      <div className="flex items-center text-green-600 bg-green-50 px-2 py-1 rounded">
                        <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-medium">Ready</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-amber-600 bg-amber-50 px-2 py-1 rounded">
                        <svg className="w-5 h-5 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span className="text-sm font-medium">Writing</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {isHost && (
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold mb-4 text-gray-800">Host Controls</h3>
              
              <button
                onClick={handleGenerateScript}
                disabled={!allPlayersSubmitted || isGeneratingScript}
                className={`w-full py-3 px-4 rounded-lg ${
                  !allPlayersSubmitted || isGeneratingScript
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                } text-white font-semibold shadow-md transition-colors flex justify-center items-center`}
              >
                {isGeneratingScript ? (
                  <>
                    <svg className="w-5 h-5 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Generating Script...
                  </>
                ) : (
                  'Generate Script'
                )}
              </button>
              
              <p className="text-sm text-gray-500 mt-2 text-center">
                {allPlayersSubmitted 
                  ? 'All players are ready! You can generate the script now.'
                  : 'Wait for all players to submit their descriptions.'}
              </p>
              
              {/* Add sync host button if host status seems wrong */}
              {players.length > 0 && players[0].id !== hostId && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-xs text-amber-600 mb-2">Host status may be out of sync</p>
                  <button
                    onClick={syncHostStatus}
                    className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 rounded text-gray-700 text-sm"
                  >
                    Sync Host Status
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    );
  }

  // Guessing phase UI
  if (gamePhase === 'guessing') {
    return (
      <main className="h-screen flex flex-col items-center p-6 bg-gray-50">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
          PlotTwist
        </h1>
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-2 text-gray-800 text-center">
            Who Wrote What?
          </h2>
          
          <p className="text-gray-700 mb-8 text-center">
            For each player, guess who wrote their character description in the script.
          </p>
          
          <div className="space-y-8">
            {players.filter(p => p.id !== playerId).map((targetPlayer) => (
              <div key={targetPlayer.id} className="bg-blue-50 rounded-lg p-6 border-2 border-blue-100">
                <div className="text-xl font-bold text-blue-800 mb-4 flex items-center">
                  <span className="bg-blue-100 text-blue-800 w-10 h-10 rounded-full flex items-center justify-center mr-3">
                    {targetPlayer.name.charAt(0).toUpperCase()}
                  </span>
                  <span>Who wrote {targetPlayer.name}'s description?</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {players.filter(p => p.id !== targetPlayer.id).map((potentialWriter) => (
                    <button
                      key={potentialWriter.id}
                      disabled={submittedGuesses}
                      onClick={() => handleGuessSelection(targetPlayer.id, potentialWriter.id)}
                      className={`p-4 rounded-lg border-2 transition-colors flex items-center ${
                        playerGuesses[targetPlayer.id] === potentialWriter.id
                          ? 'bg-purple-100 border-purple-500 text-purple-800 font-bold'
                          : 'bg-white border-gray-200 hover:border-gray-400 text-gray-700'
                      } ${submittedGuesses ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-md'}`}
                    >
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                        playerGuesses[targetPlayer.id] === potentialWriter.id
                          ? 'bg-purple-200 text-purple-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {potentialWriter.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-lg">{potentialWriter.name}</span>
                      
                      {playerGuesses[targetPlayer.id] === potentialWriter.id && (
                        <svg className="w-5 h-5 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-10 flex justify-center">
            <button
              onClick={handleSubmitGuesses}
              disabled={submittedGuesses || Object.keys(playerGuesses).length < players.length - 1}
              className={`px-10 py-4 rounded-lg text-lg font-bold shadow-lg transition-all transform hover:scale-105 ${
                submittedGuesses || Object.keys(playerGuesses).length < players.length - 1
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
              }`}
            >
              {submittedGuesses ? (
                <div className="flex items-center">
                  <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Guesses Submitted
                </div>
              ) : (
                'Submit Guesses'
              )}
            </button>
          </div>
          
          {Object.keys(playerGuesses).length < players.length - 1 && !submittedGuesses && (
            <p className="text-center text-amber-600 mt-4">
              You need to make a guess for each player before submitting
            </p>
          )}
        </div>
        
        <div className="w-full max-w-4xl bg-white rounded-lg p-4 shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-700">Players in Game</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {players.map((player) => (
              <div
                key={player.id}
                className={`p-3 rounded-lg ${
                  player.id === playerId 
                    ? 'bg-blue-100 border-2 border-blue-300 text-blue-800' 
                    : 'bg-gray-50 border border-gray-200 text-gray-800'
                }`}
              >
                <div className="font-bold text-lg text-center">{player.name}</div>
                {player.id === playerId && (
                  <div className="text-xs text-center mt-1 text-blue-600">You</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }
  
  // Results phase UI
  if (gamePhase === 'results') {
    const getPlayerScore = (id: string) => {
      return allGuessResults[id] || { correctGuesses: 0, totalGuesses: 0 };
    };
    
    // Calculate correct assignments
    const correctAssignments = descriptions.reduce((acc, desc) => {
      acc[desc.assignedPlayerId] = desc.playerId;
      return acc;
    }, {} as Record<string, string>);
    
    return (
      <main className="h-screen flex flex-col items-center p-6 bg-gray-50">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
          PlotTwist
        </h1>
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-3xl font-bold mb-8 text-gray-800 text-center">
            Game Results
          </h2>
          
          <div className="space-y-10">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
              <h3 className="text-2xl font-bold mb-6 text-indigo-800 text-center">Player Scores</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {players.map((player) => {
                  const score = getPlayerScore(player.id);
                  const percentage = score.totalGuesses ? Math.round((score.correctGuesses / score.totalGuesses) * 100) : 0;
                  
                  return (
                    <div 
                      key={player.id} 
                      className={`rounded-lg overflow-hidden shadow-sm transition-all ${
                        player.id === playerId ? 'ring-2 ring-indigo-400 transform scale-105' : ''
                      }`}
                    >
                      <div className={`p-4 ${player.id === playerId ? 'bg-indigo-100' : 'bg-white'}`}>
                        <div className="flex items-center">
                          <div className="w-10 h-10 rounded-full bg-indigo-200 flex items-center justify-center mr-3 text-indigo-700 font-bold">
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-lg text-gray-800">{player.name}</div>
                            {player.id === playerId && (
                              <div className="text-xs text-indigo-600 font-medium">You</div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                        <div className="flex justify-between items-center mb-1">
                          <div className="text-sm text-gray-600 font-medium">Correct Guesses:</div>
                          <div className="font-bold text-gray-800">{score.correctGuesses} / {score.totalGuesses || players.length - 1}</div>
                        </div>
                        
                        <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1">
                          <div 
                            className="bg-indigo-600 h-2.5 rounded-full" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        
                        <div className="text-right text-xs text-gray-500">{percentage}% correct</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-6 border border-blue-100">
              <h3 className="text-2xl font-bold mb-6 text-blue-800 text-center">Who Wrote What</h3>
              
              <div className="space-y-4">
                {players.map((targetPlayer) => {
                  const writerId = correctAssignments[targetPlayer.id];
                  const writer = players.find(p => p.id === writerId);
                  
                  return (
                    <div key={targetPlayer.id} className="bg-white rounded-lg shadow-sm p-5 transition-all hover:shadow-md">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center mb-3 sm:mb-0">
                          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mr-4 text-blue-700 font-bold text-lg">
                            {targetPlayer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="font-bold text-xl text-gray-800">{targetPlayer.name}</div>
                        </div>
                        
                        <div className="flex items-center">
                          <div className="text-gray-400 mx-3 hidden sm:block">written by</div>
                          <div className="sm:text-right">
                            <div className="text-sm text-gray-500 sm:hidden mb-1">Written by:</div>
                            <div className="font-bold text-xl text-green-700 flex items-center">
                              {writer ? (
                                <>
                                  <span className="mr-2">{writer.name}</span>
                                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </>
                              ) : 'Unknown'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          {isHost && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={handlePlayAgain}
                className="px-10 py-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
              >
                Play Again
              </button>
            </div>
          )}
          
          {!isHost && (
            <div className="mt-8 text-center text-gray-500 italic">
              Waiting for the host to start a new game...
            </div>
          )}
        </div>
      </main>
    );
  }

  // Lobby phase rendering (default)
  return (
    <main className="h-screen flex flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text">
            PlotTwist
          </h1>
          <div className="flex flex-col items-center gap-3">
            <span className="text-lg text-gray-600">Room Code:</span>
            <code className="text-2xl font-mono font-bold bg-gradient-to-r from-blue-500 to-purple-500 text-transparent bg-clip-text">
              {slug}
            </code>
            <button
              onClick={handleCopyLink}
              className="px-6 py-3 rounded-lg bg-black text-white hover:bg-gray-800 transition-colors text-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>

        {isHost && gamePhase === 'lobby' && (
          <div className="flex flex-col gap-4 p-4 bg-gray-100 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-gray-800">Game Settings</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
                <select
                  value={gameSettings.tone}
                  onChange={(e) => handleSettingChange('tone', e.target.value as GameSettings['tone'])}
                  className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-gray-900"
                >
                  <option value="Funny">Funny</option>
                  <option value="Serious">Serious</option>
                  <option value="Dramatic">Dramatic</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scene</label>
                <select
                  value={gameSettings.scene}
                  onChange={(e) => handleSettingChange('scene', e.target.value as GameSettings['scene'])}
                  className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-gray-900"
                >
                  <option value="Party">Party</option>
                  <option value="Coffee Shop">Coffee Shop</option>
                  <option value="Classroom">Classroom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Length</label>
                <select
                  value={gameSettings.length}
                  onChange={(e) => handleSettingChange('length', e.target.value as GameSettings['length'])}
                  className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-gray-900"
                >
                  <option value="Short">Short</option>
                  <option value="Medium">Medium</option>
                  <option value="Long">Long</option>
                </select>
              </div>
              <button
                onClick={handleStartGame}
                disabled={players.length < 2}
                className={`mt-2 px-6 py-3 rounded-lg ${
                  players.length < 2 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-purple-600 hover:bg-purple-700 cursor-pointer'
                } text-white transition-colors text-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all`}
              >
                {players.length < 2 ? "Need More Players" : "Start Game"}
              </button>
            </div>
          </div>
        )}

        {/* Display for non-host who should be host based on join time */}
        {!isHost && gamePhase === 'lobby' && players.length > 0 && players[0].id === playerId && (
          <div className="flex flex-col gap-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-amber-700">Host Status Issue</h2>
            <p className="text-sm text-amber-600">
              You should be the host (first player), but your host status is not active.
            </p>
            <button
              onClick={syncHostStatus}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md"
            >
              Claim Host Status
            </button>
          </div>
        )}

        {isHost && gamePhase !== 'lobby' && (
          <div className="flex flex-col gap-4 p-4 bg-gray-100 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-gray-800">Game Settings</h2>
            <div className="flex flex-col gap-3">
              <div className="text-gray-700">
                <span className="font-medium">Tone:</span> {gameSettings.tone}
              </div>
              <div className="text-gray-700">
                <span className="font-medium">Scene:</span> {gameSettings.scene}
              </div>
              <div className="text-gray-700">
                <span className="font-medium">Length:</span> {gameSettings.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {gamePhase === 'lobby' && (
        <>
          <h2 className="text-2xl font-semibold">Players</h2>
          <ul className="text-xl">
            {players.map((p) => (
              <li key={p.id} className="py-1 flex items-center gap-2">
                <span className="text-base">
                  {p.status === 'ready' ? '🟢' : '✏️'}
                </span>
                {p.name}
                {p.id === hostId && (
                  <span className="text-sm px-2 py-0.5 bg-purple-500 text-white rounded-full">
                    Host
                  </span>
                )}
                {isHost && p.id !== hostId && (
                  <button
                    onClick={() => handleKickPlayer(p.id)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Kick player"
                  >
                    ❌
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
