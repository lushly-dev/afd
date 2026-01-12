import React from 'react';
import { useAuthToken } from '@convex-dev/auth/react';
import { Login } from './components/Login';
import App from './App';

export const AppWithAuth: React.FC = () => {
  const token = useAuthToken();
  const isLoading = token === undefined;
  const isAuthenticated = token !== null;

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <App />;
};