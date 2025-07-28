import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { supa } from "../../lib/supa";
import Link from "next/link";
import React from "react";
import DarkModeToggle from "../../components/DarkModeToggle";
import { getRoomChannel, emit, on, attachDebugLogger } from "../../lib/realtime";

type Player = { id: string; name: string; joinedAt: number; status: 'ready' | 'writing' | 'guessing'; seatNumber?: number };
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

// Debug helper for status flow
const dbg = (
  tag: string,
  info: Record<string, unknown>
) => console.log(
  `%cSTATUS0FLOW %s`,
  'color:#8A2BE2;font-weight:bold;',
  tag,
  info
);

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
  const [guessSubmittedPlayerIds, setGuessSubmittedPlayerIds] = useState<string[]>([]);
  const [gameSettings, setGameSettings] = useState<GameSettings>({
    tone: 'Funny',
    scene: 'Party',
    length: 'Short'
  });
  const [generatedScript, setGeneratedScript] = useState<string>("");
  const [scriptTitle, setScriptTitle] = useState<string>("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptGenerationError, setScriptGenerationError] = useState(false);
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
  const [playAgainDisabled, setPlayAgainDisabled] = useState(false);
  
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
  const lastSeatAssignmentRef = useRef<number>(0);
  const seatAssignmentAttemptsRef = useRef<number>(0);
  const navigationInProgressRef = useRef<boolean>(false);
  const reconnectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track the original host ID in a ref to prevent it changing due to race conditions
  const originalHostIdRef = useRef<string | null>(null);
  
  // Refs to track previous state values
  const prevHasSubmittedRef = useRef<boolean>(false);
  const prevSubmittedGuessesRef = useRef<boolean>(false);
  const prevHasVotedRef = useRef<boolean>(false);
  
  // Function to return to home screen
  const handleReturnHome = () => {
    console.log('DEBUG - NAVIGATION - Returning to home screen');
    
    // Set navigation flag to prevent reconnection attempts during navigation
    navigationInProgressRef.current = true;
    console.log('INFO: Navigation flag set to prevent reconnection during return to home');
    
    // Clean up channel connection
    if (channelRef.current) {
      try {
        // First leave the channel properly
        channelRef.current.unsubscribe();
        console.log('DEBUG - Successfully unsubscribed from channel before navigation');
      } catch (error) {
        console.error('DEBUG - Error unsubscribing from channel:', error);
      }
      
      // Clear the channel reference
      channelRef.current = null;
    }
    
    // Clean up any intervals
    if (reconnectionIntervalRef.current) {
      clearInterval(reconnectionIntervalRef.current);
      reconnectionIntervalRef.current = null;
      console.log('DEBUG - Cleaned up reconnection interval');
    }
    
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
      console.log('DEBUG - Cleaned up ping interval');
    }
    
    // Clear session storage
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(`username_${slug}`);
      sessionStorage.removeItem(`originalHost_${slug}`);
      sessionStorage.removeItem(`autoRestore_${slug}`);
      console.log('DEBUG - Cleaned up session storage before navigation');
    }
    
    // Use shallow routing to prevent history stacking
    router.push('/', undefined, { shallow: true });
  };
  
  // Effect to broadcast ready status after hasSubmitted changes - with improved state tracking
  useEffect(() => {
    console.log('DEBUG - CRITICAL - useEffect[hasSubmitted, gamePhase] triggered:', {
      hasSubmitted,
      gamePhase,
      prevHasSubmittedRef: prevHasSubmittedRef.current
    });
    
    // Only fire when hasSubmitted transitions from false to true, not on initial mount or phase changes
    if (gamePhase === 'description' && hasSubmitted && !prevHasSubmittedRef.current) {
      console.log('DEBUG - CRITICAL - Broadcasting ready status from useEffect after hasSubmitted CHANGED from false to true');
      broadcastAndSyncPlayerStatus('ready');
    }
    // Update ref for next comparison
    prevHasSubmittedRef.current = hasSubmitted;
  }, [hasSubmitted, gamePhase]);

  // Effect to broadcast ready status after submittedGuesses changes - with improved state tracking
  useEffect(() => {
    console.log('DEBUG - CRITICAL - useEffect[submittedGuesses, gamePhase] triggered:', {
      submittedGuesses,
      gamePhase,
      prevSubmittedGuessesRef: prevSubmittedGuessesRef.current
    });
    
    // Only fire when submittedGuesses transitions from false to true
    if (gamePhase === 'guessing' && submittedGuesses && !prevSubmittedGuessesRef.current) {
      console.log('DEBUG - CRITICAL - Broadcasting ready status from useEffect after submittedGuesses CHANGED from false to true');
      broadcastAndSyncPlayerStatus('ready');
    }
    // Update ref for next comparison
    prevSubmittedGuessesRef.current = submittedGuesses;
  }, [submittedGuesses, gamePhase]);
  
  // Effect to broadcast ready status after voting - with improved state tracking
  useEffect(() => {
    console.log('DEBUG - CRITICAL - useEffect[hasVoted, gamePhase] triggered:', {
      hasVoted,
      gamePhase,
      prevHasVotedRef: prevHasVotedRef.current
    });
    
    // Only fire when hasVoted transitions from false to true
    if (gamePhase === 'results' && hasVoted && !prevHasVotedRef.current) {
      console.log('DEBUG - CRITICAL - Broadcasting ready status from useEffect after hasVoted CHANGED from false to true');
      broadcastAndSyncPlayerStatus('ready');
    }
    // Update ref for next comparison
    prevHasVotedRef.current = hasVoted;
  }, [hasVoted, gamePhase]);
  
  // Reset refs when phase changes
  useEffect(() => {
    // Reset state tracking refs on phase change
    if (gamePhase === 'description') {
      prevHasSubmittedRef.current = false;
    } else if (gamePhase === 'guessing') {
      prevSubmittedGuessesRef.current = false;
    } else if (gamePhase === 'results') {
      prevHasVotedRef.current = false;
    }
  }, [gamePhase]);

  // Add a specific effect to handle lobby to description transitions properly
  useEffect(() => {
    // Only focus on lobbby -> description transition
    if (gamePhase === 'description') {
      console.log('DEBUG - CRITICAL - Detected transition to description phase');
      
      // If we don't have assignments set, but there are players, request a recovery
      setTimeout(() => {
        if (playerAssignments.length === 0 && players.length > 0 && playerId !== hostId && channelRef.current) {
          console.log('DEBUG - CRITICAL - Missing assignments in description phase, requesting recovery');
          channelRef.current.send({
            type: 'broadcast',
            event: 'request_assignment_recovery',
            payload: { 
              requestingPlayerId: playerId,
              timestamp: Date.now()
            }
          });
        }
      }, 2000); // Give time for normal flow to complete
    }
  }, [gamePhase, playerAssignments.length, players.length, playerId, hostId]);
  
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
      
      // Set navigation flag to prevent reconnection attempts during unmount
      navigationInProgressRef.current = true;
      console.log('INFO: Cleanup on component unmount, navigation flag set');
      
      // Clean up channel connection
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
          console.log('DEBUG - Cleaning up channel and intervals in main useEffect');
        } catch (error) {
          console.error('DEBUG - Error unsubscribing from channel during cleanup:', error);
        }
        // Clear the reference
        channelRef.current = null;
      }
      
      // Clean up interval timers
      if (reconnectionIntervalRef.current) {
        clearInterval(reconnectionIntervalRef.current);
        reconnectionIntervalRef.current = null;
      }
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      
      console.log('DEBUG - Cleaning up channel and intervals');
      
      // Clean up all session storage keys related to this room
      sessionStorage.removeItem(`username_${slug}`);
      sessionStorage.removeItem(`originalHost_${slug}`);
      sessionStorage.removeItem(`autoRestore_${slug}`);
      
      console.log('DEBUG - PLAY_AGAIN - Cleaned up session storage on component unmount');
    };
  }, [slug]);
  
  // Check for saved username from Play Again reload and auto-submit
  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    
    try {
      // Prevent multiple auto-submits by using a flag in session storage
      const hasAutoRestoreFlag = sessionStorage.getItem(`autoRestore_${slug}`);
      if (hasAutoRestoreFlag === 'true') {
        console.log('DEBUG - PLAY_AGAIN - Already performed auto-restore for this session, skipping');
        return;
      }
      
      const playAgainUsername = sessionStorage.getItem(`username_${slug}`);
      
      if (playAgainUsername) {
        console.log('DEBUG - PLAY_AGAIN - Found saved username after reload:', playAgainUsername);
        
        // Set flag to prevent multiple auto-restores
        sessionStorage.setItem(`autoRestore_${slug}`, 'true');
        
        // Set both username states
        setUsername(playAgainUsername);
        setTempUsername(playAgainUsername);
        
        // Auto-submit after a short delay to allow component setup
        setTimeout(() => {
          console.log('DEBUG - PLAY_AGAIN - Auto-submitting username to rejoin room');
          handleUsernameSubmit();
          
          // Remove the username from session storage to prevent future auto-restores
          sessionStorage.removeItem(`username_${slug}`);
        }, 500);
      }
    } catch (error) {
      // Even on error, make sure we clean up to prevent infinite loops
      console.error('DEBUG - PLAY_AGAIN - Error during auto-restore, cleaning up:', error);
      sessionStorage.removeItem(`username_${slug}`);
      sessionStorage.removeItem(`autoRestore_${slug}`);
    }
  }, [slug]);
  
  // Set assigned player when playerAssignments change
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
          .maybeSingle();
        
        if (error) {
          console.error('DEBUG - Error fetching room state:', error);
          return;
        }
        
        if (roomState) {
          console.log('DEBUG - Found existing room state:', roomState);
          
          // Set original host ID from database
          setOriginalHostId(roomState.original_host_id);
          setHostId(roomState.current_host_id);
        } else {
          console.log('DEBUG - No existing room state found, creating room record');
          
          // Create a new room record
          const { data: newRoom, error: insertError } = await supa
            .from('rooms')
            .insert([{ 
              room_code: slug, 
              original_host_id: playerId, 
              current_host_id: playerId, 
              phase: 'lobby' 
            }])
            .select();

          if (insertError) {
            // Check if error is due to conflict (room already exists)
            if (insertError.code === '23505') { // Postgres unique violation
              // Room exists, just fetch it
              const { data: existingRoom, error: fetchError } = await supa
                .from('rooms')
                .select('*')
                .eq('room_code', slug)
                .maybeSingle();
              
              if (!fetchError && existingRoom) {
                console.log('DEBUG - Retrieved existing room after conflict:', existingRoom);
                setOriginalHostId(existingRoom.original_host_id);
                setHostId(existingRoom.current_host_id);
              } else {
                console.error('DEBUG - Error fetching room after conflict:', fetchError);
              }
            } else {
              console.error('DEBUG - Failed to create room:', insertError);
            }
          } else {
            console.log('DEBUG - Created room record:', newRoom?.[0]);
            if (newRoom && newRoom.length > 0) {
              setOriginalHostId(newRoom[0].original_host_id);
              setHostId(newRoom[0].current_host_id);
            }
          }
        }
      } catch (err) {
        console.error('DEBUG - Error in room state initialization:', err);
      }
    };
    
    initializeRoomState();
  }, [slug, playerId]);

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

  // Helper function to determine correct player status based on game phase and player state
  const determineCorrectStatus = (
    phase: GamePhase, 
    hasSubmitted: boolean, 
    submittedGuesses: boolean, 
    hasVoted: boolean
  ): 'ready' | 'writing' | 'guessing' => {
    console.log('DEBUG - Determining correct status for phase:', {
      phase,
      hasSubmitted,
      submittedGuesses,
      hasVoted
    });
    
    // Status hierarchy based on game phase
    switch (phase) {
      case 'description':
        // In description phase, only ready if submitted, otherwise writing
        return hasSubmitted ? 'ready' : 'writing';
        
      case 'guessing':
        // In guessing phase, only ready if guesses submitted, otherwise guessing
        return submittedGuesses ? 'ready' : 'guessing';
        
      case 'results':
        // In results phase, only ready if voted, otherwise default to ready
        return hasVoted ? 'ready' : 'ready'; // Could change second 'ready' to something else if needed
        
      case 'reading':
      case 'lobby':
      default:
        // Always ready in these phases
        return 'ready';
    }
  };

  // Improve the channel reconnection handler
  const handleChannelReconnect = async () => {
    console.log('DEBUG - CRITICAL - Channel reconnection triggered:', {
      playerId,
      username,
      gamePhase,
      players: players.length
    });
    
    // Check if we're in the middle of navigation
    if (navigationInProgressRef.current) {
      console.log('DEBUG - CRITICAL - Navigation in progress, skipping reconnection');
      return;
    }
    
    // Reset the preservation flag when reconnecting
    preservingHostRef.current = false;
    console.log('DEBUG - CRITICAL - Reset preservation flag after channel reconnection');
    
    // Check if channel exists and is ready
    if (!channelRef.current) {
      console.error('DEBUG - CRITICAL - Channel not initialized during reconnect');
      return;
    }

    try {
      console.log('DEBUG - CRITICAL - Reconnecting with gamePhase:', gamePhase);
      
      // Get seat number from local state if available
      let seatNumber: number | undefined;
      const currentPlayer = players.find(p => p.id === playerId);
      
      if (currentPlayer?.seatNumber !== undefined) {
        seatNumber = currentPlayer.seatNumber;
        console.log('DEBUG - CRITICAL - Using seat number from player state for reconnect:', seatNumber);
      } else {
        // Fetch from database as fallback
        const { data, error } = await supa
          .from('players')
          .select('seat_number')
          .eq('player_id', playerId)
          .eq('room_code', slug)
          .single();
        
        if (!error && data && data.seat_number) {
          seatNumber = data.seat_number;
          console.log('DEBUG - CRITICAL - Fetched seat number from database for reconnect:', seatNumber);
        }
      }
      
      // FIXED: Use explicit phase-based status assignment instead of helper function
      let reconnectStatus: 'ready' | 'writing' | 'guessing';
      
      if (gamePhase === 'description') {
        // In description phase, only ready if submitted
        reconnectStatus = hasSubmitted ? 'ready' : 'writing';
        console.log('DEBUG - CRITICAL - Setting reconnect status for description phase:', reconnectStatus);
      } else if (gamePhase === 'guessing') {
        // In guessing phase, only ready if guesses submitted
        reconnectStatus = submittedGuesses ? 'ready' : 'guessing';
        console.log('DEBUG - CRITICAL - Setting reconnect status for guessing phase:', reconnectStatus);
      } else {
        // For other phases, default to ready
        reconnectStatus = 'ready';
      }
      
      // Update our presence with consistent data
      await channelRef.current.track({ 
        id: playerId, 
        name: username,
        joinedAt: Date.now(),
        seatNumber,
        status: reconnectStatus
      });
      
      console.log('DEBUG - CRITICAL - Retracked presence after reconnection with status:', reconnectStatus, 'and seat number:', seatNumber);
      
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
    } catch (error) {
      console.error('DEBUG - CRITICAL - Error during channel reconnection:', error);
      // Attempt to reinitialize the channel if it failed
      if (!channelRef.current) {
        console.log('DEBUG - CRITICAL - Attempting to reinitialize channel after failed reconnect');
        initializeChannel();
      }
    }
  };

  // Fix the sortPlayersByStableId function to include return type
  const sortPlayersByStableId = (players: Player[]): Player[] => {
    return [...players].sort((a, b) => {
      // First sort by seat number if available 
      if (a.seatNumber !== undefined && b.seatNumber !== undefined) {
        return a.seatNumber - b.seatNumber;
      }
      
      // Then sort by join time as fallback
      const timeSort = a.joinedAt - b.joinedAt;
      if (timeSort !== 0) return timeSort;
      
      // Then by ID as a final fallback for stable order
      return a.id.localeCompare(b.id);
    });
  };

  // Add a memoized player list to ensure stable rendering
  const stablePlayers = React.useMemo(() => {
    // If no seat numbers are assigned, assign virtual ones based on current order
    if (players.length > 0 && players.every(p => p.seatNumber === undefined)) {
      // Sort by existing logic
      const sortedPlayers = sortPlayersByStableId([...players]);
      
      // Assign virtual seat numbers for rendering stability
      return sortedPlayers.map((player, index) => ({
        ...player,
        virtualSeatNumber: index + 1
      }));
    }
    
    // Use regular sorting if some have seat numbers
    return sortPlayersByStableId([...players]);
  }, [players]);

  // Add back the getPlayerName utility function
  const getPlayerName = (id: string | null): string => {
    if (!id) return 'Unknown';
    const player = players.find(p => p.id === id);
    return player ? player.name : 'Unknown Player';
  };

  // Add function to assign player seat number
  const assignPlayerSeatNumber = async () => {
    // Rate limiting: Only allow one call every 2 seconds, and max 5 attempts
    const now = Date.now();
    if (now - lastSeatAssignmentRef.current < 2000) {
      console.log('DEBUG - PLAY_AGAIN - Rate limiting seat assignment, too frequent');
      return;
    }
    
    // Track attempts to prevent infinite loops
    seatAssignmentAttemptsRef.current += 1;
    if (seatAssignmentAttemptsRef.current > 5) {
      console.log('DEBUG - PLAY_AGAIN - Too many seat assignment attempts, stopping');
      return;
    }
    
    // Update timestamp for rate limiting
    lastSeatAssignmentRef.current = now;
    
    try {
      // Skip if already has a seat number
      const existingPlayer = players.find(p => p.id === playerId);
      if (existingPlayer?.seatNumber) {
        console.log('DEBUG - CRITICAL - Player already has seat number:', existingPlayer.seatNumber);
        
        // Track presence with seat number to ensure it's propagated to other clients
        if (channelRef.current) {
          await channelRef.current.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now(),
            seatNumber: existingPlayer.seatNumber,
            // STATUS REMOVED: Let phase_change handler or presence sync on other clients determine correct status
          });
          
          console.log('DEBUG - CRITICAL - Re-tracked presence with existing seat number:', existingPlayer.seatNumber);
        }
        
        return;
      }
      
      console.log('DEBUG - CRITICAL - Assigning seat number for player:', {
        playerId,
        playerName: username,
        hasExistingSeatNumber: !!existingPlayer?.seatNumber
      });
      
      // Check if player already exists in the database
      let { data: existingPlayerData, error } = await supa
        .from('players')
        .select('seat_number')
        .eq('player_id', playerId)
        .eq('room_code', slug)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('DEBUG - CRITICAL - Error checking for existing player:', error);
      }
      
      if (existingPlayerData?.seat_number) {
        console.log('DEBUG - CRITICAL - Fetched seat number from database:', existingPlayerData.seat_number);
        
        // Track presence with existing seat number
        if (channelRef.current) {
          await channelRef.current.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now(),
            seatNumber: existingPlayerData.seat_number,
            // STATUS REMOVED: Let phase_change handler or presence sync on other clients determine correct status
          });
          
          console.log('DEBUG - CRITICAL - Sent presence ping with seat number:', existingPlayerData.seat_number, '(no status)');
        }
        
        return;
      }
      
      // Find the next available seat number
      const usedSeatNumbers = players
        .filter(p => p.seatNumber !== undefined)
        .map(p => p.seatNumber as number);
      
      // Start from seat 1 and find first available
      let nextSeatNumber = 1;
      while (usedSeatNumbers.includes(nextSeatNumber)) {
        nextSeatNumber++;
      }
      
      console.log('DEBUG - CRITICAL - Next seat number:', nextSeatNumber);
      
      // Determine the correct starting status based on current game phase
      let dbStatusToInsert: 'ready' | 'writing' | 'guessing' = 'ready';
      
      try {
        // Fetch current room phase from DB
        const { data: roomData, error: roomError } = await supa
          .from('rooms')
          .select('phase')
          .eq('room_code', slug)
          .single();
          
        if (roomError) {
          console.error('DEBUG - CRITICAL - Error fetching room phase:', roomError);
        } else if (roomData?.phase) {
          console.log('DEBUG - CRITICAL - Fetched room phase for DB status in assignPlayerSeatNumber:', roomData.phase);
          
          // Set initial status based on room phase
          if (roomData.phase === 'description') {
            dbStatusToInsert = 'writing';
          } else if (roomData.phase === 'guessing') {
            dbStatusToInsert = 'guessing';
          } else {
            dbStatusToInsert = 'ready';
          }
        }
      } catch (phaseErr) {
        console.error('DEBUG - CRITICAL - Error fetching room phase:', phaseErr);
      }
      
      // Insert player record with seat number
      const { error: insertError } = await supa
        .from('players')
        .upsert({
          player_id: playerId,
          room_code: slug, 
          seat_number: nextSeatNumber,
          name: username,
          status: dbStatusToInsert // Use the determined status for DB
        });
      
      if (insertError) {
        console.error('DEBUG - CRITICAL - Error inserting player:', insertError);
        return;
      } 
        
      console.log('DEBUG - CRITICAL - Successfully assigned seat number:', nextSeatNumber, 'and inserted into DB with status:', dbStatusToInsert);
      
      // Track presence with seat number (NO STATUS FIELD)
      if (channelRef.current) {
        await channelRef.current.track({ 
          id: playerId, 
          name: username,
          joinedAt: Date.now(),
          seatNumber: nextSeatNumber
          // STATUS REMOVED: Let phase_change handler or presence sync on other clients determine initial status
        });
        
        console.log('DEBUG - CRITICAL - Updated presence with new seat number (NO STATUS):', nextSeatNumber);
      }
    } catch (err) {
      console.error('DEBUG - CRITICAL - Error in seat number assignment:', err);
    }
  };

  // Modify initializeChannel to use the stable sorting
  const initializeChannel = () => {
    if (!slug || !username || !supa) {
      console.log('DEBUG - Cannot initialize channel, missing essentials:', {
        hasSlug: !!slug,
        hasUsername: !!username,
        hasSupabase: !!supa
      });
      return null;
    }
    
    // Add a flag to prevent multiple initializations within a short period
    const lastInit = window.sessionStorage.getItem(`lastChannelInit_${slug}`);
    const now = Date.now();
    if (lastInit && (now - parseInt(lastInit, 10)) < 2000) {
      console.log('DEBUG - PLAY_AGAIN - Throttling channel initialization');
      return null;
    }
    
    // Update last initialization timestamp
    window.sessionStorage.setItem(`lastChannelInit_${slug}`, now.toString());
    
    console.log('DEBUG - CRITICAL - Initializing channel:', { 
      slug, 
      username, 
      playerId
    });
    
    // Check if we already have a channel for this room
    const existingChannel = channelRef.current;
    if (existingChannel) {
      console.log('DEBUG - Channel already exists, reusing existing channel');
      return null; // Return null since we're reusing existing channel
    }

    // Create a new channel using our wrapper
    const channel = getRoomChannel(
      typeof slug === 'string' ? slug : slug[0],
      { 
        presence: { key: playerId },
        broadcast: { self: true }
      }
    );

    // Store channel reference
    channelRef.current = channel;
    
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Player>();
        console.log('DEBUG - CRITICAL - Presence sync START:', { 
          playerCount: Object.values(state).flat().length,
          gamePhase,
          myId: playerId,
          isHost: playerId === hostId
        });
        
        const flat = Object.values(state).flat();
        
        // Create a map of existing players by ID for status preservation
        const prevPlayersMap = new Map<string, Player>();
        players.forEach(p => prevPlayersMap.set(p.id, p));
        
        // Debug presence payloads - consolidated to a single summary log
        console.log(`DEBUG - Processing ${flat.length} player presence entries with seat numbers: ${flat.filter(p => p.seatNumber !== undefined).length}/${flat.length}`);
        
        // Build summary of player statuses for logging
        const statusSummary = players.reduce((acc, player) => {
          acc[player.name] = player.status;
          return acc;
        }, {} as Record<string, string>);
        
        console.log('DEBUG - CRITICAL - Current player statuses:', statusSummary);
        
        // Remove duplicates and merge with existing player data (especially status)
        const uniquePlayers = Array.from(
          new Map(flat.map(player => {
            // Get existing player data or create default with correct initial status
            const existing = prevPlayersMap.get(player.id) || { 
              status: determineCorrectStatus(gamePhase, false, false, false)
            };
            
            // Determine the correct status to use based on our status hierarchy rules
            let statusToUse = existing.status;
            
            // Only overwrite status from presence if it represents valid game progress
            if (player.status) {
              // Status hierarchy rules:
              // 1. Never downgrade from 'ready' to 'writing' or 'guessing' through presence
              // 2. Never upgrade from 'writing' to 'ready' in description phase unless player has submitted
              // 3. Never upgrade from 'guessing' to 'ready' in guessing phase unless player has submitted guesses
              const isUpgrade = 
                (existing.status === 'writing' && player.status === 'ready') ||
                (existing.status === 'guessing' && player.status === 'ready');
              
              if (isUpgrade) {
                // Validate upgrades to ready status based on game phase
                if (gamePhase === 'description') {
                  // In description phase, only allow upgrade to ready if player has submitted
                  const hasPlayerSubmitted = submittedPlayerIds.includes(player.id);
                  if (hasPlayerSubmitted) {
                    // Valid upgrade since player has submitted
                    statusToUse = player.status;
                    console.log(`[VALID] ${player.id.slice(0, 8)} → ${player.status} (has submitted)`);
                  } else {
                    // CRITICAL FIX: Keep as writing if no submission record
                    // This is the key protection against incorrect status changes
                    console.log(`[REJECT] ${player.id.slice(0, 8)} upgrade to ${player.status} blocked (no submission in desc phase)`);
                    statusToUse = 'writing'; // Explicitly force writing status for description phase
                  }
                }
                else if (gamePhase === 'guessing') {
                  // TODO: Add similar validation for guessing phase if you track submission state for guesses
                  // For now, accept the upgrade in other phases
                  statusToUse = player.status;
                }
                else {
                  // For other phases, accept the upgrade
                  statusToUse = player.status;
                }
              }
              else if (player.status === existing.status) {
                // Same status, no change needed
                statusToUse = existing.status;
              }
              else if (existing.status === 'ready' && (player.status === 'writing' || player.status === 'guessing')) {
                // CRITICAL FIX OVERRIDE: For description phase, ALWAYS accept a writing status
                // regardless of previous status. This is necessary to fix the persistent
                // status issue at game start.
                if (gamePhase === 'description' && player.status === 'writing') {
                  console.log(`DEBUG - CRITICAL - OVERRIDE: Forcing player ${player.id} to writing status in description phase`);
                  statusToUse = 'writing';
                } else {
                  // For other phases, never downgrade from ready to writing/guessing
                  console.log(`DEBUG - CRITICAL - Preventing downgrade from ready to ${player.status} for ${player.id}`);
                  statusToUse = existing.status;
                }
              }
              else {
                // For other cases (e.g., writing→guessing), accept the new status
                statusToUse = player.status;
              }
              
              // CRITICAL FIX: Extra validation for description phase
              // Force players to remain in "writing" status during description phase unless they've submitted
              if (gamePhase === 'description' && statusToUse === 'ready') {
                const hasPlayerSubmitted = submittedPlayerIds.includes(player.id);
                if (!hasPlayerSubmitted) {
                  console.log(`DEBUG - CRITICAL - Forcing player back to writing status in description phase: ${player.id}`);
                  statusToUse = 'writing';
                }
              }
            }
            
            // Create the merged player with correct status
            const merged = { 
              ...existing, 
              ...player,
              status: statusToUse // Use the determined status
            };
            
            // Log significant status changes
            if (existing.status !== statusToUse) {
              console.log(`DEBUG - CRITICAL - Status changed for ${player.id} from ${existing.status} to ${statusToUse}`);
            }
            
            return [player.id, merged];
          })).values()
        );
        
        // Use stable sorting function
        const sortedPlayers = sortPlayersByStableId(uniquePlayers);
        console.log('DEBUG - CRITICAL - Updated player statuses:', {
          count: sortedPlayers.length,
          statuses: sortedPlayers.reduce((acc, p) => {
            acc[p.name] = p.status;
            return acc;
          }, {} as Record<string, string>)
        });
        
        setPlayers(sortedPlayers);
        
        // Only set original host if it's not already set and this is the first player
        if (!originalHostIdRef.current && sortedPlayers.length === 1 && sortedPlayers[0].id === playerId) {
          const firstPlayerId = sortedPlayers[0].id;
          console.log('DEBUG - CRITICAL - Setting first player as original host:', firstPlayerId);
          
          // Use our safe setter function
          setOriginalHostSafely(firstPlayerId);
          
          // Broadcast the original host ID to all players
          try {
            emit(channel, 'original_host_set', { originalHostId: firstPlayerId });
          } catch (err) {
            console.error('DEBUG - Error sending original host:', err);
          }
          
          // Immediately set host as well
          setHostId(firstPlayerId);
          hostInitializedRef.current = true;
        }
        
        // IMPROVED HOST LOGIC: Check if the original host from our ref is in the game
        const refOriginalHostPresent = originalHostIdRef.current && 
          sortedPlayers.some(p => p.id === originalHostIdRef.current);
        
        console.log('DEBUG - CRITICAL - Host presence check:', {
          refOriginalHostPresent,
          originalHost: originalHostIdRef.current?.slice(0, 8),
          currentHost: hostId?.slice(0, 8),
          preservingHost: preservingHostRef.current,
          gamePhase
        });
        
        // Skip host reassignment completely if preservation flag is set
        if (!preservingHostRef.current) {
        if (refOriginalHostPresent) {
          // If ref original host exists, they should ALWAYS be the host
          if (hostId !== originalHostIdRef.current) {
            console.log('DEBUG - CRITICAL - Ensuring ref original host is host:', originalHostIdRef.current);
            setHostId(originalHostIdRef.current);
            hostInitializedRef.current = true;
            
            // If I am the original host, broadcast this
            if (playerId === originalHostIdRef.current) {
              try {
                emit(channel, 'host_update', { 
                  hostId: originalHostIdRef.current,
                  originalHostId: originalHostIdRef.current,
                  forcedUpdate: true,
                  fromPlayerId: playerId,
                  fromFunction: 'presenceSync_originalHostRef'
                });
              } catch (err) {
                console.error('DEBUG - Error sending host update:', err);
              }
            }
          }
        } else if (!hostId || !sortedPlayers.some(p => p.id === hostId)) {
          // Original host ref not present AND current host not found in player list
          if (sortedPlayers.length === 0) {
            console.log('DEBUG - No players in the room, skipping host assignment');
            return;
          }
          
          // Use the first player from the sorted list as the new host
          // This is the ONLY case where we should assign a new host
          const newHostId = sortedPlayers[0].id;
          
          console.log('DEBUG - CRITICAL - Setting new host (original host absent):', {
              newHostId: newHostId.slice(0, 8),
            iAmFirstPlayer: playerId === sortedPlayers[0].id
          });
          
          setHostId(newHostId);
          hostInitializedRef.current = true;
          
          // If I became the host, broadcast this
          if (playerId === newHostId) {
            try {
              emit(channel, 'host_update', { 
                hostId: newHostId,
                // Do NOT pass null here, keep the original host ID for history
                originalHostId: originalHostIdRef.current,
                fromPlayerId: playerId,
                fromFunction: 'presenceSync_newHostWhenOriginalGone',
                timestamp: Date.now()
              });
            } catch (err) {
              console.error('DEBUG - Error sending host update:', err);
            }
          }
          }
        } else {
          console.log('DEBUG - CRITICAL - Skipping host reassignment due to preservation flag in presence sync');
        }
        
        // Update assigned player if we have assignments (keeping this unchanged)
        if (playerAssignments.length > 0) {
          const myAssignment = playerAssignments.find(a => a.playerId === playerId);
          if (myAssignment) {
            const assigned = sortedPlayers.find(p => p.id === myAssignment.assignedPlayerId);
            if (assigned) {
              setAssignedPlayer(assigned);
            }
          }
        }
        
        console.log('DEBUG - CRITICAL - Presence sync END:', {
          playerCount: sortedPlayers.length,
          phase: gamePhase
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
              emit(channel, 'host_update', { 
                hostId: newHostId,
                originalHostId 
              });
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
          currentPhase: gamePhase,
          newPhase: payload.phase,
          hostId,
          isHost: playerId === hostId,
          fromHostId: payload.fromHostId, // Log received fromHostId
          receivedPayload: payload // Log the entire payload to diagnose issues
        });
        
        // Save any assignments that came with the phase change
        if (payload.phase === 'description' && payload.assignments) {
          // Save assignments
          console.log('DEBUG - CRITICAL - Received assignments in game_phase_change:', {
            assignmentsCount: payload.assignments.length,
            myPlayerId: playerId,
            players: players.map(p => ({id: p.id, name: p.name}))
          });
          setPlayerAssignments(payload.assignments);
          
          // Find my assigned player directly from players array
          const myAssignment = payload.assignments.find((a: PlayerAssignment) => a.playerId === playerId);
          if (myAssignment) {
            console.log('DEBUG - CRITICAL - My assignment data:', {
              myId: playerId,
              assignedPlayerId: myAssignment.assignedPlayerId 
            });
            
            const foundPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
            if (foundPlayer) {
              console.log('DEBUG - CRITICAL - Found assigned player:', foundPlayer.name);
              setAssignedPlayer(foundPlayer);
            } else {
              console.log('DEBUG - CRITICAL - Could not find assigned player with ID:', myAssignment.assignedPlayerId);
              
              // Enhanced recovery for missing player
              setTimeout(() => {
                // Try again after a short delay - player list might update
                const retryPlayer = players.find(p => p.id === myAssignment.assignedPlayerId);
                if (retryPlayer) {
                  console.log('DEBUG - CRITICAL - Found assigned player on retry:', retryPlayer.name);
                  setAssignedPlayer(retryPlayer);
                } else {
                  // Request recovery from host if we still can't find our assignment
                  console.log('DEBUG - CRITICAL - Requesting assignment recovery from host');
                  if (channelRef.current) {
                    channelRef.current.send({
                      type: 'broadcast',
                      event: 'request_assignment_recovery',
                      payload: { 
                        requestingPlayerId: playerId,
                        timestamp: Date.now()
                      }
                    });
                  }
                }
              }, 1000);
            }
          } else {
            console.log('DEBUG - CRITICAL - No assignment found for my player ID:', playerId);
          }
        }
        
        // Update game phase - Ensure this happens regardless of other conditions
        console.log('DEBUG - CRITICAL - Updating game phase from', gamePhase, 'to', payload.phase);
        setGamePhase(payload.phase);
        
        // Add debugging for phase transition success
                setTimeout(() => {
          console.log('DEBUG - CRITICAL - Phase transition check:', {
            requestedPhase: payload.phase,
            currentPhase: gamePhase,
            didUpdate: gamePhase === payload.phase
          });
        }, 500);
        
        // FIXED: Immediately track with correct status after phase change to ensure proper status
        if (channelRef.current) {
          // Set appropriate status based on new phase
          let statusForPhase: 'ready' | 'writing' | 'guessing';
          
          if (payload.phase === 'description') {
            statusForPhase = 'writing'; // Always start as writing in description phase
          } else if (payload.phase === 'guessing') {
            statusForPhase = 'guessing'; // Always start as guessing in guessing phase
                  } else {
            statusForPhase = 'ready'; // Default to ready for other phases
          }
          
          // Get current seat number if available
          const currentPlayerFromState = players.find(p => p.id === playerId); // Renamed to avoid conflict
          const seatNumber = currentPlayerFromState?.seatNumber;
          
          // Track with correct status for the new phase
          channelRef.current.track({
            id: playerId,
            name: username,
            joinedAt: Date.now(),
            seatNumber,
            status: statusForPhase
          }).then(() => {
            console.log(`DEBUG - CRITICAL - Updated status to ${statusForPhase} after phase change to ${payload.phase}`);
          }).catch((err: Error) => {
            console.error('DEBUG - CRITICAL - Error updating status after phase change:', err);
          });
        }
        
        // CRITICAL: Save the script when transitioning to reading phase
        if (payload.phase === 'reading' && payload.script) {
          console.log('DEBUG - CRITICAL - Received script in phase change payload');
          setGeneratedScript(payload.script);
        } else if (payload.phase === 'reading') {
          console.log('DEBUG - CRITICAL - Phase changed to reading but no script in payload');
          
          // Immediate request for script if missing
          if (!generatedScript && channelRef.current) {
            console.log('DEBUG - CRITICAL - Missing script after phase change to reading, requesting immediately');
            
            // Small delay to ensure host has time to broadcast
              setTimeout(() => {
              try {
                channelRef.current.send({
                  type: 'broadcast',
                  event: 'request_script',
                  payload: { 
                    requestingPlayerId: playerId,
                    requestingPlayerName: username,
                    urgent: true,
                    timestamp: Date.now()
                  }
                });
                console.log('DEBUG - CRITICAL - Sent urgent script request after phase change');
              } catch (err) {
                console.error('DEBUG - CRITICAL - Error requesting script after phase change:', err);
              }
              }, 1000);
          }
        }
        
        // Validate player count if provided
        // FIX: Refined emergency sync logic
        const isHostProcessingOwnPhaseChange = playerId === hostId && payload.fromHostId === playerId;
        if (payload.playerCount && 
            players.length < payload.playerCount && 
            !isHostProcessingOwnPhaseChange && // Don't run for host processing their own immediate phase change
            channelRef.current) {
          console.log('DEBUG - EMERGENCY_SYNC_CHECK - Condition MET (players.length < payload.playerCount AND not self-host):', {
            localPlayerCount: players.length,
            payloadPlayerCount: payload.playerCount,
            isHostSelfProcessing: isHostProcessingOwnPhaseChange,
            gamePhaseAtCheck1: gamePhase
          });
          
          // Simplified condition for triggering (original was > 1 difference)
          // if (payload.playerCount - players.length > 0 && channelRef.current) { 
          console.log('DEBUG - EMERGENCY_SYNC_TRIGGERED:', { 
            difference: payload.playerCount - players.length,
            isChannelRefCurrent: !!channelRef.current,
            gamePhaseAtTrigger: gamePhase // This is the state variable, might be stale
          });
          
          // FIX: Use payload.phase for status calculation to avoid using stale gamePhase state
          const phaseForEmergencyStatus = payload.phase; 
          const emergencyHasSubmitted = hasSubmitted; // Capture current hasSubmitted for description phase
          const emergencySubmittedGuesses = submittedGuesses; // Capture for guessing phase

          let statusForEmergency: 'ready' | 'writing' | 'guessing';
          if (phaseForEmergencyStatus === 'description') {
            // CRITICAL FIX: For description phase, always default to writing status at start
            // This is the safest option since at game start no one has submitted yet
            statusForEmergency = 'writing';
            
            // Extra safety check - log this decision in detail
            console.log('DEBUG - CRITICAL - Emergency sync for description phase:', {
              playerId,
              hasSubmitted: emergencyHasSubmitted,
              submittedPlayerIds: submittedPlayerIds.length,
              statusDecision: statusForEmergency,
              forceWriting: true
            });
          } else if (phaseForEmergencyStatus === 'guessing') {
            statusForEmergency = !emergencySubmittedGuesses ? 'guessing' : 'ready';
          } else {
            statusForEmergency = 'ready';
          }
          
          console.log('DEBUG - EMERGENCY_SYNC_STATUS_CALC:', {
              phaseUsedForCalc: phaseForEmergencyStatus,
              hasSubmittedUsed: phaseForEmergencyStatus === 'description' ? emergencyHasSubmitted : 'N/A',
              submittedGuessesUsed: phaseForEmergencyStatus === 'guessing' ? emergencySubmittedGuesses : 'N/A',
              calculatedStatus: statusForEmergency
          });
          
            channelRef.current.track({ 
              id: playerId, 
              name: username,
              joinedAt: Date.now(),
            status: statusForEmergency 
          });
          console.log('DEBUG - EMERGENCY_SYNC_TRACKED_STATUS:', statusForEmergency);
          // }
        } else {
          console.log('DEBUG - EMERGENCY_SYNC_CHECK - Condition NOT MET or Host self-processing:', {
            localPlayerCount: players.length,
            payloadPlayerCount: payload.playerCount,
            isHostSelfProcessing: isHostProcessingOwnPhaseChange,
            conditionMet: payload.playerCount && players.length < payload.playerCount,
            gamePhaseAtCheck1: gamePhase
          });
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
          prevHasSubmittedRef.current = false; // Also reset the ref
          setSubmittedPlayerIds([]);
          setDescriptions([]);
          setDescription("");

          // MVPv1 update: We no longer need to manage status since we show submission count instead
          console.log('DEBUG - MVP1 - Entering description phase - using submittedPlayerIds for tracking');
        }
        else if (payload.phase === 'reading') {
          // Nothing special needed for reading phase in MVPv1
          console.log('DEBUG - MVP1 - Entering reading phase');
        }
        else if (payload.phase === 'guessing') {
          // Reset guesses state
          setPlayerGuesses({});
          setSubmittedGuesses(false);
          prevSubmittedGuessesRef.current = false; // Also reset the ref
          
          // MVPv1 update: No need to track status for guessing phase
          console.log('DEBUG - MVP1 - Entering guessing phase');
        }
        else if (payload.phase === 'results') {
          // MVPv1 update: No status changes needed
          console.log('DEBUG - MVP1 - Entering results phase');
          
          // Fix: Set scores and winners for non-host players from the payload
          if (payload.scores) {
            console.log('DEBUG - CRITICAL - Received scores in phase change payload:', payload.scores);
            setPlayerScores(payload.scores);
          } else {
            console.error('DEBUG - CRITICAL - Missing scores in results phase payload!');
          }
          
          // Set winners
          if (payload.bestConceptWinner) {
            console.log('DEBUG - CRITICAL - Setting Best Concept winner:', getPlayerName(payload.bestConceptWinner));
            setBestConceptWinner(payload.bestConceptWinner);
          }
          
          if (payload.bestDeliveryWinner) {
            console.log('DEBUG - CRITICAL - Setting Best Delivery winner:', getPlayerName(payload.bestDeliveryWinner));
            setBestDeliveryWinner(payload.bestDeliveryWinner);
          }
        }
        else if (payload.phase === 'lobby') {
          // MVPv1 update: No status changes needed
          console.log('DEBUG - MVP1 - Entering lobby');
          
          // Handle explicit play again transition
          if (payload.isPlayAgain) {
            console.log('DEBUG - CRITICAL - Processing lobby transition for Play Again');
            
            // Clear all game-related state for non-host players
            if (playerId !== payload.fromPlayerId) {
              setPlayerAssignments([]);
              setAssignedPlayer(null);
              setDescription("");
              setDescriptions([]);
              setGeneratedScript("");
              setPlayerGuesses({});
              setAllGuessResults({});
              setPlayerVotes([]);
              setPlayerScores({});
              setBestConceptWinner(null);
              setBestDeliveryWinner(null);
              
              // Reset state flags
              setHasSubmitted(false);
              setSubmittedGuesses(false);
              setHasVoted(false);
              
              console.log('DEBUG - CRITICAL - Non-host player cleared game state for Play Again');
            }
            
            // Set a longer preservation time for Play Again transitions
            setTimeout(() => {
              preservingHostRef.current = false;
              console.log('DEBUG - CRITICAL - Extended host preservation period ended for Play Again');
              
              // Double-check host status
              if (playerId === originalHostIdRef.current) {
                ensureOriginalHostPreserved().catch(err => 
                  console.error('DEBUG - CRITICAL - Error in timeout host preservation check:', err)
                );
              }
            }, 7000); // Extended time for Play Again
          }
        }
        
        console.log('DEBUG - CRITICAL - Game phase change END:', {
          currentPhase: payload.phase,
          previousPhase: gamePhase,
          hostId,
          isHost: playerId === hostId
        });
      })
      .on('broadcast', { event: 'player_status_change' }, ({ payload }) => {
        dbg('rx', payload);
        console.log('DEBUG - CRITICAL - Received player status change:', payload);
        
        // Enhanced validation for status updates with detailed logging
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
        } else if (gamePhase === 'guessing') {
          // Similar validation for guessing phase - only allow ready if guesses are submitted
          // This would need actual tracking of who has submitted guesses
          
          // For demonstration - if we had a way to track submitted guesses, we could do:
          /*
          const playerHasSubmittedGuesses = guessSubmissions.includes(payload.playerId);
          if (payload.status === 'ready' && !playerHasSubmittedGuesses) {
            console.log('DEBUG - CRITICAL - Rejecting invalid ready status for player without submitted guesses:', payload.playerId);
            return;
          }
          */
        }
        
        // Update the player's status in our local player list
        setPlayers(prev => prev.map(p => {
          if (p.id === payload.playerId) {
            dbg('writeState', { playerId: p.id, status: payload.status });
            return { ...p, status: payload.status };
          }
          return p;
        }));
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
      .on('broadcast', { event: 'submit_guesses' }, ({ payload }) => {
        console.log('DEBUG - MVPv1 - Guess submission broadcast:', payload);
        
        // Store guesses from all players
        if (payload.playerId && payload.guesses) {
          setAllPlayerGuesses(prev => ({
            ...prev,
            [payload.playerId]: payload.guesses
          }));
        }
        
        // Add to list of submitted player IDs
        setGuessSubmittedPlayerIds(prev => {
          if (prev.includes(payload.playerId)) return prev;
          return [...prev, payload.playerId];
        });
        
        // If we're the host, collect all guesses for results calculation
        if (isHost) {
          console.log('DEBUG - MVPv1 - Host received guess submission:', {
            fromPlayer: payload.playerId,
            guessCount: payload.guesses ? Object.keys(payload.guesses).length : 0,
            totalSubmissions: guessSubmittedPlayerIds.length + 1, // +1 for this submission
            remainingPlayers: players.length - (guessSubmittedPlayerIds.length + 1)
          });
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
      .on('broadcast', { event: 'player_vote_submitted' }, ({ payload }) => {
        console.log('DEBUG - Player vote submission received:', payload);
        
        if (payload.playerId && payload.guessAuthorId) {
          // Add the vote to our collection
          setPlayerVotes(prev => {
            // Remove any existing vote from this player
            const filtered = prev.filter(v => v.playerId !== payload.playerId);
            // Add the new vote
            return [...filtered, payload as PlayerVote];
          });
          
          // Add player to the guessSubmittedPlayerIds list
          setGuessSubmittedPlayerIds(prev => {
            if (prev.includes(payload.playerId)) return prev;
            console.log('DEBUG - CRITICAL - Adding player to guessSubmittedPlayerIds:', payload.playerId);
            return [...prev, payload.playerId];
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
        console.log('DEBUG - CRITICAL - Received force remove player event:', payload);
        
        // Check if current player is being kicked
        if (payload.playerId === playerId) {
          // Handle self removal - disconnect and redirect
          console.log('DEBUG - CRITICAL - I was kicked from the game');
          
          // Clear session storage for this room
          try {
          sessionStorage.removeItem(`username_${slug}`);
            sessionStorage.removeItem(`host_${slug}`);
            sessionStorage.removeItem(`originalHost_${slug}`);
          } catch (e) {
            console.error('Error clearing session storage after kick', e);
          }
          
          // Redirect to home
          window.location.href = '/';
          return;
        }
        
        // Update players list
        setPlayers(prev => prev.filter(p => p.id !== payload.playerId));
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
      .on('broadcast', { event: 'script_response' }, ({ payload }: { payload: { script?: string, scriptTitle?: string, forPlayerId?: string } }) => {
        // Only process if this response is for me or broadcast to all
        if (!payload.forPlayerId || payload.forPlayerId === playerId) {
          if (payload.script && !generatedScript) {
            console.log('DEBUG - CRITICAL - Received script from direct response');
            setGeneratedScript(payload.script);
          }
        }
      })
      // Add dedicated listener for script update (separate from phase change)
      .on('broadcast', { event: 'script_update' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received direct script update broadcast');
        
        if (payload.script) {
          // Update the script for all players regardless of host status
          console.log('DEBUG - CRITICAL - Setting script from direct script update broadcast');
          setGeneratedScript(payload.script);
        }
      })
      .on('broadcast', { event: 'force_status_sync' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received force status sync:', payload);
        
        // Only process if channel is available
        if (!channelRef.current) {
          console.error('DEBUG - CRITICAL - Channel not available for forced status sync');
          return;
        }

        // If we're receiving a force sync for the description phase, immediately retrack with writing status
        if (payload.phase === 'description' && payload.forcedStatus === 'writing') {
          console.log('DEBUG - CRITICAL - Processing forced status sync to writing for description phase');
          
          // Get current player data
          const currentPlayerFromState = players.find(p => p.id === playerId);
          const seatNumber = currentPlayerFromState?.seatNumber;
          
          // Force track with writing status
          channelRef.current.track({
            id: playerId,
            name: username,
            joinedAt: Date.now(),
            seatNumber,
            status: 'writing' // Force writing status per host instruction
          }).then(() => {
            console.log('DEBUG - CRITICAL - Successfully force tracked writing status');
            
            // Also update local state
            setPlayers(prevPlayers => 
              prevPlayers.map(player => ({
                ...player,
                status: player.id === playerId ? 'writing' : player.status
              }))
            );
          }).catch((err: Error) => {
            console.error('DEBUG - CRITICAL - Error force tracking status:', err);
          });
        }
      })
      .on('broadcast', { event: 'play_again' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received play_again event:', {
          initiatedBy: payload.initiatedBy,
          originalHostId: payload.originalHostId,
          myId: playerId,
          isHostInitiated: playerId === payload.initiatedBy
        });
        
        // Reset state for all players, not just non-hosts
        setPlayerAssignments([]);
        setAssignedPlayer(null);
        setDescription("");
        setDescriptions([]);
        setGeneratedScript("");
        setPlayerGuesses({});
        setAllGuessResults({});
        setPlayerVotes([]);
        setPlayerScores({});
        setBestConceptWinner(null);
        setBestDeliveryWinner(null);
        
        // Reset state flags
        setHasSubmitted(false);
        setSubmittedGuesses(false);
        setHasVoted(false);
        
        console.log('DEBUG - CRITICAL - Reset all game state for Play Again');
        
        // Update connection and channel state to ensure we're ready for the next game
        if (channelRef.current) {
          // Update own presence with seat number and ready status
          const mySeatNumber = players.find(p => p.id === playerId)?.seatNumber || 1;
          
          try {
            channelRef.current.track({ 
              id: playerId, 
              name: username,
              joinedAt: Date.now(),
              seatNumber: mySeatNumber,
              status: 'ready'
            });
            console.log('DEBUG - CRITICAL - Updated own presence for play again with seat number:', mySeatNumber);
          } catch (err) {
            console.error('DEBUG - CRITICAL - Error updating presence in play_again handler:', err);
          }
        }
      })
      .on('broadcast', { event: 'reassign_seat_numbers' }, async ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received reassign_seat_numbers event:', payload);
        
        // Only proceed if not the initiator
        if (playerId !== payload.initiatedBy) {
          // Check if we already have a seat number
          const currentSeatNumber = players.find(p => p.id === playerId)?.seatNumber;
          
          if (!currentSeatNumber) {
            console.log('DEBUG - CRITICAL - Player needs to reassign seat number');
            try {
              await assignPlayerSeatNumber();
            } catch (error) {
              console.error('DEBUG - CRITICAL - Error reassigning seat number:', error);
            }
          } else {
            console.log('DEBUG - CRITICAL - Player already has seat number:', currentSeatNumber);
            
            // Re-track presence with seat number to ensure consistency
            if (channelRef.current) {
              try {
                await channelRef.current.track({ 
                  id: playerId, 
                  name: username,
                  joinedAt: Date.now(),
                  seatNumber: currentSeatNumber,
                  status: 'ready'
                });
                
                console.log('DEBUG - CRITICAL - Re-tracked presence with seat number:', currentSeatNumber);
              } catch (error) {
                console.error('DEBUG - CRITICAL - Error re-tracking presence with seat number:', error);
              }
            }
          }
        }
      })
      .on('broadcast', { event: 'host_correction' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received host correction:', payload);
        
        // If this message is directed at me (I'm the incorrect host)
        if (payload.incorrectHostId === playerId) {
          console.log('DEBUG - CRITICAL - I am incorrectly set as host, correcting');
          
          // Reset local host state
          setHostId(payload.hostId);
          
          // Re-track presence without host status
          if (channelRef.current) {
            // Get my current seat number
            const mySeatNumber = players.find(p => p.id === playerId)?.seatNumber;
            
            channelRef.current.track({ 
              id: playerId, 
              name: username,
              joinedAt: Date.now(),
              seatNumber: mySeatNumber,
              status: 'ready'
            }).catch((err: Error) => console.error('DEBUG - Error correcting presence after host correction:', err));
            
            console.log('DEBUG - CRITICAL - Re-tracked presence after host correction');
          }
        }
        
        // Update host for everyone else as well to ensure consistency
        if (payload.forcedUpdate) {
          setHostId(payload.hostId);
        }
      })
      .on('broadcast', { event: 'direct_script_update' }, ({ payload }) => {
        console.log('DEBUG - CRITICAL - Received direct script update broadcast');
        if (payload.script) {
          console.log('DEBUG - CRITICAL - Setting script from direct script update broadcast');
          setGeneratedScript(payload.script);
        }
      })
      // Add event listener for play_again_reload
      .on('broadcast', { event: 'play_again_reload' }, ({ payload }) => {
        console.log('DEBUG - PLAY_AGAIN - Received reload signal:', {
          initiatedBy: payload.initiatedBy,
          originalHostId: payload.originalHostId,
          myId: playerId,
          timestamp: payload.timestamp
        });
        
        // Store username in sessionStorage before reload
        if (typeof window !== 'undefined') {
          // Reset counters and flags to avoid issues after reload
          sessionStorage.removeItem(`autoRestore_${slug}`);
          sessionStorage.removeItem(`lastChannelInit_${slug}`);
          seatAssignmentAttemptsRef.current = 0;
          lastSeatAssignmentRef.current = 0;
          
          sessionStorage.setItem(`username_${slug}`, username);
          
          // Also save original host ID if available
          if (payload.originalHostId) {
            sessionStorage.setItem(`originalHost_${slug}`, payload.originalHostId);
          }
          
          console.log('DEBUG - PLAY_AGAIN - Stored username and host info before reload');
        }
        
        // Small delay to ensure all clients receive the message
        // Different delays for initiator vs others to prevent conflicts
        const delay = payload.initiatedBy === playerId ? 200 : 300 + Math.random() * 200;
        
        console.log(`DEBUG - PLAY_AGAIN - Will reload in ${delay}ms`);
        
        setTimeout(() => {
          console.log('DEBUG - PLAY_AGAIN - Reloading page');
          window.location.reload();
        }, delay);
      })
      
    // subscribe handles connection state
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
          
          console.log('DEBUG - Channel successfully subscribed');
          
          // FIXED: Initial track() without status to prevent early 'ready' status
          await channel.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now()
            // No status field - will be set properly after phase information is received
          });
          
          console.log('DEBUG - CRITICAL - Initial presence track without status');
          
          // Assign seat number in database
          await assignPlayerSeatNumber();
          
          // ENHANCED RECOVERY: Check database for current game phase
          try {
            const { data: roomData, error: roomError } = await supa
              .from('rooms')
              .select('phase, current_host_id, original_host_id')
              .eq('room_code', slug)
              .maybeSingle();
              
            if (!roomError && roomData && roomData.phase) {
              console.log('DEBUG - CRITICAL - Retrieved room phase from database:', {
                dbPhase: roomData.phase,
                currentPhase: gamePhase,
                needsSync: roomData.phase !== gamePhase
              });
              
              // If phases don't match, sync my state with server
              if (roomData.phase !== gamePhase && roomData.phase !== 'lobby') {
                console.log('DEBUG - CRITICAL - Phase mismatch on channel connect, syncing to', roomData.phase);
                setGamePhase(roomData.phase);
                
                // If I'm the host, broadcast current phase to sync everyone
                if (playerId === roomData.original_host_id || playerId === roomData.current_host_id) {
                  console.log('DEBUG - CRITICAL - Host reconnected, broadcasting current phase');
                  setTimeout(() => {
                    if (channelRef.current) {
                      emit(channelRef.current, 'game_phase_change', { 
                        phase: roomData.phase,
                        preserveHost: true,
                        preservedHostId: roomData.original_host_id,
                        fromFunction: 'channelInit_recovery',
                        timestamp: Date.now()
                      });
                    }
                  }, 2000);
                }
                // If I'm not the host but phase is description, try to request assignments
                else if (roomData.phase === 'description') {
                  console.log('DEBUG - CRITICAL - Non-host reconnected to description phase, requesting assignments');
                  setTimeout(() => {
                    if (channelRef.current) {
                      emit(channelRef.current, 'request_assignment_recovery', { 
                        requestingPlayerId: playerId,
                        timestamp: Date.now()
                      });
                    }
                  }, 2000);
                }
              }
            }
          } catch (dbError) {
            console.error('DEBUG - CRITICAL - Error checking room phase on connection:', dbError);
          }
          
          // Force host update if this is the original host
          if (originalHostId === playerId) {
            console.log('DEBUG - Original host reconnected, asserting host status');
            
            setTimeout(() => {
              if (channelRef.current) {
                try {
                  emit(channelRef.current, 'host_update', { 
                    hostId: playerId,
                    originalHostId: playerId,
                    forcedUpdate: true,
                    fromPlayerId: playerId,
                    fromFunction: 'channelSubscribe_originalHost'
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
              ensureOriginalHostPreserved().catch(err => 
                console.error('DEBUG - CRITICAL - Error in channel reconnection host preservation check:', err)
              );
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
    const pingInterval = setInterval(async () => {
      if (channelRef.current) {
        try {
          // Get current seat number if available in state
          let seatNumber: number | undefined;
          const currentPlayer = players.find(p => p.id === playerId);
          
          if (currentPlayer) {
            // Use the player's current seat number from state if available
            if (currentPlayer.seatNumber !== undefined) {
              seatNumber = currentPlayer.seatNumber;
            }
          }
          
          if (seatNumber === undefined) {
            // Only query DB if not in state
            const { data, error } = await supa
              .from('players')
              .select('seat_number')
              .eq('player_id', playerId)
              .eq('room_code', slug)
              .single();
            
            if (!error && data && data.seat_number) {
              seatNumber = data.seat_number;
              console.log('DEBUG - CRITICAL - Fetched seat number from database:', seatNumber);
            }
          }
          
          // FIXED: Removed status from periodic ping to prevent accidental overwrites
          // Re-track presence to keep connection alive WITHOUT status
          await channelRef.current.track({ 
            id: playerId, 
            name: username,
            joinedAt: Date.now(),
            seatNumber
            // No status field - status will only be modified by explicit broadcasts
          });
          console.log('DEBUG - CRITICAL - Sent presence ping with seat number:', seatNumber, '(no status)');
        } catch (err) {
          console.error('DEBUG - CRITICAL - Error sending presence ping:', err);
          
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
  }, [slug, username, playerId, hostId]); // Only depend on critical values

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
        await emit(channelRef.current, 'host_update', { 
          hostId: originalHostIdRef.current,
          originalHostId: originalHostIdRef.current,
          forcedUpdate: true,
          fromFunction: 'handleStartGame',
          timestamp: Date.now()
        });
        
        console.log('DEBUG - CRITICAL - Sent host update before game start');
        
        // Then send the game phase change with assignments
        await emit(channelRef.current, 'game_phase_change', { 
          phase: 'description',
          assignments,
          preserveHost: true,
          preservedHostId: hostId,
          playerCount: players.length,
          fromHostId: playerId, // Added fromHostId
          timestamp: Date.now()
        });
        
        console.log('DEBUG - CRITICAL - Sent phase change to description with assignments');
        
        // Update local state immediately for responsiveness
        setPlayerAssignments(assignments);
        setGamePhase('description');
        
        // In handleStartGame, before updating own status
        dbg('ui-trigger', { event: 'broadcastAndSyncPlayerStatus', requestedStatus: 'writing', gamePhase });
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
      await emit(channelRef.current, 'submit_description', {
        playerId,
        description: descriptionObj
      });

      // In handleSubmitDescription, before updating own status
      dbg('ui-trigger', { event: 'broadcastAndSyncPlayerStatus', requestedStatus: 'ready', gamePhase });
      // Status update moved to useEffect
      // await broadcastAndSyncPlayerStatus('ready');

      console.log('DEBUG - Description submitted successfully');
      
      // Implement validation to ensure description was properly recorded
      setTimeout(() => {
        // Check if my submission is in the descriptions list
        const mySubmissionRecorded = descriptions.some(d => d.playerId === playerId);
        
        if (!mySubmissionRecorded && channelRef.current) {
          console.log('DEBUG - CRITICAL - My submission wasn\'t recorded, retrying...');
          
          // Retry submission
          emit(channelRef.current, 'submit_description', {
            playerId,
            description: descriptionObj,
            isRetry: true
          });
        }
      }, 2000);
      
      // Additional validation 5 seconds later to absolutely ensure submission was recorded
      setTimeout(() => {
        const finalCheck = descriptions.some(d => d.playerId === playerId);
        
        if (!finalCheck && channelRef.current) {
          console.log('DEBUG - CRITICAL - Final submission validation failed, sending emergency retry');
          
          // Emergency retry with all players
          emit(channelRef.current, 'submit_description', {
            playerId,
            description: descriptionObj,
            isEmergencyRetry: true
          });
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
    
    // Set generation state to show loading UI
    setIsGeneratingScript(true);
    setScriptGenerationError(false);
    
    try {
      // Get simplified player info for the API
      const playerInfo = players.map(p => ({ id: p.id, name: p.name }));
      
      // Call the API endpoint with the correct payload structure
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
        throw new Error(`Error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('DEBUG - CRITICAL - Generated script:', data);
      
      // Set the script locally - title is now included in the script content
      setGeneratedScript(data.script);
      
      // 1. First broadcast the script to all players separately from phase change
      if (channelRef.current) {
        try {
          console.log('DEBUG - CRITICAL - Broadcasting script to all players');
          emit(channelRef.current, 'script_update', { 
            script: data.script,
            fromHost: playerId,
            timestamp: Date.now()
          });
        } catch (broadcastErr) {
          console.error('DEBUG - CRITICAL - Error broadcasting script:', broadcastErr);
        }
      }
      
      // Short delay to ensure script broadcast is received before phase change
      setTimeout(() => {
        // 2. Then update phase to reading
        if (channelRef.current) {
          try {
            console.log('DEBUG - CRITICAL - Broadcasting phase change to reading');
            emit(channelRef.current, 'game_phase_change', { 
              phase: 'reading',
                script: data.script, // Include script in phase change too as fallback
                timestamp: Date.now()
              });
          } catch (broadcastErr) {
            console.error('DEBUG - CRITICAL - Error broadcasting phase change:', broadcastErr);
        }
      }
      
      setGamePhase('reading');
      }, 500); // Short delay between broadcasts
      
    } catch (error) {
      console.error('ERROR generating script:', error);
      setScriptGenerationError(true);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRetryScriptGeneration = () => {
    setScriptGenerationError(false);
    handleGenerateScript();
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
        await emit(channelRef.current, 'force_remove_player', { 
          playerId,
          kickedBy: playerId === hostId ? 'self' : 'host',
          timestamp: Date.now()
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
  const ensureOriginalHostPreserved = async () => {
    console.log('DEBUG - CRITICAL - Running original host preservation check:', {
      originalHostIdRef: originalHostIdRef.current,
      originalHostId,
      hostId,
      playerId,
      isOriginalHost: originalHostIdRef.current === playerId,
      gamePhase
    });
    
    // Only the original host can reassert themselves as host
    if (originalHostIdRef.current && originalHostIdRef.current === playerId && hostId !== playerId) {
      console.log('DEBUG - CRITICAL - Restoring original host status (forced)');
      setHostId(playerId);
      
      // Force broadcast to sync all clients
      if (channelRef.current) {
        try {
        emit(channelRef.current, 'host_update', { 
          hostId: playerId,
          originalHostId: playerId,
          forcedUpdate: true,
          fromPlayerId: playerId,
          fromFunction: 'ensureOriginalHostPreserved_forced',
          timestamp: Date.now()
        });
          
          console.log('DEBUG - CRITICAL - Sent forced host update from ensureOriginalHostPreserved');
          
          // Also ensure the DB has the original host ID
          try {
            const { error: updateError } = await supa
              .from('rooms')
              .update({ 
                current_host_id: playerId,
                original_host_id: playerId
              })
              .eq('room_code', slug);
              
            if (updateError) {
              console.error('DEBUG - CRITICAL - Error updating host in DB:', updateError);
            } else {
              console.log('DEBUG - CRITICAL - Updated host in DB to original host');
            }
          } catch (dbError) {
            console.error('DEBUG - CRITICAL - Exception updating host in DB:', dbError);
          }
        } catch (err) {
          console.error('DEBUG - CRITICAL - Error sending host restore:', err);
        }
      }
      
      // Also check if other players think they're the host and correct them
      const nonHostPlayers = players.filter(p => p.id !== playerId);
      const incorrectHostPlayer = nonHostPlayers.find(p => p.id === hostId);
      
      if (incorrectHostPlayer) {
        console.log('DEBUG - CRITICAL - Detected incorrect host:', incorrectHostPlayer.name);
        
        // Send a direct correction message
        if (channelRef.current) {
          try {
            channelRef.current.send({
              type: 'broadcast',
              event: 'host_correction',
              payload: { 
                hostId: playerId,
                originalHostId: playerId,
                forcedUpdate: true,
                fromPlayerId: playerId,
                incorrectHostId: incorrectHostPlayer.id,
                fromFunction: 'ensureOriginalHostPreserved_correction',
                timestamp: Date.now()
              }
            });
            
            console.log('DEBUG - CRITICAL - Sent host correction message');
          } catch (err) {
            console.error('DEBUG - CRITICAL - Error sending host correction:', err);
          }
        }
      }
    }
  };

  // Check original host more frequently
  useEffect(() => {
    if (!originalHostIdRef.current || playerId !== originalHostIdRef.current) return;
    
    console.log('DEBUG - CRITICAL - Setting up original host protection timer');
    
    // Check more frequently to ensure original host status
    const interval = setInterval(() => {
      ensureOriginalHostPreserved().catch(err => 
        console.error('DEBUG - CRITICAL - Error in periodic host preservation check:', err)
      );
    }, 2000); // Every 2 seconds
    
    return () => clearInterval(interval);
  }, [originalHostIdRef.current, playerId, hostId]);

  // Add effect to fetch script for non-hosts in reading phase when script is missing
  useEffect(() => {
    if (gamePhase !== 'reading' || isHost || generatedScript) {
      return;
    }
    
    console.log('DEBUG - CRITICAL - Non-host in reading phase missing script, attempting to fetch from broadcast');
    
    // Instead of a database query, listen for script updates from the host
    if (channelRef.current) {
      // Send a direct request to the host for the script
      try {
        console.log('DEBUG - CRITICAL - Requesting script directly from host');
        emit(channelRef.current, 'request_script', { 
          requestingPlayerId: playerId,
          requestingPlayerName: username
        });
      } catch (err) {
        console.error('DEBUG - CRITICAL - Error requesting script from host:', err);
      }
    }
  }, [gamePhase, isHost, generatedScript, playerId, username]);

  // Add a listener for script requests from non-hosts
  useEffect(() => {
    if (!isHost || !channelRef.current) return;
    
    const handleScriptRequest = (payload: any) => {
      console.log('DEBUG - CRITICAL - Host received script request from:', payload?.requestingPlayerName);
      
      if (generatedScript && channelRef.current) {
        try {
          // Send the script directly to the requesting player
          emit(channelRef.current, 'script_response', { 
            script: generatedScript,
            forPlayerId: payload?.requestingPlayerId
          });
          console.log('DEBUG - CRITICAL - Host sent script to requesting player');
        } catch (err) {
          console.error('DEBUG - CRITICAL - Error sending script to player:', err);
        }
      } else {
        console.log('DEBUG - CRITICAL - Host has no script to send');
      }
    };
    
    // Listen for script requests
    const channel = channelRef.current;
    const scriptRequestHandler = channel.on('broadcast', { event: 'request_script' }, ({ payload }: { payload: { requestingPlayerId: string, requestingPlayerName: string, urgent?: boolean, timestamp: number } }) => {
      handleScriptRequest(payload);
    });
    
    return () => {
      // Proper cleanup - we need to remove the listener, not unsubscribe from the channel
      if (channelRef.current) {
        // The correct way is to remove the specific listener
        scriptRequestHandler.unsubscribe();
      }
    };
  }, [isHost, generatedScript, playerId]);
  
  // Add listener for script responses
  useEffect(() => {
    if (!channelRef.current) return;
    
    const channel = channelRef.current;
    const scriptResponseHandler = channel.on('broadcast', { event: 'script_response' }, ({ payload }: { payload: { script?: string, scriptTitle?: string, forPlayerId?: string } }) => {
      // Only process if this response is for me or broadcast to all
      if (!payload.forPlayerId || payload.forPlayerId === playerId) {
        if (payload.script && !generatedScript) {
          console.log('DEBUG - CRITICAL - Received script from direct response');
          setGeneratedScript(payload.script);
          
          // Also set the script title if provided
          if (payload.scriptTitle) {
            console.log('DEBUG - CRITICAL - Setting script title from response');
            setScriptTitle(payload.scriptTitle);
          }
        }
      }
    });
    
    return () => {
      // Proper cleanup
      scriptResponseHandler.unsubscribe();
    };
  }, [playerId, generatedScript]);

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
        emit(channelRef.current, 'game_phase_change', { 
          phase: 'guessing',
          preserveHost: true,
          preservedHostId: originalHostIdRef.current,
          playerCount: players.length,
          fromHostId: playerId, // Added fromHostId
          timestamp: Date.now()
        });
        
        console.log('DEBUG - CRITICAL - Sent phase change to guessing with preserved host');
        
        // Update game phase locally for responsiveness
        setGamePhase('guessing');
        
        // In handleFinishReading, before updating own status
        dbg('ui-trigger', { event: 'broadcastAndSyncPlayerStatus', requestedStatus: 'guessing', gamePhase });
        // Status update moved to useEffect that watches gamePhase
        // broadcastAndSyncPlayerStatus('guessing');
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
      
      // First update local state
      setSubmittedGuesses(true);
      
      // Add to submitted IDs list (MVPv1 update - tracking through guessSubmittedPlayerIds)
      setGuessSubmittedPlayerIds(prev => {
        if (prev.includes(playerId)) return prev;
        return [...prev, playerId];
      });
      
      // If this is the original host, force broadcast host update before continuing
      if (playerId === originalHostIdRef.current) {
        console.log('DEBUG - CRITICAL - Original host forcing host update during guess submission');
        try {
          await emit(channelRef.current, 'host_update', { 
            hostId: originalHostIdRef.current,
            originalHostId: originalHostIdRef.current,
            forcedUpdate: true,
            fromPlayerId: playerId,
            fromFunction: 'handleSubmitGuesses_originalHost',
            timestamp: Date.now()
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
      
      await emit(channelRef.current, 'submit_guesses', { 
        playerId,
        guesses: playerGuesses,
        timestamp: Date.now()
      });
      
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
    // Prevent multiple rapid clicks
    if (playAgainDisabled) {
      console.log('DEBUG - PLAY_AGAIN - Button is disabled, ignoring click');
      return;
    }
    
    // Disable button after click
    setPlayAgainDisabled(true);
    
    console.log('DEBUG - PLAY_AGAIN - Starting Play Again with reload approach', {
      playerId,
      isHost,
      isOriginalHost,
      originalHostId,
      players: players.length,
      gamePhase
    });
    
    try {
      // 1. Save username to sessionStorage for restoration after reload
      if (typeof window !== 'undefined') {
        // Reset auto-restore flag to allow a fresh restore after reload
        sessionStorage.removeItem(`autoRestore_${slug}`);
        sessionStorage.removeItem(`lastChannelInit_${slug}`);
        seatAssignmentAttemptsRef.current = 0;
        lastSeatAssignmentRef.current = 0;
        
        sessionStorage.setItem(`username_${slug}`, username);
        
        // Also save original host ID if available
        if (originalHostId) {
          sessionStorage.setItem(`originalHost_${slug}`, originalHostId);
        }
        console.log('DEBUG - PLAY_AGAIN - Stored username and host info in sessionStorage');
      }
      
      if (!channelRef.current) {
        console.error('DEBUG - PLAY_AGAIN - Channel not initialized');
        setPlayAgainDisabled(false); // Re-enable button if error
        return;
      }
      
      console.log('DEBUG - PLAY_AGAIN - Broadcasting reload signal to all players');
      
      // 2. Broadcast reload signal to all players
      await emit(channelRef.current, 'play_again_reload', { 
        initiatedBy: playerId,
        originalHostId,
        timestamp: Date.now()
      });
      
      // Auto-reset button disabled state after a timeout (fallback)
      setTimeout(() => {
        setPlayAgainDisabled(false);
      }, 10000);
        
    } catch (error) {
      console.error('DEBUG - PLAY_AGAIN - Error in handlePlayAgain:', error);
      // Re-enable button if error
      setPlayAgainDisabled(false);
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
            emit(channelRef.current, 'host_update', { 
              hostId: originalHostIdRef.current,
              originalHostId: originalHostIdRef.current,
              forcedUpdate: true,
              fromPlayerId: playerId,
              fromFunction: 'syncHostStatus_originalHost',
              timestamp: Date.now()
            });
          } catch (err) {
            console.error('DEBUG - Error broadcasting manual host update:', err);
          }
        }
      }
    } else if (!hostId || !players.some(p => p.id === hostId)) {
      // Original host not present AND host is missing
      // Use first player from the sorted list
      const sortedPlayers = [...players].sort((a, b) => a.joinedAt - b.joinedAt);
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
    const allPlayersSubmitted = players.every(player => 
      guessSubmittedPlayerIds.includes(player.id)
    );
    
    console.log('DEBUG - MVPv1 - Can show results check:', {
      playerId,
      isHost,
      isOriginalHost: playerId === originalHostIdRef.current,
      gamePhase,
      allPlayersSubmitted,
      guessSubmittedCount: guessSubmittedPlayerIds.length,
      totalPlayers: players.length,
      buttonWillShow: isOriginalHost && allPlayersSubmitted,
      missingSubmissions: players.filter(p => !guessSubmittedPlayerIds.includes(p.id)).map(p => p.name)
    });
    
    return allPlayersSubmitted;
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
    await emit(channelRef.current, 'host_update', { 
      hostId: originalHostId, // Always use original host
      originalHostId,
      forcedUpdate: true,
      fromPlayerId: playerId, // Track who sent this update
      fromFunction: 'handleShowResults'
    });
    
    console.log('DEBUG - Original host sent forced host update before phase change to results');
    
    // Add to the existing code - force host update before phase change
    if (channelRef.current) {
      try {
        // First send a host update to keep host consistent during transition
        await emit(channelRef.current, 'host_update', { 
          hostId: originalHostIdRef.current,
          originalHostId: originalHostIdRef.current,
          forcedUpdate: true,
          fromFunction: 'handleShowResults_pre',
          timestamp: Date.now()
        });
        
        console.log('DEBUG - CRITICAL - Original host sent forced host update before phase change to results');
        
        // Now send phase change
        await emit(channelRef.current, 'game_phase_change', { 
          phase: 'results',
          preserveHost: true,
          preservedHostId: originalHostIdRef.current,
          playerCount: players.length,
          scores: scores, // Fix: Use locally calculated scores instead of playerScores state
          bestConceptWinner: bestConceptWinnerId,
          bestDeliveryWinner: bestDeliveryWinnerId,
          fromHostId: playerId, // Added fromHostId
          timestamp: Date.now()
        });
        
        console.log('DEBUG - CRITICAL - Original host sent phase change to results with preserved host:', {
          scoresSize: Object.keys(scores).length,
          bestConceptWinner: bestConceptWinnerId ? getPlayerName(bestConceptWinnerId) : 'none',
          bestDeliveryWinner: bestDeliveryWinnerId ? getPlayerName(bestDeliveryWinnerId) : 'none'
        });
        
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
      return;
    }
    
    // Set the preservation flag to prevent host changes during operation
      console.log('DEBUG - CRITICAL - Setting preservation flag during vote submission');
    preservingHostRef.current = true;
    
    // Mark as submitted locally first for immediate UI feedback
    setHasVoted(true);
    setSubmittedGuesses(true); // Set to lock UI inputs
    prevSubmittedGuessesRef.current = true; // Update ref to avoid duplicate triggers
    
    // Add yourself to the submission list
    setGuessSubmittedPlayerIds(prev => {
      if (prev.includes(playerId)) return prev;
      console.log('DEBUG - CRITICAL - Adding self to guessSubmittedPlayerIds:', playerId);
      return [...prev, playerId];
    });

    try {
      // Broadcast the vote to all players
      await emit(channelRef.current, 'player_vote_submitted', { 
        playerId,
        guessAuthorId,
        bestConceptDescId,
        bestDeliveryPlayerId
      });
      
      console.log('DEBUG - MVPv1 - After vote submission:', {
        playerId,
        hasVoted,
        submittedGuesses: true, // We just set this to true
        guessSubmittedCount: guessSubmittedPlayerIds.length + 1, // +1 for optimistic update
        allPlayers: players.length
      });

      // UI trigger to show feedback
      broadcastAndSyncPlayerStatus('ready');
      
    } catch (err) {
      console.error('DEBUG - CRITICAL - Error submitting votes:', err);
      // Revert optimistic updates on error
      setHasVoted(false);
      setSubmittedGuesses(false); // Reset on error
      prevSubmittedGuessesRef.current = false;
      setGuessSubmittedPlayerIds(prev => prev.filter(id => id !== playerId));
    } finally {
      console.log('DEBUG - CRITICAL - Reset preservation flag after vote submission');
                preservingHostRef.current = false;
    }
  };

  // Add a tracking function to keep player counts in sync
  const broadcastAndSyncPlayerStatus = async (status: 'ready' | 'writing' | 'guessing') => {
    // MVPv1 - Status icons removed: This function is kept for reference but no longer used
    // Since we've removed real-time status icons, we don't need to broadcast status changes
    // The submittedPlayerIds array is now the single source of truth for submission status
    
    /*
    dbg('emit', { playerId, newStatus: status, gamePhase });
    console.log('DEBUG - CRITICAL - Broadcasting player status:', {
      myId: playerId,
      myName: username,
      newStatus: status,
      currentPhase: gamePhase,
      hasSubmitted: status === 'ready' && gamePhase === 'description' ? hasSubmitted : 'n/a'
    });
    
    // CRITICAL FIX: Special handling for description phase
    if (gamePhase === 'description') {
      // If we're in description phase and requesting 'writing' status, always allow it
      if (status === 'writing') {
        console.log('DEBUG - CRITICAL - Enforcing writing status in description phase');
        // Proceed with broadcast
      }
      // If requesting 'ready' status, only allow if submitted
      else if (status === 'ready') {
        const isInSubmittedIds = submittedPlayerIds.includes(playerId);
        if (!isInSubmittedIds) {
          console.log('DEBUG - CRITICAL - Blocking invalid ready status in description phase - not submitted');
          return;
        }
      }
    }
    
    // Validate requested status against current game state
    const correctStatus = determineCorrectStatus(gamePhase, hasSubmitted, submittedGuesses, hasVoted);
    
    // If the status being requested doesn't match what our helper thinks is correct,
    // log a warning but proceed if it represents valid progress
    if (status !== correctStatus) {
      // If trying to mark as ready but helper disagrees, validate carefully
      if (status === 'ready' && correctStatus !== 'ready') {
        console.log('DEBUG - CRITICAL - Requested ready status conflicts with determined status:', {
          requested: status,
          determined: correctStatus,
          gamePhase,
          hasSubmitted,
          submittedGuesses,
          isInSubmittedIds: submittedPlayerIds.includes(playerId)
        });
        
        // Check if this is valid based on game phase
        if (gamePhase === 'description') {
          // CRITICAL FIX: Extra validation for description phase
          // Only allow ready status if player is in submittedPlayerIds
          const isInSubmittedIds = submittedPlayerIds.includes(playerId);
          if (!isInSubmittedIds) {
            console.log('DEBUG - CRITICAL - Preventing invalid ready status - player not in submittedPlayerIds');
            return; // Don't allow ready status without presence in submittedPlayerIds
          
          if (!hasSubmitted) {
            console.log('DEBUG - CRITICAL - Warning: hasSubmitted flag doesn\'t match submittedPlayerIds');
            // Still proceed if in submittedPlayerIds even if hasSubmitted is false - submittedPlayerIds is authoritative
          }
        }
        else if (gamePhase === 'guessing' && !submittedGuesses) {
          console.log('DEBUG - CRITICAL - Preventing invalid ready status in guessing phase without submission');
          return; // Don't allow ready status without submission
        }
      }
      
      // If trying to downgrade from ready to writing/guessing, let it happen for explicit broadcasts
      if (correctStatus === 'ready' && (status === 'writing' || status === 'guessing')) {
        console.log('DEBUG - CRITICAL - Allowing explicit downgrade from ready to', status);
        // Proceed with broadcast
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
        prevPlayers.map(player => {
          if (player.id === playerId) {
            dbg('writeState', { playerId: player.id, status });
            return { ...player, status };
          }
          return player;
        })
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
    */

    // Just update players' status in the local state for now
    setPlayers(prevPlayers => 
      prevPlayers.map(player => {
        if (player.id === playerId) {
          return { ...player, status };
        }
        return player;
      })
    );
    
    // If we're in the description phase and setting status to ready,
    // we should also tell other players we've submitted
    if (gamePhase === 'description' && status === 'ready' && channelRef.current) {
      // This broadcast will update the counter on all clients
      emit(channelRef.current, 'submit_description', {
        playerId
      }).catch((err: Error) => console.error('Error broadcasting submission:', err));
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
  // ScriptLoading component with error handling and accessibility
  const ScriptLoading = ({ error, onRetry }: { error?: boolean; onRetry?: () => void }) => (
    <div className="fixed inset-0 bg-background-secondary/75 flex items-center justify-center z-50">
      <div className="bg-background-card rounded-xl shadow-lg p-4 sm:p-8 max-w-md mx-4">
        <div role="status" aria-live="polite" className="flex flex-col items-center space-y-4">
          <span className="sr-only">Generating script, please wait...</span>
          {error ? (
            <>
              <span className="text-4xl">❌</span>
              <h3 className="text-xl font-semibold text-error-text">Failed to Generate Script</h3>
              <p className="text-text-secondary text-center">Something went wrong. Please try again.</p>
              {onRetry && (
                <button 
                  onClick={onRetry} 
                  className="px-4 py-2 bg-brand-primary hover:bg-brand-secondary text-background-primary rounded transition-colors"
                >
                  Try Again
                </button>
              )}
            </>
          ) : (
            <>
              <svg className="w-12 h-12 animate-spin text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <h3 className="text-xl font-semibold text-text-primary">Generating Script...</h3>
              <p className="text-text-secondary text-center">
                Creating your story with AI...<br />
                Give it a second, could ya? It's going to space! Could you give it a second to get back from space?
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );

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
        <div className="p-4 max-w-md mx-auto bg-background-card rounded-xl shadow-md">
          <h2 className="text-xl font-bold mb-4 text-text-primary">Write a character description for:</h2>
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-background-muted rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-background-muted rounded"></div>
                <div className="h-4 bg-background-muted rounded w-5/6"></div>
                <div className="h-4 bg-background-muted rounded w-5/6"></div>
              </div>
            </div>
          </div>
          <p className="text-text-muted mt-2">Waiting for assignments...</p>
        </div>
      );
    }
    
    // Rest of the existing description phase UI
    return (
      <div className="p-4 w-full bg-background-card rounded-xl shadow-md">
        <h2 className="text-xl font-bold mb-4 text-text-primary">Write a character description for:</h2>
        <div className="mb-4 p-2 bg-info-bg rounded">
          <p className="font-semibold text-info-text">{assignedPlayer?.name}</p>
        </div>
        <div className="mb-2">
          <p className="text-sm text-text-secondary mb-1">Your description will be used to generate {assignedPlayer?.name}'s script.</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-32 p-2 border border-border-primary rounded focus:ring focus:ring-brand-primary bg-background-primary text-text-primary"
            placeholder="Describe their character (personality, quirks, motivation, etc.)"
            disabled={hasSubmitted}
          />
          
          {/* Character Counter */}
          <div className="mt-1 flex justify-end items-center">
            <span className={`text-xs ${
              description.length > 1738 ? 'text-error-text font-semibold' :
              description.length > 1500 ? 'text-warning-text' : 
              'text-text-muted'
            }`}>
              {description.length} / 1738 characters
              {description.length > 1738 ? ' (maximum reached)' : 
               description.length > 1500 ? ' (approaching limit)' : 
               description.length < 100 ? ' (minimum 100 characters)' : ''}
            </span>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-text-muted">
            {hasSubmitted ? "Description submitted" : ""}
          </span>
          <button
            onClick={handleSubmitDescription}
            disabled={!description.trim() || description.length < 100 || description.length > 1738 || hasSubmitted}
            className={`px-4 py-2 rounded ${
              !description.trim() || description.length < 100 || description.length > 1738 || hasSubmitted
                ? "bg-background-muted cursor-not-allowed text-text-muted"
                : "bg-brand-primary hover:bg-brand-secondary text-background-primary"
            }`}
          >
            {hasSubmitted ? "Submitted" : "Submit"}
          </button>
        </div>
        <div className="mt-4">
          <p className="text-xs text-text-muted">
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
    
    // Add debugging to help track script visibility issues
    if (!isHost && !generatedScript) {
      console.log('DEBUG - CRITICAL - Non-host in reading phase WITHOUT script, fetch should trigger');
      
      // Add retry mechanism for script fetching
      React.useEffect(() => {
        if (!generatedScript && !isHost && channelRef.current) {
          console.log('DEBUG - CRITICAL - Setting up script retry mechanism');
          
          // Try multiple times with increasing delays
          const retryTimes = [2000, 5000, 10000]; // 2s, 5s, 10s
          
          retryTimes.forEach((delay, index) => {
            setTimeout(() => {
              if (!generatedScript && channelRef.current) {
                console.log(`DEBUG - CRITICAL - Script retry attempt ${index + 1}`);
                try {
                  emit(channelRef.current, 'request_script', { 
                    requestingPlayerId: playerId,
                    requestingPlayerName: username,
                    retry: index + 1,
                    timestamp: Date.now()
                  });
                } catch (err) {
                  console.error(`DEBUG - CRITICAL - Error in script retry attempt ${index + 1}:`, err);
                }
              }
            }, delay);
          });
        }
      }, [generatedScript, isHost]);
      
    } else if (!generatedScript) {
      console.log('DEBUG - CRITICAL - Host in reading phase WITHOUT script - unusual state');
    } else {
      console.log('DEBUG - Script is available for rendering');
    }
    
    return (
      <main className="h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 bg-background-secondary">
        <DarkModeToggle />
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-warning-bg text-warning-text rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-warning-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-error-bg text-error-text rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-background-card rounded-xl shadow-lg p-4 sm:p-6 lg:p-8 mb-6">
          <h2 className="text-xl sm:text-2xl font-bold mb-5 text-text-primary text-center">
            The Script
          </h2>
          
          {/* Instructions for all users */}
          <div className="mb-6 p-4 bg-info-bg border border-info-border rounded-lg text-center">
            <p className="text-info-text">
              {isHost 
                ? "Read the script together with your group. When everyone is done, click the button below."
                : "Read the script together. The host will move everyone to the guessing phase when ready."}
            </p>
          </div>
          
          {/* Tip about Best Line Delivery */}
          <div className="mb-6 p-4 bg-warning-bg border border-warning-border rounded-lg">
            <p className="text-warning-text flex items-center justify-center">
              <span className="mr-2">💡</span>
              <span><strong>Tip:</strong> Project your lines—Best Line Delivery gets a point!</span>
            </p>
          </div>
          
          {/* Script title */}
          {/* <h3 className="text-xl font-bold mb-4 text-center text-indigo-700 italic">
            "{scriptTitle}"
          </h3> */}
          
          <div className="p-6 bg-background-muted rounded-lg mb-6 whitespace-pre-wrap font-serif text-lg leading-relaxed border border-border-primary max-h-[500px] overflow-y-auto shadow-inner">
            {generatedScript ? (
              generatedScript.split('\n\n').map((section, index) => {
                // Format different parts of the script with better styling
                if (section.startsWith('NARRATOR:')) {
                  return (
                    <div key={index} className="mb-6 italic text-text-primary bg-info-bg p-3 rounded border border-info-border">
                      {section}
                    </div>
                  );
                } else if (section.startsWith('[TITLE:')) {
                  // Extract and format the title
                  const titleMatch = section.match(/\[TITLE: "(.+?)"\]/);
                  const title = titleMatch ? titleMatch[1] : "Untitled Script";
                  return (
                    <div key={index} className="mb-6 text-center text-xl font-bold text-brand-primary italic bg-background-muted p-4 rounded-lg border border-border-primary">
                      {title}
                    </div>
                  );
                } else if (section.startsWith('[')) {
                  return (
                    <div key={index} className="mb-4 text-sm uppercase tracking-wider text-text-primary font-semibold bg-background-secondary p-2 rounded">
                      {section}
                    </div>
                  );
                } else if (section.includes(':')) {
                  const [character, dialogue] = section.split(':', 2);
                  return (
                    <div key={index} className="mb-6 bg-background-card p-4 rounded-lg shadow-sm border border-border-primary">
                      <div className="font-bold text-brand-primary mb-1">{character}:</div>
                      <div className="text-text-primary pl-4">{dialogue}</div>
                    </div>
                  );
                } else {
                  return (
                    <div key={index} className="mb-6 text-text-primary bg-background-card p-3 rounded border border-border-primary">
                      {section}
                    </div>
                  );
                }
              })
            ) : (
              <div className="text-center text-text-secondary p-10">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-primary mx-auto mb-4"></div>
                Script loading...
              </div>
            )}
          </div>
          
          {isHost && (
            <div className="flex justify-center">
              <button
                onClick={handleFinishReading}
                className="px-8 py-3 rounded-lg bg-brand-primary hover:bg-brand-secondary text-background-primary font-semibold shadow-md transition-colors"
              >
                Everyone's Done Reading? Continue to Guessing
              </button>
            </div>
          )}
        </div>
        
        <div className="w-full max-w-4xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {stablePlayers.map((player) => (
              <div
                key={player.id}
                className={`p-4 rounded-lg ${
                  player.id === playerId ? 'bg-info-bg border-info-border border-2' : 'bg-background-card'
                } shadow`}
              >
                <div className="font-semibold text-center truncate text-text-primary">{player.name}</div>
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
    <main className="h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 sm:px-6 lg:px-8">
        <DarkModeToggle />
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text">
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
          className="px-4 py-2 border border-border-primary rounded-lg text-lg capitalize bg-background-card text-text-primary"
        />
        <button
          onClick={handleUsernameSubmit}
          className="px-6 py-3 rounded-lg bg-brand-primary text-white text-lg"
        >
          Join Game
        </button>
      </main>
    );
  }

  // Show loading state while connecting
  if (!isConnected) {
    return (
      <main className="h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 sm:px-6 lg:px-8">
        <DarkModeToggle />
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text mb-4">
            PlotTwist
          </h1>
        </Link>
        <div className="text-xl text-text-primary">Connecting to game...</div>
      </main>
    );
  }

  // Description phase rendering
  if (gamePhase === 'description') {
    return (
      <main className="h-screen flex flex-col lg:flex-row items-start p-4 sm:p-6 lg:p-8 bg-background-secondary">
        <DarkModeToggle />
        
        {/* Script Generation Loading Overlay */}
        {(isGeneratingScript || scriptGenerationError) && (
          <ScriptLoading 
            error={scriptGenerationError} 
            onRetry={scriptGenerationError ? handleRetryScriptGeneration : undefined}
          />
        )}
        <div className="w-full lg:w-2/3 lg:pr-6">
          <Link href="/" className="transition-transform hover:scale-105 inline-block">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text mb-8">
              PlotTwist
            </h1>
          </Link>
          
          {/* Connection status indicator */}
          {isReconnecting && (
            <div className="w-full mb-4 p-3 bg-warning-bg text-warning-text rounded-lg flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-warning-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Reconnecting to game...</span>
            </div>
          )}
          
          {!isConnected && !isReconnecting && (
            <div className="w-full mb-4 p-3 bg-error-bg text-error-text rounded-lg flex items-center justify-center">
              <span className="mr-2">⚠️</span>
              <span>Connection lost! Please refresh the page if this persists.</span>
            </div>
          )}
          
          <div className="w-full bg-background-card rounded-xl shadow-lg p-8 mb-6">
            <h2 className="text-2xl font-semibold mb-5 text-text-primary">
              Write a character description for:
            </h2>
            
            {/* Add submission counter */}
            <div className="mb-4 text-center">
              <strong>{submittedPlayerIds.length} of {players.length}</strong> players have submitted
            </div>
            
            {renderDescriptionPhase()}
          </div>
        </div>
        
        <div className="w-full lg:w-1/3 lg:pl-6 mt-6 lg:mt-0">
          <div className="bg-background-card rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4 text-text-primary">Players</h3>
            
            <div className="space-y-3">
              {stablePlayers.map((player) => (
                <div 
                  key={player.id} 
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-background-muted rounded-lg"
                >
                  <div className="flex items-center mb-2 sm:mb-0">
                    <div className="text-lg font-bold text-text-primary mr-2">{player.name}</div>
                    {player.id === hostId && (
                      <span className="ml-1 text-xs bg-brand-primary text-background-primary px-2 py-1 rounded">
                        Host
                      </span>
                    )}
                  </div>
                  
                  {submittedPlayerIds.includes(player.id) ? (
                      <div className="flex items-center text-success-text bg-success-bg px-2 py-1 rounded">
                        <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      <span className="text-sm font-medium">Submitted</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-warning-text bg-warning-bg px-2 py-1 rounded">
                      <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      <span className="text-sm font-medium">Pending</span>
                      </div>
                    )}
                </div>
              ))}
            </div>
          </div>
          
          {isHost && (
            <div className="bg-background-card rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold mb-4 text-text-primary">Host Controls</h3>
              
              <button
                onClick={handleGenerateScript}
                disabled={!allPlayersSubmitted || isGeneratingScript}
                className={`w-full py-3 px-4 rounded-lg ${
                  !allPlayersSubmitted || isGeneratingScript
                    ? 'bg-background-muted cursor-not-allowed text-text-muted'
                    : 'bg-brand-primary hover:bg-brand-secondary cursor-pointer'
                } text-background-primary font-semibold shadow-md transition-colors flex justify-center items-center`}
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
              
              <p className="text-sm text-text-muted mt-2 text-center">
                {allPlayersSubmitted 
                  ? 'All players are ready! You can generate the script now.'
                  : 'Wait for all players to submit their descriptions.'}
              </p>
              
              {/* Add sync host button if host status seems wrong */}
              {players.length > 0 && players[0].id !== hostId && (
                <div className="mt-4 pt-4 border-t border-border-primary">
                  <p className="text-xs text-warning-text mb-2">Host status may be out of sync</p>
                  <button
                    onClick={syncHostStatus}
                    className="w-full py-2 px-4 bg-background-muted hover:bg-background-secondary rounded text-text-primary text-sm"
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
      <main className="h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 bg-background-secondary">
        <DarkModeToggle />
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-warning-bg text-warning-text rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-warning-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-error-bg text-error-text rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-background-card rounded-xl shadow-lg p-4 sm:p-6 lg:p-8 mb-6">
          <h2 className="text-xl sm:text-2xl font-bold mb-2 text-text-primary text-center">
            Voting Time!
          </h2>
          
          <p className="text-text-secondary mb-6 text-center">
            Vote for your favorite performances and guess who wrote your character.
          </p>
          
          {/* Scoring Banner - Added for clearer point attribution */}
          <div className="w-full p-3 bg-info-bg border border-info-border rounded-lg mb-6 text-center">
            <p className="text-info-text italic text-sm md:text-base font-medium">
              3 points for correctly guessing who wrote your description.
              1 point per vote received for Best Concept and Best Delivery.
            </p>
          </div>
          
          {/* Add submission counter */}
          <div className="mb-4 text-center">
            <strong>{guessSubmittedPlayerIds.length} of {players.length}</strong> players have submitted
          </div>
          
          {/* Section A: Who wrote your description? */}
          <div className="mb-8 bg-info-bg rounded-lg p-6 border-2 border-info-border">
            <h3 className="text-xl font-bold text-info-text mb-4 flex items-center">
              <span className="bg-info-border text-info-text w-8 h-8 rounded-full flex items-center justify-center mr-3">
                A
              </span>
              <span>Who wrote YOUR character description?</span>
            </h3>
            
            <div className="mb-2 text-text-secondary">
              <p>Your character: <span className="font-semibold">{username}</span></p>
            </div>
            
            <select
              value={guessAuthorId}
              onChange={(e) => setGuessAuthorId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border border-border-primary rounded-lg text-lg ${
                submittedGuesses ? 'bg-background-muted' : 'bg-background-primary'
              } text-text-primary`}
            >
              <option value="">Select who you think wrote your description...</option>
              {stablePlayers
                .filter(p => p.id !== playerId) // Can't select yourself
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && guessAuthorId && (
              <div className="mt-3 text-success-text font-medium flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You guessed: {getPlayerName(guessAuthorId)}
              </div>
            )}
          </div>
          
          {/* Section B: Best Character Concept */}
          <div className="mb-8 bg-warning-bg rounded-lg p-6 border-2 border-warning-border">
            <h3 className="text-xl font-bold text-warning-text mb-4 flex items-center">
              <span className="bg-warning-border text-warning-text w-8 h-8 rounded-full flex items-center justify-center mr-3">
                B
              </span>
              <span>Best Character Concept</span>
            </h3>
            
            <p className="mb-4 text-text-secondary">
              Vote for the most creative character concept in the story.
            </p>
            
            <select
              value={bestConceptDescId}
              onChange={(e) => setBestConceptDescId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border border-border-primary rounded-lg text-lg ${
                submittedGuesses ? 'bg-background-muted' : 'bg-background-primary'
              } text-text-primary`}
            >
              <option value="">Select a character...</option>
              {stablePlayers
                .filter(p => p.id !== playerAssignments.find(a => a.playerId === playerId)?.assignedPlayerId)
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && bestConceptDescId && (
              <div className="mt-3 text-success-text font-medium flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You voted for: {getPlayerName(bestConceptDescId)}
              </div>
            )}
          </div>
          
          {/* Section C: Best Line Delivery */}
          <div className="mb-8 bg-background-muted rounded-lg p-6 border-2 border-border-primary">
            <h3 className="text-xl font-bold text-brand-primary mb-4 flex items-center">
              <span className="bg-brand-primary text-white w-8 h-8 rounded-full flex items-center justify-center mr-3">
                C
              </span>
              <span>Best Line Delivery</span>
            </h3>
            
            <p className="mb-4 text-text-secondary">
              Who had the best delivery during the table read?
            </p>
            
            <select
              value={bestDeliveryPlayerId}
              onChange={(e) => setBestDeliveryPlayerId(e.target.value)}
              disabled={submittedGuesses}
              className={`w-full p-3 border border-border-primary rounded-lg text-lg ${
                submittedGuesses ? 'bg-background-muted' : 'bg-background-primary'
              } text-text-primary`}
            >
              <option value="">Select an actor...</option>
              {stablePlayers
                .filter(p => p.id !== playerId) // Can't vote for yourself
                .map(player => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))
              }
            </select>
            
            {submittedGuesses && bestDeliveryPlayerId && (
              <div className="mt-3 text-success-text font-medium flex items-center">
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
                  ? 'bg-background-muted cursor-not-allowed text-text-muted'
                  : 'bg-success-text hover:bg-success-border text-background-primary cursor-pointer'
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
          
          {/* Add success message for clearer feedback */}
          {submittedGuesses && (
            <div className="mt-4 p-4 bg-success-bg border border-success-border rounded-lg text-center">
              <p className="flex items-center justify-center text-success-text font-medium">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Your votes have been submitted successfully! Waiting for other players...
              </p>
            </div>
          )}
          
          {(!guessAuthorId || !bestConceptDescId || !bestDeliveryPlayerId) && !submittedGuesses && (
            <p className="text-center text-warning-text mt-4">
              You need to complete all three sections before submitting
            </p>
          )}
        </div>
        
        <div className="w-full max-w-4xl bg-background-card rounded-lg p-4 shadow">
          <h3 className="text-lg font-semibold mb-3 text-text-primary">Players Status</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {stablePlayers.map((player) => (
              <div
                key={player.id}
                className={`p-3 rounded-lg ${
                  player.id === playerId 
                    ? 'bg-info-bg border-2 border-info-border text-info-text' 
                    : 'bg-background-muted border border-border-primary text-text-primary'
                }`}
              >
                <div className="font-bold text-lg text-center">{player.name}</div>
                {player.id === playerId && (
                  <div className="text-xs text-center mt-1 text-info-text">You</div>
                )}
                <div className={`mt-2 text-center text-sm px-2 py-1 rounded-full 
                  ${guessSubmittedPlayerIds.includes(player.id)
                    ? 'bg-success-bg text-success-text' 
                    : 'bg-warning-bg text-warning-text'}`}
                >
                  {guessSubmittedPlayerIds.includes(player.id) ? 'Submitted' : 'Pending'}
                </div>
              </div>
            ))}
          </div>
          {isOriginalHost && stablePlayers.every(p => guessSubmittedPlayerIds.includes(p.id)) && (
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
    // Debug log for results data
    console.log('DEBUG - CRITICAL - Rendering results UI with data:', {
      hasScores: Object.keys(playerScores).length > 0,
      totalScores: Object.keys(playerScores).length,
      playerCount: players.length,
      scores: playerScores,
      bestConceptWinner: bestConceptWinner ? getPlayerName(bestConceptWinner) : 'None',
      bestDeliveryWinner: bestDeliveryWinner ? getPlayerName(bestDeliveryWinner) : 'None',
      isHost,
      isOriginalHost: playerId === originalHostId
    });
    
    return (
      <main className="h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 bg-background-secondary">
        <DarkModeToggle />
        <Link href="/" className="transition-transform hover:scale-105">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text mb-8">
            PlotTwist
          </h1>
        </Link>
        
        {/* Connection status indicator */}
        {isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-warning-bg text-warning-text rounded-lg flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-warning-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Reconnecting to game...</span>
          </div>
        )}
        
        {!isConnected && !isReconnecting && (
          <div className="w-full max-w-4xl mb-4 p-3 bg-error-bg text-error-text rounded-lg flex items-center justify-center">
            <span className="mr-2">⚠️</span>
            <span>Connection lost! Please refresh the page if this persists.</span>
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-background-card rounded-xl shadow-lg p-4 sm:p-6 lg:p-8 mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-text-primary text-center">
            Game Results
          </h2>
          
          <div className="mb-8 p-4 bg-info-bg rounded-lg border border-info-border flex items-center justify-center">
            <div className="text-info-text text-lg">
              Thanks for playing PlotTwist!
            </div>
          </div>
          
          {/* Debug info for scores */}
          {Object.keys(playerScores).length === 0 && (
            <div className="mb-4 p-3 bg-amber-100 text-amber-800 rounded-lg">
              <p className="font-medium">Debug Info: No scores found!</p>
              <p className="text-sm">Player count: {players.length}</p>
              <p className="text-sm">Best Concept Winner: {bestConceptWinner ? getPlayerName(bestConceptWinner) : 'None'}</p>
              <p className="text-sm">Best Delivery Winner: {bestDeliveryWinner ? getPlayerName(bestDeliveryWinner) : 'None'}</p>
              <p className="text-sm">Is host: {isHost ? 'Yes' : 'No'}</p>
              <p className="text-sm">Is original host: {playerId === originalHostId ? 'Yes' : 'No'}</p>
            </div>
          )}
          
          <div className="space-y-10">
            {/* Player Scoreboard */}
            <div className="bg-background-muted rounded-xl p-6 border border-border-primary">
              <h3 className="text-xl sm:text-2xl font-bold mb-6 text-text-primary text-center">
                Final Scores
              </h3>
              
              <div className="overflow-hidden">
                {/* Sort players by score in descending order */}
                {stablePlayers
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
            <div className="bg-warning-bg rounded-xl p-6 border border-warning-border">
              <h3 className="text-xl sm:text-2xl font-bold mb-6 text-warning-text text-center">Special Awards</h3>
              
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
          
          {/* Character Writers Section */}
          <div className="mt-10 bg-info-bg rounded-xl p-6 border border-info-border">
            <h3 className="text-xl sm:text-2xl font-bold mb-6 text-info-text text-center">Character Writers</h3>
            
            <div className="grid grid-cols-1 gap-3">
              {playerAssignments.map((assignment) => {
                const writer = players.find(p => p.id === assignment.playerId);
                const character = players.find(p => p.id === assignment.assignedPlayerId);
                const isConceptWinner = assignment.playerId === bestConceptWinner;
                
                if (!writer || !character) return null;
                
                return (
                  <div 
                    key={`${assignment.playerId}-${assignment.assignedPlayerId}`}
                    className={`p-4 rounded-lg flex items-center justify-between ${
                      isConceptWinner 
                        ? 'bg-warning-bg border border-warning-border' 
                        : 'bg-background-card border border-border-primary'
                    }`}
                  >
                    <div className="flex items-center">
                      <span className="font-semibold text-text-primary">{writer.name}</span>
                      <span className="mx-2 text-text-secondary">wrote for</span>
                      <span className="font-semibold text-text-primary">{character.name}</span>
                    </div>
                    
                    {isConceptWinner && (
                      <div className="flex items-center text-warning-text">
                        <span className="text-xl mr-1">🏆</span>
                        <span className="font-medium text-sm">Best Concept</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
            <div className="mt-10 flex justify-center">
              <button
              onClick={handleReturnHome}
                className="px-10 py-4 rounded-lg bg-brand-primary hover:bg-brand-secondary text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
              >
              Back to Home
              </button>
            </div>
          
        </div>
      </main>
    );
  }

  // Lobby phase rendering (default)
  return (
    <main className="h-screen flex flex-col items-center justify-center gap-6 bg-background px-4 sm:px-6 lg:px-8">
      <DarkModeToggle />
      {/* Connection status indicator - place at the top */}
      {(isReconnecting || !isConnected) && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 p-3 rounded-lg z-50 ${
          isReconnecting ? 'bg-warning-bg text-warning-text' : 'bg-error-bg text-error-text'
        }`}>
          <div className="flex items-center">
            {isReconnecting ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-warning-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
            <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text">
              PlotTwist
            </h1>
          </Link>
          <div className="flex flex-col items-center gap-3">
            <span className="text-lg text-text-secondary">Room Code:</span>
            <code className="text-2xl font-mono font-bold bg-gradient-to-r from-brand-primary to-brand-secondary text-transparent bg-clip-text">
              {slug}
            </code>
            <button
              onClick={handleCopyLink}
              className="px-6 py-3 rounded-lg bg-brand-primary text-white hover:bg-brand-secondary transition-colors text-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>

        {isHost && gamePhase === 'lobby' && (
          <div className="flex flex-col gap-4 p-4 bg-background-card rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-text-primary">Game Settings</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Tone</label>
                <select
                  value={gameSettings.tone}
                  onChange={(e) => handleSettingChange('tone', e.target.value as GameSettings['tone'])}
                  className="w-full px-3 py-2 border border-border-primary rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-background-primary text-text-primary"
                >
                  <option value="Funny">Funny</option>
                  <option value="Serious">Serious</option>
                  <option value="Dramatic">Dramatic</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Scene</label>
                <select
                  value={gameSettings.scene}
                  onChange={(e) => handleSettingChange('scene', e.target.value as GameSettings['scene'])}
                  className="w-full px-3 py-2 border border-border-primary rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-background-primary text-text-primary"
                >
                  <option value="Party">Party</option>
                  <option value="Coffee Shop">Coffee Shop</option>
                  <option value="Classroom">Classroom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Length</label>
                <select
                  value={gameSettings.length}
                  onChange={(e) => handleSettingChange('length', e.target.value as GameSettings['length'])}
                  className="w-full px-3 py-2 border border-border-primary rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-background-primary text-text-primary"
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
                    ? 'bg-background-muted cursor-not-allowed text-text-muted' 
                    : 'bg-brand-primary hover:bg-brand-secondary cursor-pointer'
                } text-background-primary transition-colors text-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all`}
              >
                {players.length < 2 ? "Need More Players" : "Start Game"}
              </button>
            </div>
          </div>
        )}

        {/* Display for non-host who should be host based on join time */}
        {!isHost && gamePhase === 'lobby' && players.length > 0 && players[0].id === playerId && (
          <div className="flex flex-col gap-4 p-4 bg-warning-bg border border-warning-border rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-warning-text">Host Status Issue</h2>
            <p className="text-sm text-warning-text">
              You should be the host (first player), but your host status is not active.
            </p>
            <button
              onClick={syncHostStatus}
              className="px-4 py-2 bg-warning-text hover:bg-warning-border text-background-primary rounded-md"
            >
              Claim Host Status
            </button>
          </div>
        )}

        {isHost && gamePhase !== 'lobby' && (
          <div className="flex flex-col gap-4 p-4 bg-background-card rounded-lg shadow-md">
            <h2 className="text-lg font-semibold text-text-primary">Game Settings</h2>
            <div className="flex flex-col gap-3">
              <div className="text-text-secondary">
                <span className="font-medium">Tone:</span> {gameSettings.tone}
              </div>
              <div className="text-text-secondary">
                <span className="font-medium">Scene:</span> {gameSettings.scene}
              </div>
              <div className="text-text-secondary">
                <span className="font-medium">Length:</span> {gameSettings.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {gamePhase === 'lobby' && (
        <>
          <h2 className="text-2xl font-semibold text-text-primary">Players</h2>
          <div className="mb-4 text-center text-text-secondary">
            <strong>{players.length}</strong> players in the room
          </div>
          <ul className="text-xl">
            {stablePlayers.map((p) => (
              <li key={p.id} className="py-1 flex items-center gap-2 text-text-primary">
                <span className="text-base">—</span>
                {p.name}
                {p.id === hostId && (
                  <span className="text-sm px-2 py-0.5 bg-brand-primary text-background-primary rounded-full">
                    Host
                  </span>
                )}
                {isHost && p.id !== hostId && (
                  <button
                    onClick={() => handleKickPlayer(p.id)}
                    className="text-error-text hover:text-error-border transition-colors"
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
