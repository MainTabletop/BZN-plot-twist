          <p className="text-gray-700 mb-6 text-center">
            Vote for your favorite performances and guess who wrote your character.
          </p>
          
          {/* Scoring Banner - Added for clearer point attribution */}
          <div className="w-full p-3 bg-indigo-50 border border-indigo-100 rounded-lg mb-6 text-center">
            <p className="text-indigo-800 italic text-sm md:text-base font-medium">
              Guess who wrote your description (3 pts), then vote for Best Concept (1 pt) and Best Delivery (1 pt).
            </p>
          </div>
          
          {/* Add submission counter */}
          <div className="mb-4 text-center">
            <strong>{guessSubmittedPlayerIds.length} of {players.length}</strong> players have submitted
          </div> 