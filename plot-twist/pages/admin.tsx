import React, { useState } from 'react';
import Link from 'next/link';

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugData, setDebugData] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const runMigrations = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/run-migrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, roomCode }),
      });
      
      const data = await response.json();
      setResults(data);
      
      if (!response.ok) {
        setError(data.error || 'An error occurred');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runDiagnostics = async () => {
    setDebugLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/debug-db');
      const data = await response.json();
      setDebugData(data);
      
      if (!response.ok) {
        setError(data.error || 'An error occurred');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDebugLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900">Plot Twist Admin</h1>
          <p className="mt-2 text-sm text-gray-600">
            <Link href="/" className="text-blue-600 hover:text-blue-500">
              &larr; Back to Home
            </Link>
          </p>
        </div>
        
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        <div className="bg-white shadow overflow-hidden sm:rounded-lg mb-6">
          <div className="px-4 py-5 sm:px-6">
            <h2 className="text-lg font-medium text-gray-900">Run Migrations</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create tables and assign seat numbers
            </p>
          </div>
          <div className="border-t border-gray-200 px-4 py-5 sm:p-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="token" className="block text-sm font-medium text-gray-700">Admin Token</label>
                <input
                  type="password"
                  id="token"
                  className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 border"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="room-code" className="block text-sm font-medium text-gray-700">Room Code</label>
                <input
                  type="text"
                  id="room-code"
                  className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 border"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-5">
              <button
                type="button"
                onClick={runMigrations}
                disabled={loading || !token}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  loading || !token ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none`}
              >
                {loading ? 'Running...' : 'Run Migrations'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="bg-white shadow overflow-hidden sm:rounded-lg mb-6">
          <div className="px-4 py-5 sm:px-6">
            <h2 className="text-lg font-medium text-gray-900">Diagnostics</h2>
            <p className="mt-1 text-sm text-gray-500">
              Check database tables and configuration
            </p>
          </div>
          <div className="border-t border-gray-200 px-4 py-5 sm:p-6">
            <button
              type="button"
              onClick={runDiagnostics}
              disabled={debugLoading}
              className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                debugLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
              } focus:outline-none`}
            >
              {debugLoading ? 'Running...' : 'Run Diagnostics'}
            </button>
          </div>
        </div>
        
        {results && (
          <div className="bg-white shadow overflow-hidden sm:rounded-lg mb-6">
            <div className="px-4 py-5 sm:px-6">
              <h2 className="text-lg font-medium text-gray-900">Migration Results</h2>
            </div>
            <div className="border-t border-gray-200 px-4 py-5 sm:p-6">
              <pre className="bg-gray-50 p-4 rounded-md overflow-auto max-h-96">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          </div>
        )}
        
        {debugData && (
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h2 className="text-lg font-medium text-gray-900">Diagnostic Results</h2>
            </div>
            <div className="border-t border-gray-200 px-4 py-5 sm:p-6">
              <pre className="bg-gray-50 p-4 rounded-md overflow-auto max-h-96">
                {JSON.stringify(debugData, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 