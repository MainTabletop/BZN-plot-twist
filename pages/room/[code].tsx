import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { supa } from "../../lib/supa";
import Link from "next/link";
import { useRoom } from "../../lib/useRoom";

type Player = { id: string; name: string; joinedAt: number; status: 'ready' | 'writing' | 'guessing' };
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
type PlayerVote = {
  playerId: string;
  guessAuthorId: string;
  bestConceptDescId: string;
  bestDeliveryPlayerId: string;
};

export default function Room() {
  const router = useRouter();
  const { code: slug } = router.query;
  const room = useRoom(typeof slug === 'string' ? slug : undefined);
  const dbPhase = room?.phase;
  const dbHostId = room?.current_host_id;
  
  // Local state variables
  const [players, setPlayers] = useState<Player[]>([]);
  const [username, setUsername] = useState("");
  const [tempUsername, setTempUsername] = useState("");
  const [copied, setCopied] = useState(false);
  const [_hostId, setHostId] = useState<string | null>(null);  // Renamed to avoid collision
  const [playerId] = useState(() => crypto.randomUUID());
  const [_gamePhase, setGamePhase] = useState<GamePhase>('lobby');  // Renamed to avoid collision
  
  // Define derived state variables (used throughout the component)
  // These will shadow the state variables for all usages below
  const gamePhase = (dbPhase as GamePhase) || _gamePhase;
  const hostId = dbHostId || _hostId;
  
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
  const [guessAuthorId, setGuessAuthorId] = useState<string>("");
  const [bestConceptDescId, setBestConceptDescId] = useState<string>("");
  const [bestDeliveryPlayerId, setBestDeliveryPlayerId] = useState<string>("");
  const [playerVotes, setPlayerVotes] = useState<PlayerVote[]>([]);
  const [playerScores, setPlayerScores] = useState<Record<string, number>>({});
  const [bestConceptWinner, setBestConceptWinner] = useState<string | null>(null);
  const [bestDeliveryWinner, setBestDeliveryWinner] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  
  // Track if host has been explicitly set in this session
  const hostInitializedRef = useRef(false);
  // Add game phase ref to know when we're transitioning between phases
  const lastGamePhaseRef = useRef<GamePhase>('lobby');
  // Add flag to prevent host reassignment during play again
  const preservingHostRef = useRef(false);

  // Add ref for channel to use across functions
  const channelRef = useRef<any>(null);

  // Add a state to collect all players' guesses
  const [allPlayerGuesses, setAllPlayerGuesses] = useState<Record<string, Record<string, string>>>({});

  // Add a reconnection counter and status flag
  const [connectionRetryCount, setConnectionRetryCount] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const maxRetries = 5;
  const reconnectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track the original host ID in a ref to prevent it changing due to race conditions
  const originalHostIdRef = useRef<string | null>(null);

  // Set a function to safely update the original host ID
  const setOriginalHostSafely = (id: string | null) => {
    console.log('DEBUG - CRITICAL - Setting original host ID:', {
      current: originalHostId,
      new: id,
      currentRef: originalHostIdRef.current,
      playerId
    });
    
    if (id && !originalHostIdRef.current) {
      originalHostIdRef.current = id;
      setOriginalHostId(id);
      
      // Always persist in session storage
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(`originalHost_${slug}`, id);
          console.log('DEBUG - CRITICAL - Persisted original host to session storage:', id);
        } catch (e) {
          console.error('Failed to store original host in session storage', e);
        }
      }
    }
  };

  // Calculate if all players have submitted
  const allPlayersSubmitted = players.length > 0 && 
    players.every(player => player.status === 'ready' || player.id === hostId);

  // Calculate if current player is host with more explicit logging
  const isHost = playerId === hostId;

  // Load username from localStorage after mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedUsername = sessionStorage.getItem(`username_${slug}`);
    if (storedUsername) {
      setUsername(storedUsername);
    }
    
    // Also try to restore original host from session storage
    const storedOriginalHost = sessionStorage.getItem(`originalHost_${slug}`);
    if (storedOriginalHost) {
      console.log('DEBUG - CRITICAL - Restoring original host from session storage:', storedOriginalHost);
      originalHostIdRef.current = storedOriginalHost;
      setOriginalHostId(storedOriginalHost);
    }
  }, [slug]);

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

  // Fix the determineHost function to never "fall back" when original host exists
  const determineHost = (players: Player[]): string => {
    if (!players.length) return '';
    
    console.log('DEBUG - CRITICAL - determineHost function called:', {
      originalHostId,
      currentHostId: hostId,
      currentPhase: gamePhase,
      playerCount: players.length,
      preservingHost: preservingHostRef.current,
      callStack: new Error().stack?.split('\n').slice(1, 3).join(' - ')
    });
    
    // CRITICAL: If we have an originalHostId and that player is in the game,
    // ALWAYS return the original host, regardless of any other factors
    if (originalHostId && players.some(p => p.id === originalHostId)) {
      console.log('DEBUG - CRITICAL - determineHost returning original host:', originalHostId);
      return originalHostId;
    }
    
    // Only if original host is gone, maintain current host if they're still in the game
    if (hostId && players.some(p => p.id === hostId)) {
      console.log('DEBUG - CRITICAL - determineHost maintaining current host:', hostId);
      return hostId;
    }
    
    // ONLY as a last resort when no original or current host exists, use first player
    console.log('DEBUG - CRITICAL - determineHost falling back to first player:', players[0].id);
    return players[0].id;
  };

  // Improve the channel reconnection handler
  const handleChannelReconnect = () => {
    console.log('DEBUG - CRITICAL - Channel reconnection triggered:', {
      playerId,
      username,
      gamePhase,
      players: players.length
    });
    
    // Reset the preservation flag when reconnecting
    preservingHostRef.current = false;
    console.log('DEBUG - CRITICAL - Reset preservation flag after channel reconnection');
    
    // Attempt to rejoin with the same player ID and state
    if (channelRef.current) {
      console.log('DEBUG - CRITICAL - Reconnecting with gamePhase:', gamePhase);
      
      // Track our presence again with appropriate status based on game phase
      let status: 'ready' | 'writing' | 'guessing' = 'ready';
      
      if (gamePhase === 'description') {
        status = 'writing';
      } else if (gamePhase === 'guessing') {
        status = 'guessing';
      }
      
      // Update our presence with consistent data
      channelRef.current.track({ 
        id: playerId, 
        name: username,
        joinedAt: Date.now(), // Use current time
        status
      });
      
      console.log('DEBUG - CRITICAL - Retracked presence after reconnection with status:', status);
      
      // Perform phase-specific recovery
      if (gamePhase !== 'lobby') {
        // If we're the host, rebroadcast our host status
        if (isHost) {
          setTimeout(() => {
            try {
              if (channelRef.current) {
                channelRef.current.send({
                  type: 'broadcast',
                  event: 'host_update',
                  payload: { 
                    hostId,
                    originalHostId: originalHostIdRef.current,
                    forcedUpdate: true,
                    fromFunction: 'handleChannelReconnect',
                    timestamp: Date.now()
                  }
                });
                console.log('DEBUG - CRITICAL - Rebroadcast host status after reconnection');
              }
            } catch (error) {
              console.error('DEBUG - CRITICAL - Failed to rebroadcast host status:', error);
            }
          }, 1000);
        }
      }
    }
  };

  // Fix the sortPlayersByStableId function to include return type
  const sortPlayersByStableId = (players: Player[]): Player[] => {
    return [...players].sort((a, b) => {
      // Sort by join time first for consistency
      const timeSort = a.joinedAt - b.joinedAt;
      if (timeSort !== 0) return timeSort;
      
      // Then by ID as a fallback for stable order
      return a.id.localeCompare(b.id);
    });
  };

  // Add back the getPlayerName utility function
  const getPlayerName = (id: string | null): string => {
    if (!id) return 'Unknown';
    const player = players.find(p => p.id === id);
    return player ? player.name : 'Unknown Player';
  };

  // Modify initializeChannel to use the stable sorting
  const initializeChannel = () => {
    if (!slug || !username || typeof window === 'undefined') {
      console.log('DEBUG - Cannot initialize channel, missing parameters');
      return;
    }
    
    console.log('DEBUG - CRITICAL - Initializing channel:', { 
      slug, 
      username, 
      playerId, 
      hostId,
      originalHostId,
      originalHostIdRef: originalHostIdRef.current,
      isReconnecting
    });
    
    // Create a new channel
    const channel = supa.channel(`room:${slug}`, {
      config: { 
        presence: { key: playerId },
        broadcast: { self: true }
      },
    });

    // Store channel reference
    channelRef.current = channel;
    
    // Subscribe to the channel
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Player>();
        console.log('DEBUG - CRITICAL - Presence sync START:', { 
          state, 
          playerId, 
          hostId,
          originalHostId,
          originalHostIdRef: originalHostIdRef.current,
          hostInitialized: hostInitializedRef.current,
          preservingHost: preservingHostRef.current,
          gamePhase
        });
        
        const flat = Object.values(state).flat();
        console.log('DEBUG - Flattened players:', flat);
        
        // Remove duplicates by using a Map
        const uniquePlayers = Array.from(
          new Map(flat.map(player => [player.id, player])).values()
        );
        
        // CHANGED: Sort players by name for consistent ordering
        setPlayers([...uniquePlayers].sort((a, b) => a.name.localeCompare(b.name)));
        
        // Only set original host if it's not already set and this is the first player
        if (!originalHostIdRef.current && uniquePlayers.length === 1 && uniquePlayers[0].id === playerId) {
          const firstPlayerId = uniquePlayers[0].id;
          console.log('DEBUG - CRITICAL - Setting first player as original host:', firstPlayerId);
          
          // Use our safe setter function
          setOriginalHostSafely(firstPlayerId);
          
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
          
          // Immediately set host as well
          setHostId(firstPlayerId);
          hostInitializedRef.current = true;
        }
        
        // IMPROVED HOST LOGIC: Check if the original host from our ref is in the game
        const refOriginalHostPresent = originalHostIdRef.current && 
          uniquePlayers.some(p => p.id === originalHostIdRef.current);
        
        console.log('DEBUG - CRITICAL - Host presence check:', {
          refOriginalHostPresent,
          originalHostIdRef: originalHostIdRef.current,
          originalHostId,
          hostId,
          playerId,
          sortedPlayerIds: uniquePlayers.map(p => p.id)
        });
        
        if (refOriginalHostPresent) {
          // If ref original host exists, they should ALWAYS be the host
          if (hostId !== originalHostIdRef.current) {
            console.log('DEBUG - CRITICAL - Ensuring ref original host is host:', originalHostIdRef.current);
            setHostId(originalHostIdRef.current);
            hostInitializedRef.current = true;
            
            // If I am the original host, broadcast this
            if (playerId === originalHostIdRef.current) {
              try {
                channel.send({
                  type: 'broadcast',
                  event: 'host_update',
                  payload: { 
                    hostId: originalHostIdRef.current,
                    originalHostId: originalHostIdRef.current,
                    forcedUpdate: true,
                    fromPlayerId: playerId,
                    fromFunction: 'presenceSync_originalHostRef'
                  }
                }).catch(err => console.error('DEBUG - Error broadcasting host update:', err));
              } catch (err) {
                console.error('DEBUG - Error sending host update:', err);
              }
            }
          }
        } else if (!hostId || !uniquePlayers.some(p => p.id === hostId)) {
          // Original host ref not present AND current host not found in player list
          if (uniquePlayers.length === 0) {
            console.log('DEBUG - No players in the room, skipping host assignment');
            return;
          }
          
          // Use the first player from the sorted list as the new host
          // This is the ONLY case where we should assign a new host
          const newHostId = uniquePlayers[0].id;
          
          console.log('DEBUG - CRITICAL - Setting new host (original host absent):', {
            newHostId,
            currentHostId: hostId,
            originalHostIdRef: originalHostIdRef.current,
            playerId,
            iAmFirstPlayer: playerId === uniquePlayers[0].id
          });
          
          setHostId(newHostId);
          hostInitializedRef.current = true;
          
          // If I became the host, broadcast this
          if (playerId === newHostId) {
            try {
              channel.send({
                type: 'broadcast',
                event: 'host_update',
                payload: { 
                  hostId: newHostId,
                  // Do NOT pass null here, keep the original host ID for history
                  originalHostId: originalHostIdRef.current,
                  fromPlayerId: playerId,
                  fromFunction: 'presenceSync_newHostWhenOriginalGone',
                  sortedPlayerIds: uniquePlayers.map(p => p.id),
                  timestamp: Date.now()
                }
              }).catch(err => console.error('DEBUG - Error broadcasting host update:', err));
            } catch (err) {
              console.error('DEBUG - Error sending host update:', err);
            }
          }
        }
        
        // Update assigned player if we have assignments (keeping this unchanged)
        if (playerAssignments.length > 0) {
          const myAssignment = playerAssignments.find(a => a.playerId === playerId);
          if (myAssignment) {
            const assigned = uniquePlayers.find(p => p.id === myAssignment.assignedPlayerId);
            if (assigned) {
              setAssignedPlayer(assigned);
            }
          }
        }
        
        console.log('DEBUG - CRITICAL - Presence sync END:', {
          finalHostId: hostId,
          originalHostId,
          originalHostIdRef: originalHostIdRef.current,
          playerId,
          gamePhase
        });
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
        console.log('DEBUG - CRITICAL - Original host set broadcast:', payload);
        
        // Only set original host if our ref isn't set yet
        if (payload.originalHostId && !originalHostIdRef.current) {
          console.log('DEBUG - CRITICAL - Accepting original host from broadcast:', payload.originalHostId);
          setOriginalHostSafely(payload.originalHostId);
        } else {
          console.log('DEBUG - CRITICAL - Rejecting original host broadcast (already set):', {
            broadcast: payload.originalHostId,
            current: originalHostIdRef.current
          });
        }
      })
      .on('broadcast', { event: 'game_phase_change' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Game phase change START:', { 
          payload, 
          currentHost: hostId, 
          isHost: playerId === hostId,
          preservingHostFlag: preservingHostRef.current,
          currentPhase: gamePhase,
          newPhase: payload.phase,
          playerCount: players.length,
          expectedPlayerCount: payload.playerCount || 'unknown',
          hasAssignments: payload.assignments ? 'yes' : 'no'
        });
        
        // Immediately store assignments when they arrive with the phase change
        if (payload.phase === 'description' && payload.assignments) {
          setPlayerAssignments(payload.assignments);
          
          // Find my assignment right away
          const myAssignment = payload.assignments.find((a: PlayerAssignment) => a.playerId === playerId);
          console.log('DEBUG - CRITICAL - My assignment data:', myAssignment);
          
          if (myAssignment) {
            // Find my assigned player directly from players array
            const assignedPlayerObj = players.find(p => p.id === myAssignment.assignedPlayerId);
            console.log('DEBUG - CRITICAL - Found assigned player:', 
              assignedPlayerObj ? { id: assignedPlayerObj.id, name: assignedPlayerObj.name } : 'not found');
            
            if (assignedPlayerObj) {
              setAssignedPlayer(assignedPlayerObj);
            } else {
              console.log('DEBUG - CRITICAL - Could not find assigned player with ID:', myAssignment.assignedPlayerId);
              
              // Implement a more robust retry mechanism for finding assigned players
              // Try multiple times with increasing delays
              const retryAssignmentLookup = (retryCount = 0, maxRetries = 5) => {
                if (retryCount >= maxRetries) {
                  console.log('DEBUG - CRITICAL - Max retries reached, assignment recovery failed');
                  return;
                }
                
                setTimeout(() => {
                  const retryAssignedPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
                  if (retryAssignedPlayer) {
                    console.log('DEBUG - CRITICAL - Found assigned player on retry:', { 
                      id: retryAssignedPlayer.id, 
                      name: retryAssignedPlayer.name,
                      retryCount
                    });
                    setAssignedPlayer(retryAssignedPlayer);
                  } else {
                    // If still not found, try again with exponential backoff
                    console.log('DEBUG - CRITICAL - Retry attempt failed, trying again:', retryCount + 1);
                    retryAssignmentLookup(retryCount + 1, maxRetries);
                  }
                }, 500 * Math.pow(2, retryCount)); // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
              };
              
              // Start the retry process
              retryAssignmentLookup();
            }
          } else {
            console.log('DEBUG - CRITICAL - No assignment found for my ID:', playerId);
            
            // If we didn't get an assignment but others did, request it directly from the host
            if (isConnected && channelRef.current && payload.assignments.length > 0) {
              setTimeout(() => {
                console.log('DEBUG - CRITICAL - Requesting assignment recovery from host');
                channelRef.current?.send({
                  type: 'broadcast',
                  event: 'request_assignment_recovery',
                  payload: { 
                    requestingPlayerId: playerId,
                    currentAssignments: payload.assignments.length
                  }
                });
              }, 1000);
            }
          }
        }
        
        // Validate player count if provided
        if (payload.playerCount && players.length < payload.playerCount) {
          console.log('DEBUG - CRITICAL - Player count mismatch during phase transition reception:', {
            myPlayerCount: players.length,
            broadcastPlayerCount: payload.playerCount,
            difference: payload.playerCount - players.length
          });
          
          // If we have a significant player count mismatch during phase transition,
          // trigger a presence sync to ensure consistency
          if (payload.playerCount - players.length > 1 && channelRef.current) {
            console.log('DEBUG - CRITICAL - Triggering emergency presence sync due to count mismatch');
            
            // Force a presence sync by refreshing our presence data
            channelRef.current.track({ 
              id: playerId, 
              name: username,
              joinedAt: Date.now(),
              status: gamePhase === 'guessing' ? 'guessing' : 'ready'
            }).catch((err: Error) => {
              console.error('DEBUG - Error during emergency presence sync:', err);
            });
          }
        }
        
        // Preserve current host during phase transitions
        const currentHostId = hostId;
        
        // Log host changes more carefully
        console.log('DEBUG - CRITICAL - Host transition check:', {
          hostId,
          playerId,
          currentPhase: gamePhase,
          newPhase: payload.phase,
          isCurrentHost: playerId === hostId,
          preservingFlag: preservingHostRef.current
        });
        
        // If we're preserving the host (like when returning to lobby), set the flag
        if (payload.preserveHost) {
          console.log('DEBUG - CRITICAL - Explicitly preserving host during phase change:', { 
            hostId,
            originalHostId,
            originalHostIdRef: originalHostIdRef.current,
            gamePhase: payload.phase,
            preserveHost: payload.preserveHost,
            preservedHostId: payload.preservedHostId
          });
          
          // Set the flag to prevent host reassignment in presence handler
          preservingHostRef.current = true;
          
          // Force update host ID if one was explicitly provided
          if (payload.preservedHostId) {
            console.log('DEBUG - CRITICAL - Forcing host to preserved ID:', payload.preservedHostId);
            setHostId(payload.preservedHostId);
          }
          
          // Schedule a reset of the flag after a delay to allow for presence updates
          setTimeout(() => {
            preservingHostRef.current = false;
            console.log('DEBUG - CRITICAL - Host preservation period ended for phase transition to', payload.phase);
          }, 5000); // 5 seconds should be enough
        }
        
        // Update game phase
        setGamePhase(payload.phase);
        
        // Ensure host is preserved across phase changes
        if (hostId && hostId !== currentHostId) {
          console.log('DEBUG - CRITICAL - Host changed during phase transition, restoring:', {
            was: hostId,
            restoring: currentHostId,
            isHost: currentHostId === playerId
          });
          setHostId(currentHostId);
        }
        
        // Special handling for each phase
        if (payload.phase === 'description') {
          // Reset submission state
          setHasSubmitted(false);
          setSubmittedPlayerIds([]);
          setDescriptions([]);
          setDescription("");

          // Update player status to writing
          broadcastAndSyncPlayerStatus('writing');
        }
        else if (payload.phase === 'reading') {
          // Reset player status to ready for the reading phase
          broadcastAndSyncPlayerStatus('ready');
        }
        else if (payload.phase === 'guessing') {
          // Reset guesses state
          setPlayerGuesses({});
          setSubmittedGuesses(false);
          
          // Update player status to guessing for the guessing phase
          broadcastAndSyncPlayerStatus('guessing');
        }
        else if (payload.phase === 'results') {
          // Update player status back to ready for results phase
          broadcastAndSyncPlayerStatus('ready');
        }
        else if (payload.phase === 'lobby') {
          // Update player status to ready for lobby
          broadcastAndSyncPlayerStatus('ready');
        }
        
        console.log('DEBUG - CRITICAL - Game phase change END:', {
          currentPhase: payload.phase,
          previousPhase: gamePhase,
          hostId,
          isHost: playerId === hostId
        });
      })
      .on('broadcast', { event: 'player_status_change' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received player status change:', payload);
        
        // Enhanced validation for status updates during description phase
        if (gamePhase === 'description') {
          // Only accept 'writing' or 'ready' if they have submitted
          const playerHasSubmitted = submittedPlayerIds.includes(payload.playerId);
          
          if (payload.status === 'ready' && !playerHasSubmitted) {
            console.log('DEBUG - CRITICAL - Rejecting invalid ready status for non-submitted player:', payload.playerId);
            
            // If I'm the host, send a corrective status update
            if (isHost) {
              setTimeout(() => {
                if (channelRef.current) {
                  channelRef.current.send({
                    type: 'broadcast',
                    event: 'player_status_change',
                    payload: { 
                      playerId: payload.playerId,
                      status: 'writing', // Reset to writing status
                      timestamp: Date.now(),
                      corrected: true
                    }
                  });
                }
              }, 500);
            }
            return; // Reject invalid status updates
          }
        }
        
        // Update the player's status in our local player list
        setPlayers(prev => prev.map(player => 
          player.id === payload.playerId 
            ? { ...player, status: payload.status } 
            : player
        ));
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
          // Store guesses from all players
          setAllPlayerGuesses(prev => ({
            ...prev,
            [payload.playerId]: payload.guesses
          }));
          
          // If we're the host, collect all guesses
          if (isHost) {
            // In a real implementation, we would store these guesses to calculate results
            console.log('DEBUG - Host received player guess:', {
              fromPlayer: payload.playerId,
              guesses: payload.guesses,
              allPlayers: players.map(p => p.name),
              submittedGuesses
            });
            
            // Log the current state of all guesses
            console.log('DEBUG - Current guess submissions:', {
              submittedPlayerIds: players.filter(p => submittedGuesses || p.id === payload.playerId).map(p => p.name),
              playersWhoHaventSubmitted: players.filter(p => !submittedGuesses && p.id !== payload.playerId).map(p => p.name)
            });
          } else {
            console.log('DEBUG - Non-host received guess submission from:', {
              playerName: players.find(p => p.id === payload.playerId)?.name,
              guessCount: Object.keys(payload.guesses).length
            });
          }
        }
      })
      .on('broadcast', { event: 'host_update' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Host update broadcast:', payload);
        
        // Log who sent this update with detailed information
        console.log('DEBUG - CRITICAL - Processing host update:', { 
          currentHostId: hostId,
          updatedHostId: payload.hostId,
          originalHost: originalHostId,
          originalHostRef: originalHostIdRef.current,
          isOriginalHost: originalHostIdRef.current === playerId,
          fromFunction: payload.fromFunction || 'unknown',
          fromPlayerId: payload.fromPlayerId,
          timestamp: payload.timestamp,
          currentTimestamp: Date.now()
        });
        
        // IMPROVED HOST UPDATE LOGIC:
        
        // Rule 1: If I am the original host and someone is trying to change my status, reject it
        if (originalHostIdRef.current === playerId && payload.hostId !== playerId) {
          console.log('DEBUG - CRITICAL - Original host rejecting host change attempt');
          
          // Reassert ownership immediately
          if (channelRef.current) {
            try {
              channelRef.current.send({
                type: 'broadcast',
                event: 'host_update',
                payload: { 
                  hostId: playerId,
                  originalHostId: originalHostIdRef.current,
                  forcedUpdate: true,
                  fromPlayerId: playerId,
                  fromFunction: 'hostUpdate_originalHostDefense',
                  timestamp: Date.now()
                }
              });
            } catch (err) {
              console.error('DEBUG - Error sending host defense update:', err);
            }
          }
          return;
        }
        
        // Rule 2: Accept all updates from the original host (they have highest authority)
        if (payload.fromPlayerId === originalHostIdRef.current) {
          console.log('DEBUG - CRITICAL - Accepting host update from original host:', payload.hostId);
          setHostId(payload.hostId);
          return;
        }
        
        // Rule 3: If original host is present in the game, only they can set host
        const originalHostPresent = originalHostIdRef.current && 
          players.some(p => p.id === originalHostIdRef.current);
          
        if (originalHostPresent) {
          console.log('DEBUG - CRITICAL - Ignoring host update - original host is present');
          return;
        }
        
        // Rule 4: If we get here, there's no original host in the game, so accept the update
        if (payload.hostId) {
          // For safety, check if this is a stale update (older than 5 seconds)
          if (payload.timestamp && Date.now() - payload.timestamp > 5000) {
            console.log('DEBUG - CRITICAL - Rejecting stale host update from:', payload.fromPlayerId);
            return;
          }
          
          console.log('DEBUG - CRITICAL - Accepting host update (no original host present):', payload.hostId);
          setHostId(payload.hostId);
        }
        
        // Rule 5: Always update original host ID if we don't have one but keep using the ref
        if (payload.originalHostId && !originalHostIdRef.current) {
          console.log('DEBUG - CRITICAL - Setting original host from host update:', payload.originalHostId);
          setOriginalHostSafely(payload.originalHostId);
        }
      })
      .on('broadcast', { event: 'player_vote' }, ({ payload }) => {
        console.log('DEBUG - Player vote received:', payload);
        
        if (payload.playerId && payload.guessAuthorId) {
          // Add the vote to our collection
          setPlayerVotes(prev => {
            // Remove any existing vote from this player
            const filtered = prev.filter(v => v.playerId !== payload.playerId);
            // Add the new vote
            return [...filtered, payload as PlayerVote];
          });
          
          // Update player status to ready
          setPlayers(prevPlayers => 
            prevPlayers.map(player => 
              player.id === payload.playerId 
                ? { ...player, status: 'ready' } 
                : player
            )
          );
        }
      })
      .on('broadcast', { event: 'force_remove_player' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Force remove player received:', payload);
        
        // If this is me being kicked
        if (payload.playerId === playerId) {
          console.log('DEBUG - CRITICAL - I was kicked from the game');
          
          // Clear session storage and username
          sessionStorage.removeItem(`username_${slug}`);
          setUsername('');
          
          // Show alert to let user know they were kicked
          setTimeout(() => {
            alert('You have been removed from the game by the host.');
          }, 500);
          
          return;
        }
        
        // For everyone, remove this player from their list
        setPlayers(prev => {
          const updatedPlayers = prev.filter(p => p.id !== payload.playerId);
          console.log('DEBUG - CRITICAL - Removed kicked player from list:', {
            kickedId: payload.playerId,
            remainingPlayers: updatedPlayers.length
          });
          return updatedPlayers;
        });
      })
      .on('broadcast', { event: 'request_assignment_recovery' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Assignment recovery request received:', payload);
        
        // Only the host should respond to assignment recovery requests
        if (isHost && gamePhase === 'description' && playerAssignments.length > 0) {
          const requestingPlayerId = payload.requestingPlayerId;
          
          // Find the assignment for the requesting player
          const recoveryAssignment = playerAssignments.find(
            (a: PlayerAssignment) => a.playerId === requestingPlayerId
          );
          
          if (recoveryAssignment) {
            console.log('DEBUG - CRITICAL - Host sending assignment recovery:', {
              forPlayer: requestingPlayerId,
              assignment: recoveryAssignment
            });
            
            // Send a direct assignment recovery
            setTimeout(() => {
              if (channelRef.current) {
                channelRef.current.send({
                  type: 'broadcast',
                  event: 'assignment_recovery',
                  payload: { 
                    targetPlayerId: requestingPlayerId,
                    assignment: recoveryAssignment,
                    allAssignments: playerAssignments
                  }
                });
              }
            }, 200);
          } else {
            console.log('DEBUG - CRITICAL - Could not find assignment for recovery request:', requestingPlayerId);
          }
        }
      })
      .on('broadcast', { event: 'assignment_recovery' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received assignment recovery:', payload);
        
        // Check if this recovery is meant for me
        if (payload.targetPlayerId === playerId && !assignedPlayer && gamePhase === 'description') {
          const recoveryAssignment = payload.assignment;
          
          // Find my assigned player
          const recoveredPlayerObj = players.find(p => p.id === recoveryAssignment.assignedPlayerId);
          
          if (recoveredPlayerObj) {
            console.log('DEBUG - CRITICAL - Successfully recovered assignment:', {
              assignedPlayer: recoveredPlayerObj.name,
              recoveredFrom: 'assignment_recovery'
            });
            
            // Apply the recovered assignment
            setAssignedPlayer(recoveredPlayerObj);
          } else {
            console.log('DEBUG - CRITICAL - Recovered assignment but could not find player:', recoveryAssignment.assignedPlayerId);
          }
        }
        
        // If this contains all assignments, update our local copy
        if (payload.allAssignments && payload.allAssignments.length > 0) {
          setPlayerAssignments(payload.allAssignments);
        }
      })
      .subscribe(async (status) => {
        console.log('DEBUG - Channel status:', status);
        
        if (status === 'SUBSCRIBED') {
          // Clear reconnection attempts on successful connection
          setConnectionRetryCount(0);
          setIsReconnecting(false);
          setIsConnected(true);
          
          console.log('DEBUG - Subscribing to channel:', { 
            playerId, 
            username,
            originalHostId,
            hostId,
            isReconnecting
          });
          
          // Track presence
          await channel.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now(),
            status: gamePhase === 'guessing' ? 'guessing' : 'ready'
          });
          
          // Force host update if this is the original host
          if (originalHostId === playerId) {
            console.log('DEBUG - Original host reconnected, asserting host status');
            
            setTimeout(() => {
              if (channelRef.current) {
                try {
                  channelRef.current.send({
                    type: 'broadcast',
                    event: 'host_update',
                    payload: { 
                      hostId: playerId,
                      originalHostId: playerId,
                      forcedUpdate: true,
                      fromPlayerId: playerId,
                      fromFunction: 'channelSubscribe_originalHost'
                    }
                  });
                  
                  // Also persist in session storage
                  try {
                    sessionStorage.setItem(`host_${slug}`, playerId);
                    sessionStorage.setItem(`originalHost_${slug}`, playerId);
                  } catch (e) {
                    console.error('Failed to store host in session storage', e);
                  }
                } catch (err) {
                  console.error('DEBUG - Error sending reconnection host update:', err);
                }
              }
            }, 1000);
          }
          
          // Reset preservation flag after successful connection
          setTimeout(() => {
            preservingHostRef.current = false;
            console.log('DEBUG - Reset preservation flag after channel reconnection');
            
            // Check host status
            if (originalHostId && originalHostId === playerId) {
              ensureOriginalHostPreserved();
            }
          }, 5000);
        } 
        else if (status === 'CHANNEL_ERROR') {
          console.log('DEBUG - Channel error, attempting reconnection...');
          
          // Only trigger reconnection if not already reconnecting
          if (!isReconnecting && connectionRetryCount < maxRetries) {
            handleChannelReconnect();
          } else if (connectionRetryCount >= maxRetries) {
            console.log('DEBUG - Maximum reconnection attempts reached. Suggesting page refresh');
            alert('Lost connection to the game. Please refresh the page to reconnect.');
          }
        }
        else if (status === 'CLOSED' || status === 'TIMED_OUT') {
          console.log(`DEBUG - Channel ${status}, attempting reconnection...`);
          
          // Only trigger reconnection if not already reconnecting
          if (!isReconnecting && connectionRetryCount < maxRetries) {
            handleChannelReconnect();
          }
        }
      });
    
    // Schedule periodic presence pings to keep connection alive
    const pingInterval = setInterval(() => {
      if (channelRef.current) {
        try {
          // Re-track presence to keep connection alive
          channelRef.current.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now(),
            status: gamePhase === 'guessing' ? 'guessing' : 'ready'
          });
          console.log('DEBUG - Sent presence ping to keep connection alive');
        } catch (err) {
          console.error('DEBUG - Error sending presence ping:', err);
          
          // If we encounter an error during ping, try to reconnect
          if (!isReconnecting && connectionRetryCount < maxRetries) {
            handleChannelReconnect();
          }
        }
      }
    }, 30000); // Ping every 30 seconds
    
    // Return cleanup function
    return () => {
      console.log('DEBUG - Cleaning up channel and intervals');
      clearInterval(pingInterval);
      
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch (err) {
          console.error('DEBUG - Error unsubscribing from channel during cleanup:', err);
        }
      }
      
      setIsConnected(false);
      channelRef.current = null;
    };
  };

  // Modify the useEffect that handles channel setup
  useEffect(() => {
    if (!slug || !username || typeof window === 'undefined') return;
    
    console.log('DEBUG - Channel setup triggered:', { 
      slug, 
      username, 
      playerId, 
      hostId
    });
    
    // Try to get persisted host information
    let persistedHostId: string | null = null;
    let persistedOriginalHostId: string | null = null;
    
    try {
      persistedHostId = sessionStorage.getItem(`host_${slug}`);
      persistedOriginalHostId = sessionStorage.getItem(`originalHost_${slug}`);
      
      if (persistedHostId) {
        console.log('DEBUG - Found persisted host:', persistedHostId);
        setHostId(persistedHostId);
      }
      
      if (persistedOriginalHostId) {
        console.log('DEBUG - Found persisted original host:', persistedOriginalHostId);
        setOriginalHostId(persistedOriginalHostId);
      }
    } catch (e) {
      console.error('Failed to read host from session storage', e);
    }
    
    // Initialize the channel
    const cleanup = initializeChannel();
    
    // Setup reconnection retry for dropped connections
    reconnectionIntervalRef.current = setInterval(() => {
      if (!channelRef.current && !isReconnecting && connectionRetryCount < maxRetries) {
        console.log('DEBUG - Detected missing channel, initiating reconnection');
        handleChannelReconnect();
      }
    }, 5000); // Check every 5 seconds
    
    // Return cleanup function
    return () => {
      console.log('DEBUG - Cleaning up channel and intervals in main useEffect');
      
      if (reconnectionIntervalRef.current) {
        clearInterval(reconnectionIntervalRef.current);
        reconnectionIntervalRef.current = null;
      }
      
      if (cleanup) cleanup();
    };
  }, [slug, username, playerId]); // Only depend on critical values

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
    
    console.log('DEBUG - CRITICAL - Starting game with players:', 
      players.map(p => ({ id: p.id, name: p.name })));
    
    // Create player assignments - each player writes a description for another player
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const assignments: PlayerAssignment[] = [];
    
    for (let i = 0; i < shuffled.length; i++) {
      const player = shuffled[i];
      const assignedPlayer = shuffled[(i + 1) % shuffled.length];
      assignments.push({
        playerId: player.id,
        assignedPlayerId: assignedPlayer.id
      });
    }
    
    console.log('DEBUG - CRITICAL - Created assignments:', assignments);
    
    // Set preservation flag during game start
    preservingHostRef.current = true;
    console.log('DEBUG - CRITICAL - Set preservationFlag before game start');
    
    if (channelRef.current) {
      try {
        // First ensure host status is synced
        await channelRef.current.send({
          type: 'broadcast',
          event: 'host_update',
          payload: { 
            hostId: originalHostIdRef.current,
            originalHostId: originalHostIdRef.current,
            forcedUpdate: true,
            fromFunction: 'handleStartGame',
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Sent host update before game start');
        
        // Then send the game phase change with assignments
        await channelRef.current.send({
          type: 'broadcast',
          event: 'game_phase_change',
          payload: { 
            phase: 'description',
            assignments,
            preserveHost: true,
            preservedHostId: hostId,
            playerCount: players.length,
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Sent phase change to description with assignments');
        
        // Update local state immediately for responsiveness
        setPlayerAssignments(assignments);
        setGamePhase('description');
        
        // Update own status
        await broadcastAndSyncPlayerStatus('writing');
        
        // Reset after setup is complete
        setTimeout(() => {
          preservingHostRef.current = false;
          console.log('DEBUG - CRITICAL - Reset preservationFlag after game start');
        }, 3000);
        
      } catch (error) {
        console.error('DEBUG - CRITICAL - Error starting game:', error);
        preservingHostRef.current = false;
      }
    }
  };

  const handleSubmitDescription = async () => {
    if (!description.trim() || !assignedPlayer || !channelRef.current) return;

    console.log('DEBUG - CRITICAL - Submitting description:', {
      forPlayer: assignedPlayer.name,
      myId: playerId,
      myName: username,
      descriptionLength: description.length
    });

    try {
      // First update local state
      setHasSubmitted(true);
      
      // Create description object to be submitted
      const descriptionObj: PlayerDescription = {
        playerId,
        assignedPlayerId: assignedPlayer.id,
        description
      };
      
      // Add to local list first
      setDescriptions(prev => {
        if (prev.some(d => d.playerId === playerId)) {
          // Replace existing if already present
          return prev.map(d => d.playerId === playerId ? descriptionObj : d);
        }
        return [...prev, descriptionObj];
      });
      
      // Add to submitted IDs list
      setSubmittedPlayerIds(prev => {
        if (prev.includes(playerId)) return prev;
        return [...prev, playerId];
      });

      // Send the description to all players
      await channelRef.current.send({
        type: 'broadcast',
        event: 'submit_description',
        payload: {
          playerId,
          description: descriptionObj
        }
      });

      // Update player status to ready
      await broadcastAndSyncPlayerStatus('ready');

      console.log('DEBUG - Description submitted successfully');
      
      // Implement validation to ensure description was properly recorded
      setTimeout(() => {
        // Check if my submission is in the descriptions list
        const mySubmissionRecorded = descriptions.some(d => d.playerId === playerId);
        
        if (!mySubmissionRecorded && channelRef.current) {
          console.log('DEBUG - CRITICAL - My submission wasn\'t recorded, retrying...');
          
          // Retry submission
          channelRef.current.send({
            type: 'broadcast',
            event: 'submit_description',
            payload: {
              playerId,
              description: descriptionObj,
              isRetry: true
            }
          });
          
          // Retry status update as well
          setTimeout(() => broadcastAndSyncPlayerStatus('ready'), 200);
        }
      }, 2000);
      
      // Additional validation 5 seconds later to absolutely ensure submission was recorded
      setTimeout(() => {
        const finalCheck = descriptions.some(d => d.playerId === playerId);
        
        if (!finalCheck && channelRef.current) {
          console.log('DEBUG - CRITICAL - Final submission validation failed, sending emergency retry');
          
          // Emergency retry with all players
          channelRef.current.send({
            type: 'broadcast',
            event: 'submit_description',
            payload: {
              playerId,
              description: descriptionObj,
              isEmergencyRetry: true
            }
          });
          
          // Force status update
          broadcastAndSyncPlayerStatus('ready');
        }
      }, 5000);

    } catch (error) {
      console.error('DEBUG - Error submitting description:', error);
      setHasSubmitted(false);
      alert('Error submitting your description. Please try again.');
    }
  };

  const handleGenerateScript = async () => {
    if (!isHost || !allPlayersSubmitted) return;
    
    console.log('DEBUG - CRITICAL - Generate script initiated by:', {
      playerId,
      isHost,
      hostId,
      username,
      descriptions: descriptions.length,
      playerCount: players.length,
      submittedPlayerIds: submittedPlayerIds.length
    });
    
    // VALIDATION: Check if all players have actually submitted descriptions
    const allPlayersHaveSubmitted = players.every(player => 
      player.id === playerId || // Skip host
      submittedPlayerIds.includes(player.id)
    );
    
    // Additional validation that we have a description for every player
    const hasAllDescriptions = descriptions.length === players.length;
    
    if (!allPlayersHaveSubmitted || !hasAllDescriptions) {
      console.log('DEBUG - CRITICAL - Invalid script generation - missing submissions:', {
        allPlayersHaveSubmitted,
        hasAllDescriptions,
        players: players.length,
        descriptions: descriptions.length,
        submittedIds: submittedPlayerIds
      });
      
      alert('Not all players have submitted descriptions yet. Please wait.');
      return;
    }
    
    setIsGeneratingScript(true);
    
    try {
      console.log('DEBUG - Generating script with descriptions:', descriptions);
      
      // Set preservation flag before making changes
      preservingHostRef.current = true;
      console.log('DEBUG - Set preservationFlag before script generation');
      
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
      
      console.log('DEBUG - Script generated, preparing to update phase', {
        isHost,
        hostId,
        playerId,
        currentPhase: gamePhase
      });
      
      // Send a preliminary host update to ensure everyone knows the correct host
      if (channelRef.current) {
        try {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'host_update',
            payload: { 
              hostId,
              originalHostId,
              forcedUpdate: true,
              fromFunction: 'handleGenerateScript'
            }
          });
          
          console.log('DEBUG - Sent forced host update before phase change');
          
          // Update game phase to reading
          await channelRef.current.send({
            type: 'broadcast',
            event: 'game_phase_change',
            payload: { 
              phase: 'reading',
              script: data.script,
              preserveHost: true,
              preservedHostId: hostId
            }
          });
          
          console.log('DEBUG - Sent phase change to reading with preserved host');
        } catch (error) {
          console.error('ERROR - Failed to update phase:', error);
        }
      }
      
      setGamePhase('reading');
    } catch (error) {
      console.error('Error generating script:', error);
      alert('Failed to generate script. Please try again.');
    } finally {
      setIsGeneratingScript(false);
      
      // Reset preservation flag after a longer delay to ensure host stability
      setTimeout(() => {
        preservingHostRef.current = false;
        console.log('DEBUG - Reset preservationFlag after script generation');
      }, 10000); // Increase to 10 seconds
    }
  };

  const handleKickPlayer = async (playerId: string) => {
    if (!isHost || gamePhase !== 'lobby') return;
    
    console.log('DEBUG - CRITICAL - Host kicking player:', {
      kickedPlayerId: playerId,
      hostId,
      originalHostId: originalHostIdRef.current,
      gamePhase
    });
    
    if (channelRef.current) {
      try {
        // Use a direct broadcast with a clear unique event name
        await channelRef.current.send({
          type: 'broadcast',
          event: 'force_remove_player',
          payload: { 
            playerId,
            kickedBy: playerId === hostId ? 'self' : 'host',
            timestamp: Date.now()
          }
        });
        
        // Wait brief moment to ensure broadcast is processed
        setTimeout(() => {
          // Update local player list immediately for everyone
          setPlayers(prev => prev.filter(p => p.id !== playerId));
        }, 100);
        
      } catch (err) {
        console.error('DEBUG - CRITICAL - Error kicking player:', err);
      }
    }
  };

  // Process script into lines for reading
  const scriptLines = generatedScript 
    ? generatedScript.split('\n\n').filter(line => line.trim() !== '') 
    : [];

  // Add isOriginalHost helper
  const isOriginalHost = playerId === originalHostId;

  // Create function to safely check and restore the original host
  const ensureOriginalHostPreserved = () => {
    console.log('DEBUG - CRITICAL - Running original host preservation check:', {
      originalHostIdRef: originalHostIdRef.current,
      originalHostId,
      hostId,
      playerId,
      isOriginalHost: originalHostIdRef.current === playerId
    });
    
    // Only the original host can reassert themselves as host
    if (originalHostIdRef.current && originalHostIdRef.current === playerId && hostId !== playerId) {
      console.log('DEBUG - CRITICAL - Restoring original host status (forced)');
      setHostId(playerId);
      
      // Force broadcast to sync all clients
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'host_update',
          payload: { 
            hostId: playerId,
            originalHostId: playerId,
            forcedUpdate: true,
            fromPlayerId: playerId,
            fromFunction: 'ensureOriginalHostPreserved_forced',
            timestamp: Date.now()
          }
        }).catch((err: Error) => console.error('DEBUG - Error sending host restore:', err));
      }
    }
  };

  // Check original host more frequently
  useEffect(() => {
    if (!originalHostIdRef.current || playerId !== originalHostIdRef.current) return;
    
    console.log('DEBUG - CRITICAL - Setting up original host protection timer');
    
    // Check more frequently to ensure original host status
    const interval = setInterval(() => {
      ensureOriginalHostPreserved();
    }, 2000); // Every 2 seconds
    
    return () => clearInterval(interval);
  }, [originalHostIdRef.current, playerId, hostId]);

  // Modify handleFinishReading to handle player count validation
  const handleFinishReading = () => {
    console.log('DEBUG - CRITICAL - handleFinishReading called:', {
      isHost,
      isOriginalHost,
      hostId,
      originalHostId,
      playerId,
      currentPhase: gamePhase,
      playerCount: players.length
    });
    
    // Only the original host should be able to proceed
    if (!(playerId === originalHostIdRef.current) && isHost) {
      console.log('DEBUG - CRITICAL - Non-original host attempting to finish reading, forcing original host restoration');
      
      // Force host update first
      if (channelRef.current) {
        try {
          channelRef.current.send({
            type: 'broadcast',
            event: 'host_update',
            payload: { 
              hostId: originalHostIdRef.current,
              originalHostId: originalHostIdRef.current,
              forcedUpdate: true,
              fromFunction: 'handleFinishReading_hostRestore',
              timestamp: Date.now()
            }
          });
          console.log('DEBUG - CRITICAL - Forced host restoration to original host');
        } catch (error) {
          console.error('ERROR - Failed to restore host:', error);
        }
      }
      return;
    }
    
    // Add validation to ensure correct player count
    const expectedPlayerCount = descriptions.length;
    
    if (players.length < expectedPlayerCount) {
      console.log('DEBUG - CRITICAL - Player count mismatch during phase transition:', {
        currentPlayers: players.length,
        expectedPlayers: expectedPlayerCount
      });
      
      if (confirm('There seems to be a player count issue. Some players may be disconnected. Continue anyway?')) {
        console.log('DEBUG - CRITICAL - Host confirmed to continue despite player count mismatch');
      } else {
        console.log('DEBUG - CRITICAL - Host canceled transition due to player count mismatch');
        return;
      }
    }
    
    // Move to guessing phase
    if ((playerId === originalHostIdRef.current) && channelRef.current) {
      // Set preservation flag before making changes
      preservingHostRef.current = true;
      console.log('DEBUG - CRITICAL - Set preservationFlag before finishing reading');
      
      // Send a preliminary host update
      try {
        channelRef.current.send({
          type: 'broadcast',
          event: 'host_update',
          payload: { 
            hostId: originalHostIdRef.current,
            originalHostId: originalHostIdRef.current,
            forcedUpdate: true,
            fromFunction: 'handleFinishReading',
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Sent forced host update before phase change to guessing');
        
        // Change phase with explicit host preservation
        channelRef.current.send({
          type: 'broadcast',
          event: 'game_phase_change',
          payload: { 
            phase: 'guessing',
            preserveHost: true,
            preservedHostId: originalHostIdRef.current,
            playerCount: players.length,
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Sent phase change to guessing with preserved host');
        
        // Update game phase locally for responsiveness
        setGamePhase('guessing');
        
        // Update own status immediately
        broadcastAndSyncPlayerStatus('guessing');
      } catch (error) {
        console.error('ERROR - Failed to update phase:', error);
      }
      
      // Reset preservation flag after a delay
      setTimeout(() => {
        preservingHostRef.current = false;
        console.log('DEBUG - CRITICAL - Reset preservationFlag after finishing reading');
      }, 10000); // Use 10 second timer
    }
  };

  const handleGuessSelection = (targetPlayerId: string, guessedPlayerId: string) => {
    setPlayerGuesses(prev => ({
      ...prev,
      [targetPlayerId]: guessedPlayerId
    }));
  };

  // Modify the handSubmitGuesses function to validate all votes
  const handleSubmitGuesses = async () => {
    if (submittedGuesses) return;
    
    console.log('DEBUG - CRITICAL - Starting guess submission process:', {
      isHost,
      playerId,
      playerName: username,
      hostId,
      originalHostId,
      isOriginalHost: playerId === originalHostIdRef.current,
      gamePhase,
      playerGuessesCount: Object.keys(playerGuesses).length,
      totalPlayersToGuessFor: players.length - 1 // Exclude self
    });
    
    if (!channelRef.current) {
      console.error('DEBUG - CRITICAL - Channel not initialized for guess submission');
      return;
    }
    
    // Check if guesses for all valid players were made (excluding self)
    const validPlayerCount = players.filter(p => p.id !== playerId).length;
    const playerGuessCount = Object.keys(playerGuesses).length;
    
    if (playerGuessCount < validPlayerCount) {
      console.log('DEBUG - CRITICAL - Incomplete guesses:', {
        guessesNeeded: validPlayerCount,
        guessesSubmitted: playerGuessCount,
        missing: validPlayerCount - playerGuessCount
      });
      
      alert(`Please make a guess for each player before submitting. (${playerGuessCount}/${validPlayerCount})`);
      return;
    }
    
    try {
      // Set preservation flag during the status change
      preservingHostRef.current = true;
      console.log('DEBUG - CRITICAL - Setting preservation flag during guess submission');
      
      // First update player status to 'ready'
      await broadcastAndSyncPlayerStatus('ready');
      
      // If this is the original host, force broadcast host update before continuing
      if (playerId === originalHostIdRef.current) {
        console.log('DEBUG - CRITICAL - Original host forcing host update during guess submission');
        try {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'host_update',
            payload: { 
              hostId: originalHostIdRef.current,
              originalHostId: originalHostIdRef.current,
              forcedUpdate: true,
              fromPlayerId: playerId,
              fromFunction: 'handleSubmitGuesses_originalHost',
              timestamp: Date.now()
            }
          });
        } catch (err) {
          console.error('DEBUG - CRITICAL - Error sending host update during guess submission:', err);
        }
      }
      
      // Now broadcast guesses
      console.log('DEBUG - CRITICAL - Broadcasting guesses:', {
        playerId,
        guessCount: Object.keys(playerGuesses).length
      });
      
      await channelRef.current.send({
        type: 'broadcast',
        event: 'player_guess_submitted',
        payload: { 
          playerId,
          guesses: playerGuesses,
          timestamp: Date.now()
        }
      });
      
      setSubmittedGuesses(true);
      
      // Non-original host players can reset their preservation flag after a short delay
      if (playerId !== originalHostIdRef.current) {
        setTimeout(() => {
          preservingHostRef.current = false;
          console.log('DEBUG - CRITICAL - Reset preservation flag after guess submission (non-original host)');
        }, 2000);
      }
      
    } catch (error) {
      console.error('DEBUG - CRITICAL - Error submitting guesses:', error);
      preservingHostRef.current = false; // Make sure to reset on error
    }
  };

  const handlePlayAgain = async () => {
    // Only allow the original host to restart the game
    if (!(playerId === originalHostId)) {
      console.log('DEBUG - Non-original host attempted to restart game, ignoring');
      return;
    }
    
    try {
      if (!channelRef.current) {
        console.error('DEBUG - Channel not initialized');
        return;
      }
      
      console.log('DEBUG - Play again initiated by original host:', {
        hostId,
        originalHostId,
        playerId
      });
      
      // Set the preservation flag to prevent host reassignment
      preservingHostRef.current = true;
      
      // Force all clients to recognize original host as the definitive host
      await channelRef.current.send({
        type: 'broadcast',
        event: 'host_update',
        payload: { 
          hostId: originalHostId,
          originalHostId,
          forcedUpdate: true,
          fromPlayerId: playerId,
          fromFunction: 'handlePlayAgain'
        }
      });
      
      // Reset back to lobby
      await channelRef.current.send({
        type: 'broadcast',
        event: 'game_phase_change',
        payload: { 
          phase: 'lobby',
          preserveHost: true,  // Signal to preserve the current host
          preservedHostId: originalHostId // Explicitly include the original host ID to preserve
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
        
        // Double-check host after preservation ends
        setTimeout(() => {
          ensureOriginalHostPreserved();
        }, 1000);
      }, 15000); // Increase to 15 seconds
    } catch (error) {
      console.error('DEBUG - Error resetting game:', error);
    }
  };

  // Modify syncHostStatus for improved approach
  const syncHostStatus = () => {
    if (!channelRef.current || !players.length) return;
    
    console.log('DEBUG - CRITICAL - Manual host sync started:', {
      currentHostId: hostId,
      originalHostId,
      originalHostIdRef: originalHostIdRef.current,
      playerId,
      playerCount: players.length
    });
    
    // If original host from ref is in the game, they should be host
    const originalHostPresent = originalHostIdRef.current && 
      players.some(p => p.id === originalHostIdRef.current);
    
    if (originalHostPresent) {
      if (hostId !== originalHostIdRef.current) {
        console.log('DEBUG - CRITICAL - Manual sync: original host should be host');
        setHostId(originalHostIdRef.current);
        
        // If I am the original host, broadcast this
        if (playerId === originalHostIdRef.current) {
          try {
            channelRef.current.send({
              type: 'broadcast',
              event: 'host_update',
              payload: { 
                hostId: originalHostIdRef.current,
                originalHostId: originalHostIdRef.current,
                forcedUpdate: true,
                fromPlayerId: playerId,
                fromFunction: 'syncHostStatus_originalHost',
                timestamp: Date.now()
              }
            });
          } catch (err) {
            console.error('DEBUG - Error broadcasting manual host update:', err);
          }
        }
      }
    } else if (!hostId || !players.some(p => p.id === hostId)) {
      // Original host not present AND host is missing
      // Use first player from the sorted list by NAME (not join time)
      const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));
      const newHostId = sortedPlayers[0]?.id;
      
      console.log('DEBUG - CRITICAL - Manual sync: sorted players for host selection:', {
        sortedPlayerIds: sortedPlayers.map(p => p.id),
        selectedHost: newHostId,
        iAmSelectedHost: playerId === newHostId
      });
      
      if (newHostId && newHostId !== hostId) {
        console.log('DEBUG - CRITICAL - Manual sync: assigning new host:', newHostId);
        setHostId(newHostId);
        
        // If I become the host, broadcast this
        if (playerId === newHostId) {
          try {
            channelRef.current.send({
              type: 'broadcast',
              event: 'host_update',
              payload: { 
                hostId: newHostId,
                originalHostId: originalHostIdRef.current, // Keep original host ID for history
                fromPlayerId: playerId,
                fromFunction: 'syncHostStatus_newHost',
                timestamp: Date.now()
              }
            });
          } catch (err) {
            console.error('DEBUG - Error broadcasting manual host update:', err);
          }
        }
      }
    }
  };

  // Add player status validation for the "Show Results" button
  const canShowResults = () => {
    // Only host can show results
    if (!isHost) return false;
    
    // If not in guessing phase, cannot show results
    if (gamePhase !== 'guessing') return false;
    
    // Check if all players have submitted their guesses
    const allPlayersReady = players.every(player => 
      player.status === 'ready' || player.id === playerId
    );
    
    console.log('DEBUG - CRITICAL - Can show results check:', {
      playerId,
      isHost,
      gamePhase,
      allPlayersReady,
      playerStatuses: players.map(p => ({ id: p.id, name: p.name, status: p.status }))
    });
    
    return allPlayersReady;
  };

  // Fix the handleShowResults function to validate player count and statuses
  const handleShowResults = async () => {
    if (!isHost || gamePhase !== 'guessing') return;
    
    console.log('DEBUG - CRITICAL - handleShowResults called:', {
      isHost,
      isOriginalHost: playerId === originalHostIdRef.current,
      originalHostId: originalHostIdRef.current,
      playerCount: players.length,
      gamePhase
    });
    
    // Validate that we have enough players to show results
    if (players.length < 2) {
      console.log('DEBUG - CRITICAL - Not enough players to show results:', players.length);
      alert('There aren\'t enough players to show results.');
      return;
    }
    
    // Double-check if all players are actually ready
    const allActuallyReady = players.every(player => 
      player.status === 'ready' || player.id === playerId
    );
    
    console.log('DEBUG - CRITICAL - Results readiness check:', {
      allActuallyReady,
      playerStatuses: players.map(p => ({ name: p.name, status: p.status }))
    });
    
    if (!allActuallyReady) {
      const showAnyway = confirm('Not all players appear ready. Show results anyway?');
      if (!showAnyway) {
        console.log('DEBUG - CRITICAL - Host canceled showing results due to players not ready');
        return;
      }
      console.log('DEBUG - CRITICAL - Host confirmed to show results despite players not ready');
    }
    
    // Set preservation flag before showing results
    preservingHostRef.current = true;
    console.log('DEBUG - CRITICAL - Set preservationFlag before showing results');
    
    // Initialize player scores
    const scores: Record<string, number> = {};
    players.forEach(p => {
      scores[p.id] = 0;
    });
    
    // Count correct guesses
    const correctAssignments = descriptions.reduce((acc, desc) => {
      acc[desc.assignedPlayerId] = desc.playerId;
      return acc;
    }, {} as Record<string, string>);
    
    console.log('DEBUG - Correct assignments mapping:', {
      correctAssignments,
      descriptionCount: descriptions.length,
      players: players.map(p => `${p.name} (${p.id})`),
    });
    
    // A - Award 3 points for correct author guesses
    playerVotes.forEach(vote => {
      const targetPlayerId = vote.playerId; // Whose description we're guessing about
      const assignedPlayerId = correctAssignments[targetPlayerId]; // Who actually wrote it
      
      console.log(`DEBUG - Checking ${getPlayerName(vote.playerId)}'s author guess:`, {
        guessedAuthor: getPlayerName(vote.guessAuthorId),
        actualAuthor: getPlayerName(assignedPlayerId),
        isCorrect: assignedPlayerId === vote.guessAuthorId
      });
      
      if (assignedPlayerId === vote.guessAuthorId) {
        scores[vote.playerId] += 3;
        console.log(`DEBUG - ${getPlayerName(vote.playerId)} gets 3 points for correct author guess`);
      }
    });
    
    // Track the winners for each category
    let conceptVotes: Record<string, number> = {};
    let deliveryVotes: Record<string, number> = {};
    
    // B - Award 1 point to players who received "Best Concept" votes
    playerVotes.forEach(vote => {
      // Find the player who wrote the voted concept
      const conceptDescription = descriptions.find(d => d.assignedPlayerId === vote.bestConceptDescId);
      
      if (conceptDescription) {
        const writerId = conceptDescription.playerId;
        scores[writerId] = (scores[writerId] || 0) + 1;
        
        // Track votes for the concept award
        conceptVotes[writerId] = (conceptVotes[writerId] || 0) + 1;
        
        console.log(`DEBUG - ${getPlayerName(writerId)} gets 1 point for Best Concept vote from ${getPlayerName(vote.playerId)}`);
      }
    });
    
    // C - Award 1 point for "Best Delivery" votes
    playerVotes.forEach(vote => {
      scores[vote.bestDeliveryPlayerId] = (scores[vote.bestDeliveryPlayerId] || 0) + 1;
      
      // Track votes for the delivery award
      deliveryVotes[vote.bestDeliveryPlayerId] = (deliveryVotes[vote.bestDeliveryPlayerId] || 0) + 1;
      
      console.log(`DEBUG - ${getPlayerName(vote.bestDeliveryPlayerId)} gets 1 point for Best Delivery vote from ${getPlayerName(vote.playerId)}`);
    });
    
    // Determine the winners of each category
    let bestConceptWinnerId: string | null = null;
    let bestDeliveryWinnerId: string | null = null;
    
    // Find the Best Concept winner
    let maxConceptVotes = 0;
    Object.entries(conceptVotes).forEach(([playerId, voteCount]) => {
      if (voteCount > maxConceptVotes) {
        maxConceptVotes = voteCount;
        bestConceptWinnerId = playerId;
      }
    });
    
    // Find the Best Delivery winner
    let maxDeliveryVotes = 0;
    Object.entries(deliveryVotes).forEach(([playerId, voteCount]) => {
      if (voteCount > maxDeliveryVotes) {
        maxDeliveryVotes = voteCount;
        bestDeliveryWinnerId = playerId;
      }
    });
    
    console.log('DEBUG - Final scores and awards:', {
      scores,
      bestConceptWinner: bestConceptWinnerId ? getPlayerName(bestConceptWinnerId) : 'none',
      bestDeliveryWinner: bestDeliveryWinnerId ? getPlayerName(bestDeliveryWinnerId) : 'none'
    });
    
    // Update state with all results
    setPlayerScores(scores);
    setBestConceptWinner(bestConceptWinnerId);
    setBestDeliveryWinner(bestDeliveryWinnerId);
    
    // Send a preliminary host update with originator info
    await channelRef.current.send({
      type: 'broadcast',
      event: 'host_update',
      payload: { 
        hostId: originalHostId, // Always use original host
        originalHostId,
        forcedUpdate: true,
        fromPlayerId: playerId, // Track who sent this update
        fromFunction: 'handleShowResults'
      }
    });
    
    console.log('DEBUG - Original host sent forced host update before phase change to results');
    
    // Add to the existing code - force host update before phase change
    if (channelRef.current) {
      try {
        // First send a host update to keep host consistent during transition
        await channelRef.current.send({
          type: 'broadcast',
          event: 'host_update',
          payload: { 
            hostId: originalHostIdRef.current,
            originalHostId: originalHostIdRef.current,
            forcedUpdate: true,
            fromFunction: 'handleShowResults_pre',
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Original host sent forced host update before phase change to results');
        
        // Now send phase change
        await channelRef.current.send({
          type: 'broadcast',
          event: 'game_phase_change',
          payload: { 
            phase: 'results',
            preserveHost: true,
            preservedHostId: originalHostIdRef.current,
            playerCount: players.length,
            scores: playerScores,
            bestConceptWinner: bestConceptWinnerId,
            bestDeliveryWinner: bestDeliveryWinnerId,
            timestamp: Date.now()
          }
        });
        
        console.log('DEBUG - CRITICAL - Original host sent phase change to results with preserved host');
        
        // Update game phase locally for responsiveness
        setGamePhase('results');
      } catch (error) {
        console.error('DEBUG - CRITICAL - Error showing results:', error);
        preservingHostRef.current = false; // Reset on error
      }
    }
    
    // Reset preservation flag after a delay
    setTimeout(() => {
      preservingHostRef.current = false;
      console.log('DEBUG - CRITICAL - Reset preservationFlag after showing results');
    }, 10000); // Use 10 second timer
  };

  // Add validation to the player vote submission
  const handleSubmitVotes = async () => {
    console.log('DEBUG - CRITICAL - Submitting votes:', {
      guessAuthorId,
      bestConceptDescId,
      bestDeliveryPlayerId,
      isHost,
      originalHostId: originalHostIdRef.current,
      isOriginalHost: playerId === originalHostIdRef.current
    });
    
    if (!channelRef.current) {
      console.error('DEBUG - CRITICAL - Channel not available for vote submission');
      return;
    }
    
    // Validate that all votes were made
    if (!guessAuthorId || !bestConceptDescId || !bestDeliveryPlayerId) {
      console.log('DEBUG - CRITICAL - Invalid votes - missing required selections:', {
        guessAuthorId: !!guessAuthorId,
        bestConceptDescId: !!bestConceptDescId,
        bestDeliveryPlayerId: !!bestDeliveryPlayerId
      });
      
      alert('Please select a choice for each category before submitting.');
      return;
    }
    
    try {
      // Set preservation flag during vote submission
      preservingHostRef.current = true;
      console.log('DEBUG - CRITICAL - Setting preservation flag during vote submission');
      
      // Send votes
      await channelRef.current.send({
        type: 'broadcast',
        event: 'player_vote',
        payload: { 
          playerId,
          guessAuthorId,
          bestConceptDescId,
          bestDeliveryPlayerId,
          timestamp: Date.now()
        }
      });
      
      // Update player status
      await broadcastAndSyncPlayerStatus('ready');
      
      // Original host should check if all players are ready
      if (playerId === originalHostIdRef.current) {
        // Check if all players are ready
        setTimeout(() => {
          const allPlayersReady = players.every(player => 
            player.status === 'ready' || player.id === playerId
          );
          
          console.log('DEBUG - CRITICAL - Original host checking if all players are ready after votes:', {
            allPlayersReady,
            playerStatuses: players.map(p => ({ name: p.name, status: p.status }))
          });
          
          if (allPlayersReady) {
            console.log('DEBUG - CRITICAL - All players ready, original host auto-showing results');
            handleShowResults();
          } else {
            console.log('DEBUG - CRITICAL - Waiting for more players to submit votes');
            
            // Set up an interval to check until all players are ready
            const checkInterval = setInterval(() => {
              const allNowReady = players.every(player => 
                player.status === 'ready' || player.id === playerId
              );
              
              console.log('DEBUG - CRITICAL - Rechecking player readiness:', {
                allNowReady,
                playerStatuses: players.map(p => ({ name: p.name, status: p.status }))
              });
              
              if (allNowReady) {
                console.log('DEBUG - CRITICAL - All players now ready, showing results');
                clearInterval(checkInterval);
                handleShowResults();
              }
            }, 2000); // Check every 2 seconds
            
            // Set a cleanup timeout (30 seconds max wait)
            setTimeout(() => {
              clearInterval(checkInterval);
              // Reset preservation flag in case we never reached all ready
              if (preservingHostRef.current) {
                preservingHostRef.current = false;
                console.log('DEBUG - CRITICAL - Forced reset of preservation flag after timeout');
              }
            }, 30000);
          }
        }, 1000);
      } else {
        // Non-original host players should reset their flag after a delay
        setTimeout(() => {
          preservingHostRef.current = false;
          console.log('DEBUG - CRITICAL - Reset preservation flag after vote submission');
        }, 2000);
      }
      
      setHasVoted(true);
      
    } catch (error) {
      console.error('DEBUG - CRITICAL - Error submitting votes:', error);
      preservingHostRef.current = false; // Reset on error
    }
  };

  // Add a tracking function to keep player counts in sync
  const broadcastAndSyncPlayerStatus = async (status: 'ready' | 'writing' | 'guessing') => {
    console.log('DEBUG - CRITICAL - Broadcasting player status:', {
      myId: playerId,
      myName: username,
      newStatus: status,
      currentPhase: gamePhase,
      hasSubmitted: status === 'ready' && gamePhase === 'description' ? hasSubmitted : 'n/a'
    });
    
    // Enhanced validation for status changes based on game phase
    if (gamePhase === 'description') {
      // In description phase, only allow 'ready' if player has submitted
      if (status === 'ready' && !hasSubmitted) {
        console.log('DEBUG - CRITICAL - Preventing invalid ready status in description phase without submission');
        return; // Don't allow ready status without submission
      }
      
      // Default status for description phase should be 'writing' if not ready
      if (status !== 'ready') {
        status = 'writing';
      }
    } 
    else if (gamePhase === 'guessing') {
      // In guessing phase, only allow 'ready' if player has submitted guesses
      if (status === 'ready' && !submittedGuesses) {
        console.log('DEBUG - CRITICAL - Correcting status in guessing phase');
        status = 'guessing'; // Force correct status
      }
    }
    
    if (!channelRef.current) {
      console.error('DEBUG - CRITICAL - Channel not available for status broadcast');
      return;
    }
    
    // Create a status object for consistent updates
    const statusUpdate = { 
      playerId,
      status,
      timestamp: Date.now(),
      gamePhase,
      validated: true
    };
    
    try {
      // First broadcast status change to all players
      await channelRef.current.send({
        type: 'broadcast',
        event: 'player_status_change',
        payload: statusUpdate
      });
      
      // Then update local presence
      await channelRef.current.track({ 
        id: playerId, 
        name: username,
        joinedAt: Date.now(),
        status
      });
      
      // Also update local player list
      setPlayers(prevPlayers => 
        prevPlayers.map(player => 
          player.id === playerId 
            ? { ...player, status } 
            : player
        )
      );
      
      // Add additional validation for critical phases
      if ((gamePhase === 'description' && status === 'ready') || 
          (gamePhase === 'guessing' && status === 'ready')) {
        
        // Double-check if my status was updated correctly
        setTimeout(() => {
          const myCurrentStatus = players.find(p => p.id === playerId)?.status;
          
          if (myCurrentStatus !== status && channelRef.current) {
            console.log('DEBUG - CRITICAL - Status validation failed, resending:', {
              expected: status,
              actual: myCurrentStatus
            });
            
            // Resend status update
            channelRef.current.send({
              type: 'broadcast',
              event: 'player_status_change',
              payload: {
                ...statusUpdate,
                isRetry: true
              }
            }).catch((err: Error) => console.error('Status retry failed:', err));
          }
        }, 1000);
      }
      
    } catch (err: any) {
      console.error('DEBUG - CRITICAL - Error broadcasting status:', err);
      
      // Retry after a short delay on failure
      setTimeout(() => {
        if (channelRef.current) {
          console.log('DEBUG - CRITICAL - Retrying status broadcast after error');
          channelRef.current.send({
            type: 'broadcast',
            event: 'player_status_change',
            payload: {
              ...statusUpdate,
              isErrorRetry: true
            }
          }).catch((err: Error) => console.error('Status error retry failed:', err));
        }
      }, 500);
    }
  };

  // Fix the useEffect to eliminate TypeScript error and correctly handle assignments
  useEffect(() => {
    if (playerAssignments.length > 0) {
      const myAssignment = playerAssignments.find(
        (assignment: PlayerAssignment) => assignment.playerId === playerId
      );
      
      console.log('DEBUG - CRITICAL - Current assignments:', {
        myId: playerId,
        assignedPlayer: assignedPlayer ? {id: assignedPlayer.id, name: assignedPlayer.name} : 'none',
        hasMyAssignment: !!assignedPlayer,
        gamePhase,
        allAssignments: playerAssignments.length,
        myAssignmentFound: !!myAssignment
      });
      
      // If we have an assignment but no assigned player, try to set it
      if (myAssignment && !assignedPlayer && players.length > 0) {
        const foundPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
        if (foundPlayer) {
          console.log('DEBUG - CRITICAL - Setting assigned player from effect:', foundPlayer.name);
          setAssignedPlayer(foundPlayer);
        }
      }
    }
  }, [assignedPlayer, playerAssignments, playerId, gamePhase, players]);

  // Fix the description phase UI to show loading correctly and handle assignment state
  const renderDescriptionPhase = () => {
    // If we don't have an assignment yet, show loading state
    if (!assignedPlayer) {
      console.log('DEBUG - CRITICAL - No assignment yet, showing loading state');
      // Try to find assignment and set it if available
      const myAssignment = playerAssignments.find(
        (assignment: PlayerAssignment) => assignment.playerId === playerId
      );
      
      if (myAssignment) {
        console.log('DEBUG - CRITICAL - Found assignment, looking for player:', myAssignment.assignedPlayerId);
        const foundPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
        if (foundPlayer) {
          console.log('DEBUG - CRITICAL - Found assigned player from render function:', foundPlayer.name);
          // Use setTimeout to avoid state updates during render
          setTimeout(() => setAssignedPlayer(foundPlayer), 0);
        }
      }
      
      return (
        <div className="p-4 max-w-md mx-auto bg-white rounded-xl shadow-md">
          <h2 className="text-xl font-bold mb-4">Write a character description for:</h2>
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          </div>
          <p className="text-gray-500 mt-2">Waiting for assignments...</p>
        </div>
      );
    }
    
    // Rest of the existing description phase UI
    return (
      <div className="p-4 max-w-md mx-auto bg-white rounded-xl shadow-md">
        <h2 className="text-xl font-bold mb-4">Write a character description for:</h2>
        <div className="mb-4 p-2 bg-blue-100 rounded">
          <p className="font-semibold">{assignedPlayer?.name}</p>
        </div>
        <div className="mb-2">
          <p className="text-sm text-gray-600 mb-1">Your description will be used to generate {assignedPlayer?.name}'s script.</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-32 p-2 border rounded focus:ring focus:ring-blue-300"
            placeholder="Describe their character (personality, quirks, motivation, etc.)"
            disabled={hasSubmitted}
          />
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {hasSubmitted ? "Description submitted" : ""}
          </span>
          <button
            onClick={handleSubmitDescription}
            disabled={!description.trim() || hasSubmitted}
            className={`px-4 py-2 rounded ${
              !description.trim() || hasSubmitted
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {hasSubmitted ? "Submitted" : "Submit"}
          </button>
        </div>
        <div className="mt-4">
          <p className="text-xs text-gray-500">
            <em>⭐ Tip: Best Character Concept vote goes to the most creative description!</em>
          </p>
        </div>
      </div>
    );
  };

  // Reading phase UI
  if (gamePhase === 'reading') {
    // Generate a title for the script based on game settings
    const scriptTitle = `A ${gameSettings.tone} Adventure at the ${gameSettings.scene}`;
    
    return (
      <main className="h-screen flex flex-col items-center p-6 bg-gray-50">
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-amber-100 text-amber-800 rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-amber-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-red-100 text-red-800 rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-5 text-gray-800 text-center">
            The Script
          </h2>
          
          {/* Instructions for all users */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
            <p className="text-blue-700">
              {isHost 
                ? "Read the script together with your group. When everyone is done, click the button below."
                : "Read the script together. The host will move everyone to the guessing phase when ready."}
            </p>
          </div>
          
          {/* Tip about Best Line Delivery */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-amber-700 flex items-center justify-center">
              <span className="mr-2">💡</span>
              <span><strong>Tip:</strong> Project your lines—Best Line Delivery gets a point!</span>
            </p>
          </div>
          
          {/* Script title */}
          <h3 className="text-xl font-bold mb-4 text-center text-indigo-700 italic">
            "{scriptTitle}"
          </h3>
          
          <div className="p-6 bg-gray-100 rounded-lg mb-6 whitespace-pre-wrap font-serif text-lg leading-relaxed border border-gray-300 max-h-[500px] overflow-y-auto shadow-inner">
            {generatedScript ? (
              generatedScript.split('\n\n').map((section, index) => {
                // Format different parts of the script with better styling
                if (section.startsWith('NARRATOR:')) {
                  return (
                    <div key={index} className="mb-6 italic text-gray-900 bg-blue-50 p-3 rounded border border-blue-100">
                      {section}
                    </div>
                  );
                } else if (section.startsWith('[')) {
                  return (
                    <div key={index} className="mb-4 text-sm uppercase tracking-wider text-gray-800 font-semibold bg-gray-200 p-2 rounded">
                      {section}
                    </div>
                  );
                } else if (section.includes(':')) {
                  const [character, dialogue] = section.split(':', 2);
                  return (
                    <div key={index} className="mb-6 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                      <div className="font-bold text-blue-800 mb-1">{character}:</div>
                      <div className="text-gray-900 pl-4">{dialogue}</div>
                    </div>
                  );
                } else {
                  return (
                    <div key={index} className="mb-6 text-gray-900 bg-white p-3 rounded border border-gray-200">
                      {section}
                    </div>
                  );
                }
              })
            ) : (
              <div className="text-center text-gray-700 p-10">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
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
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text">
            PlotTwist
          </h1>
        </Link>
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
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-4">
            PlotTwist
          </h1>
        </Link>
        <div className="text-xl">Connecting to game...</div>
      </main>
    );
  }

  // Description phase rendering
  if (gamePhase === 'description') {
    return (
      <main className="h-screen flex flex-col lg:flex-row items-start p-6 bg-gray-50">
        <div className="w-full lg:w-2/3 lg:pr-6">
          <Link href="/" className="transition-transform hover:scale-105 inline-block">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
              PlotTwist
            </h1>
          </Link>
          
          {/* Connection status indicator */}
          {isReconnecting && (
            <div className="w-full mb-4 p-3 bg-amber-100 text-amber-800 rounded-lg flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-amber-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Reconnecting to game...</span>
            </div>
          )}
          
          {!isConnected && !isReconnecting && (
            <div className="w-full mb-4 p-3 bg-red-100 text-red-800 rounded-lg flex items-center justify-center">
              <span className="mr-2">⚠️</span>
              <span>Connection lost! Please refresh the page if this persists.</span>
            </div>
          )}
          
          <div className="w-full bg-white rounded-xl shadow-lg p-8 mb-6">
            <h2 className="text-2xl font-semibold mb-5 text-gray-800">
              Write a character description for:
            </h2>
            
            {renderDescriptionPhase()}
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
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-amber-100 text-amber-800 rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-amber-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-red-100 text-red-800 rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold mb-2 text-gray-800 text-center">
            Voting Time!
          </h2>
          
          <p className="text-gray-700 mb-6 text-center">
            Vote for your favorite performances and guess who wrote your character.
          </p>
          
          {/* Section A: Who wrote your description? */}
          <div className="mb-8 bg-blue-50 rounded-lg p-6 border-2 border-blue-100">
            <h3 className="text-xl font-bold text-blue-800 mb-4 flex items-center">
              <span className="bg-blue-200 text-blue-800 w-8 h-8 rounded-full flex items-center justify-center mr-3">
                A
              </span>
              <span>Who wrote YOUR character description?</span>
            </h3>
            
            <div className="mb-2 text-gray-700">
              <p>Your character: <span className="font-semibold">{username}</span></p>
            </div>
            
            <select
              value={guessAuthorId}
              onChange={(e) => setGuessAuthorId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border rounded-lg text-lg ${
                submittedGuesses ? 'bg-gray-100' : 'bg-white'
              }`}
            >
              <option value="">Select who you think wrote your description...</option>
              {players
                .filter(p => p.id !== playerId) // Can't select yourself
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && guessAuthorId && (
              <div className="mt-3 text-green-700 font-medium flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You guessed: {getPlayerName(guessAuthorId)}
              </div>
            )}
          </div>
          
          {/* Section B: Best Character Concept */}
          <div className="mb-8 bg-amber-50 rounded-lg p-6 border-2 border-amber-100">
            <h3 className="text-xl font-bold text-amber-800 mb-4 flex items-center">
              <span className="bg-amber-200 text-amber-800 w-8 h-8 rounded-full flex items-center justify-center mr-3">
                B
              </span>
              <span>Best Character Concept</span>
            </h3>
            
            <p className="mb-4 text-gray-700">
              Vote for the most creative character concept in the story.
            </p>
            
            <select
              value={bestConceptDescId}
              onChange={(e) => setBestConceptDescId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border rounded-lg text-lg ${
                submittedGuesses ? 'bg-gray-100' : 'bg-white'
              }`}
            >
              <option value="">Select a character...</option>
              {players
                .filter(p => p.id !== playerId) // Can't vote for yourself
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && bestConceptDescId && (
              <div className="mt-3 text-green-700 font-medium flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You voted for: {getPlayerName(bestConceptDescId)}
              </div>
            )}
          </div>
          
          {/* Section C: Best Line Delivery */}
          <div className="mb-8 bg-purple-50 rounded-lg p-6 border-2 border-purple-100">
            <h3 className="text-xl font-bold text-purple-800 mb-4 flex items-center">
              <span className="bg-purple-200 text-purple-800 w-8 h-8 rounded-full flex items-center justify-center mr-3">
                C
              </span>
              <span>Best Line Delivery</span>
            </h3>
            
            <p className="mb-4 text-gray-700">
              Who had the best delivery during the table read?
            </p>
            
            <select
              value={bestDeliveryPlayerId}
              onChange={(e) => setBestDeliveryPlayerId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border rounded-lg text-lg ${
                submittedGuesses ? 'bg-gray-100' : 'bg-white'
              }`}
            >
              <option value="">Select an actor...</option>
              {players
                .filter(p => p.id !== playerId) // Can't vote for yourself
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && bestDeliveryPlayerId && (
              <div className="mt-3 text-green-700 font-medium flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You voted for: {getPlayerName(bestDeliveryPlayerId)}
              </div>
            )}
          </div>
          
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleSubmitVotes}
              disabled={submittedGuesses || !guessAuthorId || !bestConceptDescId || !bestDeliveryPlayerId}
              className={`px-10 py-4 rounded-lg text-lg font-bold shadow-lg transition-all transform hover:scale-105 ${
                submittedGuesses || !guessAuthorId || !bestConceptDescId || !bestDeliveryPlayerId
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
              }`}
            >
              {submittedGuesses ? (
                <div className="flex items-center">
                  <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Votes Submitted
                </div>
              ) : (
                'Submit Votes'
              )}
            </button>
          </div>
          
          {(!guessAuthorId || !bestConceptDescId || !bestDeliveryPlayerId) && !submittedGuesses && (
            <p className="text-center text-amber-600 mt-4">
              You need to complete all three sections before submitting
            </p>
          )}
        </div>
        
        <div className="w-full max-w-4xl bg-white rounded-lg p-4 shadow">
          <h3 className="text-lg font-semibold mb-3 text-gray-700">Players Status</h3>
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
                <div className={`mt-2 text-center text-sm px-2 py-1 rounded-full 
                  ${player.status === 'ready' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-amber-100 text-amber-800'}`}
                >
                  {player.status === 'ready' ? 'Ready' : 'Voting'}
                </div>
              </div>
            ))}
          </div>
          {isOriginalHost && players.every(p => p.status === 'ready') && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
              <p className="text-green-700 font-medium">All players have submitted their votes!</p>
              <button
                onClick={handleShowResults}
                className="mt-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Show Results
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }
  
  // Results phase UI
  if (gamePhase === 'results') {
    return (
      <main className="h-screen flex flex-col items-center p-6 bg-gray-50">
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-amber-100 text-amber-800 rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-amber-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-red-100 text-red-800 rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-8 mb-6">
          <h2 className="text-3xl font-bold mb-4 text-gray-800 text-center">
            Game Results
          </h2>
          
          <div className="mb-8 p-4 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-center">
            <div className="text-indigo-800 text-lg">
              Thanks for playing PlotTwist! Who will win the awards?
            </div>
          </div>
          
          <div className="space-y-10">
            {/* Player Scoreboard */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
              <h3 className="text-2xl font-bold mb-6 text-indigo-800 text-center">
                Final Scores
              </h3>
              
              <div className="overflow-hidden">
                {/* Sort players by score in descending order */}
                {players
                  .slice()
                  .sort((a, b) => (playerScores[b.id] || 0) - (playerScores[a.id] || 0))
                  .map((player, index) => {
                    const score = playerScores[player.id] || 0;
                    const maxScore = Math.max(...Object.values(playerScores));
                    const percentWidth = maxScore > 0 ? (score / maxScore) * 100 : 0;
                    const isWinner = index === 0 && score > 0;
                    
                    return (
                      <div 
                        key={player.id} 
                        className={`mb-4 relative ${
                          player.id === playerId ? 'bg-blue-50 rounded-lg p-2' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center">
                            {isWinner && (
                              <span className="text-2xl mr-2" title="Winner">👑</span>
                            )}
                            <span className={`font-bold text-lg ${player.id === playerId ? 'text-blue-700' : 'text-gray-800'}`}>
                              {player.name}
                              {player.id === playerId && <span className="ml-1 text-sm">(You)</span>}
                            </span>
                            {/* Award icons */}
                            {player.id === bestConceptWinner && (
                              <span className="ml-2 text-lg" title="Best Character Concept">🏆</span>
                            )}
                            {player.id === bestDeliveryWinner && (
                              <span className="ml-2 text-lg" title="Best Line Delivery">🎭</span>
                            )}
                          </div>
                          <div className="font-bold text-xl">
                            {score} pts
                          </div>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div 
                            className={`h-3 rounded-full ${
                              isWinner 
                                ? 'bg-gradient-to-r from-yellow-400 to-yellow-500' 
                                : player.id === playerId
                                  ? 'bg-blue-500'
                                  : 'bg-indigo-500'
                            }`}
                            style={{ width: `${percentWidth}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
            
            {/* Awards Section */}
            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-6 border border-amber-100">
              <h3 className="text-2xl font-bold mb-6 text-amber-800 text-center">Special Awards</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Best Character Concept Award */}
                <div className="bg-white rounded-lg shadow-sm p-5 transition-all border border-amber-200">
                  <div className="flex items-center mb-4">
                    <span className="text-3xl mr-3">🏆</span>
                    <h4 className="text-xl font-bold text-amber-800">Best Character Concept</h4>
                  </div>
                  
                  {bestConceptWinner ? (
                    <div className="flex items-center justify-center p-4 bg-amber-50 rounded-lg">
                      <span className="text-2xl font-bold text-amber-700">{getPlayerName(bestConceptWinner)}</span>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 italic p-4">
                      No winner
                    </div>
                  )}
                </div>
                
                {/* Best Line Delivery Award */}
                <div className="bg-white rounded-lg shadow-sm p-5 transition-all border border-amber-200">
                  <div className="flex items-center mb-4">
                    <span className="text-3xl mr-3">🎭</span>
                    <h4 className="text-xl font-bold text-amber-800">Best Line Delivery</h4>
                  </div>
                  
                  {bestDeliveryWinner ? (
                    <div className="flex items-center justify-center p-4 bg-amber-50 rounded-lg">
                      <span className="text-2xl font-bold text-amber-700">{getPlayerName(bestDeliveryWinner)}</span>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 italic p-4">
                      No winner
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {isOriginalHost && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={handlePlayAgain}
                className="px-10 py-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
              >
                Play Again
              </button>
            </div>
          )}
          
          {!isOriginalHost && (
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
      {/* Connection status indicator - place at the top */}
      {(isReconnecting || !isConnected) && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 p-3 rounded-lg z-50 ${
          isReconnecting ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className="flex items-center">
            {isReconnecting ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-amber-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Reconnecting to game...</span>
              </>
            ) : (
              <>
                <span className="mr-2">⚠️</span>
                <span>Connection lost! Please refresh the page if this persists.</span>
              </>
            )}
          </div>
        </div>
      )}
      
      <div className="flex items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <Link href="/" className="transition-transform hover:scale-105">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 text-transparent bg-clip-text">
              PlotTwist
            </h1>
          </Link>
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
